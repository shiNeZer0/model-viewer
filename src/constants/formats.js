/**
 * 支持的三维模型格式注册表。
 *
 * 注意：扩展名列表必须与后端 `src-tauri/src/asset_scope.rs` 的 SUPPORTED_EXTENSIONS
 * 保持一致（后端决定“能否授权”，前端决定“能否加载”），两侧都有单测守着。
 *
 * `loadable` 标记当前是否已有可用的 loader：
 * - M0 只实现 GLB / GLTF / STL；
 * - M5 会补齐 FBX / OBJ / PLY / 3MF 并把对应项翻成 true。
 */

export const MODEL_FORMATS = [
  { id: 'glb', label: 'glTF 二进制（GLB）', extensions: ['glb'], multiFile: false, loadable: true },
  { id: 'gltf', label: 'glTF（GLTF + 外部资源）', extensions: ['gltf'], multiFile: true, loadable: true },
  { id: 'stl', label: 'STL（立体光刻）', extensions: ['stl'], multiFile: false, loadable: true },
  { id: 'fbx', label: 'FBX', extensions: ['fbx'], multiFile: true, loadable: true },
  { id: 'obj', label: 'Wavefront OBJ（+ MTL）', extensions: ['obj'], multiFile: true, loadable: true },
  { id: 'ply', label: 'Stanford PLY', extensions: ['ply'], multiFile: false, loadable: true },
  { id: '3mf', label: '3D Manufacturing Format（3MF）', extensions: ['3mf'], multiFile: false, loadable: true },
]

/** 所有受支持的扩展名（小写，不带点） */
export const SUPPORTED_EXTENSIONS = MODEL_FORMATS.flatMap((format) => format.extensions)

const EXTENSION_INDEX = new Map()
for (const format of MODEL_FORMATS) {
  for (const extension of format.extensions) {
    EXTENSION_INDEX.set(extension, format)
  }
}

/** 文件对话框过滤器（Element Plus / Tauri dialog 通用结构） */
export const OPEN_DIALOG_FILTERS = [
  { name: '三维模型', extensions: SUPPORTED_EXTENSIONS },
  { name: 'glTF', extensions: ['glb', 'gltf'] },
  { name: '全部文件', extensions: ['*'] },
]

/** Web 端 <input type="file" accept> 的取值（浏览器用它过滤可选文件类型） */
export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`).join(',')

/**
 * 可导入的环境贴图扩展名（等距柱状 HDR / EXR）。
 * 必须与后端 `src-tauri/src/asset_scope.rs` 的 ENVIRONMENT_EXTENSIONS 保持一致，两侧都有单测守着。
 */
export const ENVIRONMENT_EXTENSIONS = ['hdr', 'exr']

/** 环境贴图的文件对话框过滤器 */
export const ENVIRONMENT_DIALOG_FILTERS = [
  { name: '环境贴图（HDR / EXR）', extensions: ENVIRONMENT_EXTENSIONS },
  { name: '全部文件', extensions: ['*'] },
]

/** Web 端环境贴图 file input 的 accept */
export const ENVIRONMENT_ACCEPT_ATTRIBUTE = ENVIRONMENT_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',')

/** 取小写扩展名（不含点）；无扩展名返回空串 */
export function extensionOf(fileName) {
  if (typeof fileName !== 'string') return ''
  const baseName = fileName.split(/[\\/]/).pop() ?? ''
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === baseName.length - 1) return ''
  return baseName.slice(dotIndex + 1).toLowerCase()
}

/** 按文件名解析格式对象；不支持时返回 null */
export function resolveFormatByName(fileName) {
  const extension = extensionOf(fileName)
  return extension ? EXTENSION_INDEX.get(extension) ?? null : null
}

/** 按格式 id 解析格式对象 */
export function resolveFormatById(formatId) {
  if (!formatId) return null
  const normalized = String(formatId).toLowerCase()
  return MODEL_FORMATS.find((format) => format.id === normalized) ?? null
}

export function isSupportedFileName(fileName) {
  return resolveFormatByName(fileName) !== null
}

/** 是否已有可用 loader（未实现的格式由 UI 明确提示，而不是静默失败） */
export function isLoadableFormat(formatId) {
  return resolveFormatById(formatId)?.loadable === true
}
