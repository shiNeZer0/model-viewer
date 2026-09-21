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
import { describeFbxError } from './fbxCompat.js'
import { EXTRA_FORMAT_LOADERS, normalizeReferenceUrl } from './formatLoaders.js'
import { createDefaultMaterial } from './materialNormalizer.js'

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

/**
 * DRACO / KTX2 / Meshopt 解码器缓存（模块级单例）。
 *
 * 为什么必须复用：`DRACOLoader.dispose()` 会销毁整个 worker 池，KTX2Loader 同理。
 * 原先每次加载都在 finally 里 dispose，于是**每打开一个模型**都要重新 spawn worker、
 * 重新实例化 WASM 解码器 —— 连续打开多个压缩模型时每次都要再付一遍这份开销。
 *
 * 三点取舍：
 * 1. 解码器是随应用分发的**静态资源**（`/draco/`、`/basis/`，见 scripts/copy-decoders.mjs），
 *    加载耗时相对模型文件可忽略，因此这里不绑 LoadingManager、不上报解码器自身的进度；
 *    共享实例只能绑一个 manager，硬绑会导致"第二次加载用到第一次的进度回调"这类串扰。
 * 2. `GLTFLoader` 仍每次新建：它持有本次解析的状态（scenes/parser），不适合跨加载共享。
 * 3. `detectSupport` 需要真实 renderer；首次调用若拿不到 renderer，留到之后补做
 *    （结果只与 GPU 能力有关，与模型无关）。
 */
let gltfDecoderCache = null
/** 创建中的 Promise：并发调用必须共用同一次创建，否则会各自建出一组 worker 池 */
let gltfDecoderPending = null

async function createGltfDecoders() {
  const [{ DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/loaders/KTX2Loader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])

  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH)

  const ktx2Loader = new KTX2Loader()
  ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH)

  return { dracoLoader, ktx2Loader, MeshoptDecoder, supportDetected: false }
}

/** 取共享解码器（惰性创建；同一进程内复用同一组实例） */
export async function getGltfDecoders(renderer = null) {
  if (!gltfDecoderCache) {
    if (!gltfDecoderPending) {
      // 创建失败时清掉 pending，让下一次调用可以重试而不是永远拿到同一个失败结果
      gltfDecoderPending = createGltfDecoders().finally(() => {
        gltfDecoderPending = null
      })
    }
    gltfDecoderCache = await gltfDecoderPending
  }

  // KTX2 需要知道当前 GPU 支持哪些压缩格式，缺 renderer 时会退化甚至报错
  if (renderer && !gltfDecoderCache.supportDetected) {
    gltfDecoderCache.ktx2Loader.detectSupport(renderer)
    gltfDecoderCache.supportDetected = true
  }

  return gltfDecoderCache
}

/**
 * 释放共享解码器（引擎销毁时调用）。
 * 缓存清空后，下一次加载会重新建立 —— 因此它必须与"应用还活着"这个前提绑定。
 */
export function disposeGltfDecoders() {
  if (!gltfDecoderCache) return false
  gltfDecoderCache.dracoLoader.dispose()
  gltfDecoderCache.ktx2Loader.dispose()
  gltfDecoderCache = null
  return true
}

async function createGltfLoader(manager, renderer) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const { dracoLoader, ktx2Loader, MeshoptDecoder } = await getGltfDecoders(renderer)

  // manager 是每次加载特有的（URL 修饰器 + 进度回调），必须绑在本次的 loader 上
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(dracoLoader)
  loader.setKTX2Loader(ktx2Loader)
  loader.setMeshoptDecoder(MeshoptDecoder)

  return loader
}

async function loadGltf({ manager, renderer, url, onFileProgress }) {
  const loader = await createGltfLoader(manager, renderer)
  const gltf = await loader.loadAsync(url, onFileProgress)
  const root = gltf.scene ?? gltf.scenes?.[0] ?? null
  if (!root) throw new Error('glTF 中没有可显示的场景')
  // 解码器是共享的，**不能**在这里释放（见 getGltfDecoders 的说明）
  return { root, animations: gltf.animations ?? [], scenes: gltf.scenes ?? [] }
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
    // FBX 的失败原因常常很"技术"（版本门槛、损坏、非 FBX 内容），这里换成可操作的说明；
    // 其它格式保持原始信息，避免编造原因
    const detail = format.id === 'fbx' ? describeFbxError(error) : rawErrorMessage(error)
    throw new Error(`LOAD_FAILED: ${detail}`)
  }

  if (token?.cancelled) {
    disposeObject3D(result.root)
    throw new LoadCancelledError()
  }

  return result
}
