/**
 * M5 新增格式的加载器：FBX / OBJ(+MTL) / PLY / 3MF。
 *
 * 与 GLB/GLTF/STL 一样按需 `import()`，首屏不为未使用的 loader 付体积。
 *
 * 三个格式特有的坑，这里集中处理：
 * 1. **OBJ 的材质在同目录的 .mtl 里**：找不到就降级为默认黏土材质，并把"缺 MTL"当提示而非错误
 *    （纯几何 OBJ 完全合法，不该报错）；
 * 2. **贴图路径可能是绝对本地路径**（导出器常把 MTL 里的 map_Kd 写成 `C:\...` 或 `file:///...`），
 *    需要重写成 asset 协议 URL——由调用方传入 `mapReferenceUrl`（平台相关，故不在此处硬编码）；
 * 3. **3MF 是 Z-up 且数值单位通常是毫米**：轴向修正交由 orientation.js 按设置处理，这里只提示单位。
 *
 * 纯函数（siblingUrl / extractLocalPath / normalizeReferenceUrl）单独导出，可在 Node 下单测。
 */

import { Group, Mesh } from 'three'

import { createDefaultMaterial } from './materialNormalizer.js'
import { resolveAssetUrl } from './url-rewrite.js'

/** 从 URL 中取文件名（用于提示文案）；先解码再切分，否则 %5C 这类编码分隔符会被漏掉 */
export function nameOfUrl(url) {
  const clean = decodeURIComponentSafe(String(url ?? '').split(/[?#]/)[0])
  const segments = clean.split(/[\\/]/)
  return segments[segments.length - 1] ?? ''
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 推导同目录同名的兄弟文件 URL：`.../cube.obj` + `mtl` → `.../cube.mtl`。
 * 保留 query/hash；没有扩展名时追加；输入非法返回 null。
 */
export function siblingUrl(modelUrl, extension) {
  if (typeof modelUrl !== 'string' || !modelUrl) return null
  const match = /^([^?#]*)([?#].*)?$/.exec(modelUrl)
  const path = match?.[1] ?? ''
  const suffix = match?.[2] ?? ''
  if (!path) return null

  const dotIndex = path.lastIndexOf('.')
  const slashIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = dotIndex > slashIndex ? path.slice(0, dotIndex) : path
  const ext = String(extension ?? '').replace(/^\./, '')
  if (!ext) return null
  return `${base}.${ext}${suffix}`
}

/**
 * 识别"绝对本地路径"引用（MTL 里最常见的两种写法）。
 * 只认 Windows 盘符路径与 file:// URL：其它一律返回 null，交给常规相对路径解析。
 */
export function extractLocalPath(reference) {
  if (typeof reference !== 'string' || !reference) return null

  if (/^file:\/\//i.test(reference)) {
    let path = reference.replace(/^file:\/\//i, '')
    // file:///E:/x → /E:/x：去掉盘符前的多余斜杠
    if (/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1)
    path = decodeURIComponentSafe(path.split(/[?#]/)[0])
    return path || null
  }

  if (/^[a-zA-Z]:[\\/]/.test(reference)) return reference
  return null
}

/**
 * 把加载器请求的 URL 规范化：
 * 1. 先走 assetMap（Web 端多文件选择的 blob 映射，含 basename 兜底）；
 * 2. 再识别绝对本地路径并用调用方给的转换器改写成 asset 协议 URL（桌面端）。
 * 命中不了就原样返回——绝不吞掉原始请求，缺失资源才能被 LoadingManager 正常上报。
 */
export function normalizeReferenceUrl(requested, { assetMap, toAssetUrl } = {}) {
  if (typeof requested !== 'string' || !requested) return requested

  const mapped = resolveAssetUrl(requested, assetMap)
  if (mapped !== requested) return mapped

  const localPath = extractLocalPath(requested)
  if (localPath && typeof toAssetUrl === 'function') {
    const assetUrl = toAssetUrl(localPath)
    if (typeof assetUrl === 'string' && assetUrl) return assetUrl
  }
  return requested
}

/** 给没有材质的网格补默认黏土材质（OBJ 缺 MTL 时用） */
function applyDefaultMaterial(root) {
  root?.traverse?.((node) => {
    if (!node.isMesh) return
    if (!node.material) node.material = createDefaultMaterial()
  })
}

/** FBX：材质是 MeshPhongMaterial，three 可直接渲染；动画在 group.animations 上 */
export async function loadFbx({ manager, url, mapReferenceUrl }) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
  if (mapReferenceUrl) manager.setURLModifier(mapReferenceUrl)

  const loader = new FBXLoader(manager)
  const root = await loader.loadAsync(url)
  const animations = Array.isArray(root?.animations) ? root.animations : []
  return { root, animations, scenes: [], warnings: [] }
}

/** OBJ：先尝试同目录同名 .mtl，失败则降级为默认材质并提示 */
export async function loadObj({ manager, url, mapReferenceUrl }) {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/loaders/MTLLoader.js'),
  ])
  if (mapReferenceUrl) manager.setURLModifier(mapReferenceUrl)

  const warnings = []
  const mtlUrl = siblingUrl(url, 'mtl')
  let materials = null

  if (mtlUrl) {
    try {
      const mtlLoader = new MTLLoader(manager)
      materials = await mtlLoader.loadAsync(mtlUrl)
      materials.preload()
    } catch {
      materials = null
      warnings.push(`未找到或无法解析同目录的 ${nameOfUrl(mtlUrl)}，已改用默认材质（贴图与材质不会显示）`)
    }
  } else {
    warnings.push('无法推导同目录 .mtl 地址，已改用默认材质')
  }

  const loader = new OBJLoader(manager)
  if (materials) loader.setMaterials(materials)
  const root = await loader.loadAsync(url)
  // 没有 MTL 时 OBJLoader 会给一个纯白 Phong 材质，这里统一换成黏土材质便于观察形体
  if (!materials) applyDefaultMaterial(root)

  return { root, animations: [], scenes: [], warnings }
}

/** PLY：只有几何（可能有顶点色），自建网格与材质 */
export async function loadPly({ manager, url }) {
  const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js')
  const loader = new PLYLoader(manager)
  const geometry = await loader.loadAsync(url)

  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const vertexColors = Boolean(geometry.attributes.color)
  const mesh = new Mesh(geometry, createDefaultMaterial({ vertexColors }))
  mesh.name = 'PLY 网格'

  const root = new Group()
  root.name = 'PLY 模型'
  root.add(mesh)
  return { root, animations: [], scenes: [], warnings: [] }
}

/** 3MF：ZIP 容器，几何 + 基础材质；Z-up 由 orientation.js 按设置处理 */
export async function loadThreeMf({ manager, url, mapReferenceUrl }) {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
  if (mapReferenceUrl) manager.setURLModifier(mapReferenceUrl)

  const loader = new ThreeMFLoader(manager)
  const root = await loader.loadAsync(url)

  return {
    root,
    animations: [],
    scenes: [],
    // 3MF 规范以毫米为单位、Z 轴朝上；这里只提示单位，轴向修正交给设置
    warnings: ['3MF 数值单位通常为毫米，Z 轴朝上；可在「模型信息」页声明模型单位以查看换算后的尺寸'],
  }
}

/** 格式 id → 加载器（供 ModelLoader 分派） */
export const EXTRA_FORMAT_LOADERS = {
  fbx: loadFbx,
  obj: loadObj,
  ply: loadPly,
  '3mf': loadThreeMf,
}
