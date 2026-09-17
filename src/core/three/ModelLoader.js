/**
 * 模型加载入口。
 *
 * 设计要点：
 * 1. 每个格式的 loader 都按需 `import()`，首屏不为未使用的 loader 付出体积代价；
 * 2. 统一走一个 LoadingManager，把「主文件字节进度」与「外部资源进度」都上报给 UI；
 * 3. three 的 loader 不支持中断，因此用「取消令牌」在加载完成后丢弃过期结果
 *    （UI 文案是“取消加载”，不承诺真的中断网络请求）。
 */

import { Group, LoadingManager, Mesh } from 'three'

import { resolveFormatById } from '../../constants/formats.js'
import { rawErrorMessage } from '../../utils/error-messages.js'
import { disposeObject3D } from './disposal.js'
import { EXTRA_FORMAT_LOADERS } from './formatLoaders.js'
import { createDefaultMaterial } from './materialNormalizer.js'
import { normalizeReferenceUrl } from './formatLoaders.js'

/**
 * 解码器目录必须是**绝对 URL**：DRACOLoader / KTX2Loader 会在 blob URL 的 worker 里
 * importScripts / fetch，相对路径会以 worker 自身为基准而解析失败。
 * 用 document.baseURI 推导，可同时适配 Tauri（tauri.localhost）、根路径部署与子路径部署。
 */
function decoderBasePath(directory) {
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
  return new URL(directory, base).href
}

/** 解码器位于 public/ 下（由 scripts/copy-decoders.mjs 生成） */
export const DRACO_DECODER_PATH = decoderBasePath('draco/')
export const KTX2_TRANSCODER_PATH = decoderBasePath('basis/')

export class LoadCancelledError extends Error {
  constructor() {
    super('LOAD_CANCELLED: 用户取消了加载')
    this.name = 'LoadCancelledError'
  }
}

/** 生成取消令牌；同一时刻只允许一个加载在途，新的加载会取消旧的 */
export function createLoadToken() {
  return {
    cancelled: false,
    cancel() {
      this.cancelled = true
    },
  }
}

/**
 * 建立本次加载共用的 LoadingManager。
 *
 * URL 修饰器统一装在这里（各 loader 不再各自安装）：
 * - Web 端多文件格式：把 .gltf/.mtl 里的相对引用重写到选择的 blob URL 上；
 * - 桌面端：把绝对本地路径（MTL 的 map_Kd 等）改写成 asset 协议 URL。
 * `toAssetUrl` 必须是**同步**函数：LoadingManager.setURLModifier 不接受 Promise。
 */
export function createLoadingManager({ onProgress, onResourceError, assetMap, toAssetUrl } = {}) {
  const manager = new LoadingManager()
  manager.onProgress = (url, itemsLoaded, itemsTotal) => {
    onProgress?.({ url, itemsLoaded, itemsTotal, source: 'manager' })
  }
  manager.onError = (url) => {
    onResourceError?.(url)
  }
  if ((assetMap && assetMap.size > 0) || typeof toAssetUrl === 'function') {
    manager.setURLModifier((requested) => normalizeReferenceUrl(requested, { assetMap, toAssetUrl }))
  }
  return manager
}

async function createGltfLoader(manager, renderer) {
  const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/loaders/KTX2Loader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])

  const dracoLoader = new DRACOLoader(manager)
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH)

  const ktx2Loader = new KTX2Loader(manager)
  ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH)
  // KTX2 需要知道当前 GPU 支持哪些压缩格式，缺 renderer 时会退化甚至报错
  if (renderer) ktx2Loader.detectSupport(renderer)

  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(dracoLoader)
  loader.setKTX2Loader(ktx2Loader)
  loader.setMeshoptDecoder(MeshoptDecoder)

  return {
    loader,
    dispose() {
      dracoLoader.dispose()
      ktx2Loader.dispose()
    },
  }
}

async function loadGltf({ manager, renderer, url, onFileProgress }) {
  const { loader, dispose } = await createGltfLoader(manager, renderer)
  try {
    const gltf = await loader.loadAsync(url, onFileProgress)
    const root = gltf.scene ?? gltf.scenes?.[0] ?? null
    if (!root) throw new Error('glTF 中没有可显示的场景')
    return { root, animations: gltf.animations ?? [], scenes: gltf.scenes ?? [] }
  } finally {
    dispose()
  }
}

async function loadStl({ manager, url, onFileProgress }) {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
  const loader = new STLLoader(manager)
  const geometry = await loader.loadAsync(url, onFileProgress)

  // STL 只描述三角面：个别文件缺法线，补算后默认光照下才不会全黑
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals()
  }

  const mesh = new Mesh(geometry, createDefaultMaterial())
  mesh.name = 'STL 网格'
  const root = new Group()
  root.name = 'STL 模型'
  root.add(mesh)
  return { root, animations: [], scenes: [] }
}

/**
 * 加载模型。
 * @param {object} options
 * @param {string} options.url asset 协议 URL（桌面）或 blob URL（Web）
 * @param {string} options.formatId 格式 id（glb/gltf/stl/...）
 * @param {object} [options.renderer] 用于 KTX2 能力探测
 * @param {object} [options.token] createLoadToken() 产出的取消令牌
 * @param {Map<string,string>} [options.assetMap] 相对路径 → URL（Web 多文件格式用）
 * @param {(path: string) => string} [options.toAssetUrl] 本地绝对路径 → asset URL 的**同步**转换器（桌面端）
 * @returns {Promise<{root: object, animations: Array, scenes: Array}>}
 */
export async function loadModel({
  url,
  formatId,
  renderer = null,
  token = null,
  assetMap = null,
  toAssetUrl = null,
  onProgress,
  onResourceError,
} = {}) {
  const format = resolveFormatById(formatId)
  if (!format) {
    throw new Error(`UNSUPPORTED_FORMAT: ${formatId}`)
  }
  if (!format.loadable) {
    throw new Error(`FORMAT_NOT_IMPLEMENTED: ${format.id}`)
  }

  const manager = createLoadingManager({ onProgress, onResourceError, assetMap, toAssetUrl })
  const onFileProgress = (event) => {
    if (event?.total > 0) {
      onProgress?.({ url, loaded: event.loaded, total: event.total, source: 'file' })
    }
  }

  let result
  try {
    if (format.id === 'stl') {
      result = await loadStl({ manager, url, onFileProgress })
    } else if (EXTRA_FORMAT_LOADERS[format.id]) {
      // M5：FBX / OBJ(+MTL) / PLY / 3MF（这三个 loader 自带格式特有的兜底与提示）
      result = await EXTRA_FORMAT_LOADERS[format.id]({ manager, url, renderer })
    } else {
      result = await loadGltf({ manager, renderer, url, onFileProgress })
    }
  } catch (error) {
    throw new Error(`LOAD_FAILED: ${rawErrorMessage(error)}`)
  }

  if (token?.cancelled) {
    disposeObject3D(result.root)
    throw new LoadCancelledError()
  }

  return result
}
