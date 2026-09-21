/**
 * M5 新增格式的加载器：FBX / OBJ(+MTL) / PLY / 3MF。
 *
 * 与 GLB/GLTF/STL 一样按需 `import()`，首屏不为未使用的 loader 付体积。
 *
 * 三个格式特有的坑，这里集中处理：
 * 1. **OBJ 的材质在同目录的 .mtl 里**：找不到就降级为默认黏土材质，并把"缺 MTL"当提示而非错误
 *    （纯几何 OBJ 完全合法，不该报错）；
 * 2. **贴图路径可能是绝对本地路径**（导出器常把 MTL 里的 map_Kd 写成 `C:\...` 或 `file:///...`），
 *    需要重写成 asset 协议 URL——统一由 ModelLoader 装在 LoadingManager 的 URL 修饰器里完成
 *    （平台相关的转换器由调用方传入 `toAssetUrl`，本模块只做纯函数判定，不硬编码平台逻辑）；
 * 3. **3MF 是 Z-up 且数值单位通常是毫米**：轴向修正交由 orientation.js 按设置处理，这里只提示单位。
 *
 * 纯函数（siblingUrl / extractLocalPath / normalizeReferenceUrl）单独导出，可在 Node 下单测。
 */

import { Group, Mesh } from 'three'

import { collectLoaderWarnings, describeFbxUnit, ensureUsableMaterials, readFbxUnitScale } from './fbxCompat.js'
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
 * 从「已被 loader 拼上目录前缀」的请求里救回绝对本地路径。
 *
 * 为什么必须有这一层：MTLLoader 自带的 resolveURL 只把 `http(s)://` 当绝对地址，
 * 其余一律 `baseUrl + url`。于是 `map_Kd C:\tex\a.png` 这类写法到达 URL 修饰器时
 * 已经变成 `asset://localhost/E%3A%5Cmodels%5CC:\tex\a.png`，直接用 extractLocalPath 认不出来。
 *
 * 判定规则（取**最后**一个候选，前面的盘符属于 baseUrl 自身）：
 * - 候选形如 `X:\` 或 `X:/`；
 * - `X:` 之后不能紧跟第二个分隔符 —— `X://` 是 scheme（`http://` 的 `p:/`、`asset://` 的 `t:/`），
 *   而 `C:\` / `C:/` 才是路径。注意**不能**用"候选前面是不是字母"来判 scheme：
 *   `%5C`（编码后的 `\`）本身就以字母结尾，会把合法的 `...%5CC:\tex` 误杀。
 */
export function extractEmbeddedLocalPath(requested) {
  if (typeof requested !== 'string' || !requested) return null
  // 本身就是绝对路径的（含 file://）交给 extractLocalPath，这里只处理"被拼过前缀"的情况
  if (extractLocalPath(requested)) return null

  const candidates = []
  const pattern = /[a-zA-Z]:[\\/]/g
  for (const match of requested.matchAll(pattern)) {
    const after = requested[match.index + 3]
    if (after === '/' || after === '\\') continue
    candidates.push(match.index)
  }
  if (!candidates.length) return null

  return extractLocalPath(requested.slice(candidates[candidates.length - 1]))
}

/**
 * 把加载器请求的 URL 规范化：
 * 1. 先走 assetMap（Web 端多文件选择的 blob 映射，含 basename 兜底）；
 * 2. 再识别绝对本地路径并用调用方给的转换器改写成 asset 协议 URL（桌面端）；
 * 3. 最后尝试从被拼过前缀的 URL 里救回绝对路径（MTLLoader 的 map_Kd 就属于这种）。
 * 命中不了就原样返回——绝不吞掉原始请求，缺失资源才能被 LoadingManager 正常上报。
 */
export function normalizeReferenceUrl(requested, { assetMap, toAssetUrl } = {}) {
  if (typeof requested !== 'string' || !requested) return requested

  const mapped = resolveAssetUrl(requested, assetMap)
  if (mapped !== requested) return mapped

  const localPath = extractLocalPath(requested) ?? extractEmbeddedLocalPath(requested)
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

/**
 * FBX：材质多为 MeshPhongMaterial，动画在 `group.animations` 上。
 *
 * three 的 FBXLoader 对不少情况是**静默降级**（贴图通道不支持、多层贴图只留第一层、
 * 一个骨骼挂多个几何体、Z-up 自动旋转……），只在 console 里 warn 一句。
 * 这里把它的告警接管成界面提示，并补上两件它不做的事：单位识别（UnitScaleFactor → 模型单位）
 * 与材质兜底（PBR 材质解析失败会变成纯黑）。
 */
export async function loadFbx({ manager, url }) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
  const loader = new FBXLoader(manager)

  const { result: root, warnings } = await collectLoaderWarnings(() => loader.loadAsync(url))
  const animations = Array.isArray(root?.animations) ? root.animations : []

  const { replaced } = ensureUsableMaterials(root)
  if (replaced > 0) {
    warnings.push(
      `有 ${replaced} 个网格没有可用材质（three 的 FBX 加载器只支持 Lambert/Phong 材质，PBR 材质会缺失），已改用默认黏土材质`,
    )
  }

  const unit = describeFbxUnit(readFbxUnitScale(root))
  if (unit) warnings.push(unit.hint)

  return {
    root,
    animations,
    scenes: [],
    warnings,
    // 上层据此预选「模型单位」（见 useModelOpen）
    meta: unit ? { sourceUnit: unit.sourceUnit } : null,
  }
}

/** OBJ：先尝试同目录同名 .mtl，失败则降级为默认材质并提示 */
export async function loadObj({ manager, url }) {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/loaders/MTLLoader.js'),
  ])
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
export async function loadThreeMf({ manager, url }) {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
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
