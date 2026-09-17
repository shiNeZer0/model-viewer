/**
 * 截图导出的纯逻辑：倍数收敛、文件名、data URL 拆解（纯函数，可单测）。
 *
 * 像素读取在 `ViewerEngine.captureImage`，落盘/下载在 `platform` 层；
 * 这里只放"与 WebGL 和平台都无关、却最容易写错"的部分。
 */

/** 导出倍数：1× 与窗口一致，2× / 3× 用于出图 */
export const SCREENSHOT_SCALES = [
  { id: '1', label: '1×（与窗口一致）', value: 1 },
  { id: '2', label: '2×（高清）', value: 2 },
  { id: '3', label: '3×（超清）', value: 3 },
]

export const DEFAULT_SCREENSHOT_SCALE = 2

/**
 * 单边像素上限。超过显卡的 MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE 会直接渲染失败，
 * 8192 是能在绝大多数设备上安全通过的经验值（4K 屏 3× 才会触及）。
 */
export const MAX_EXPORT_EDGE = 8192

/** 倍数收敛到 [1, 3]；非法值退回默认 */
export function clampScale(scale) {
  if (!Number.isFinite(scale)) return DEFAULT_SCREENSHOT_SCALE
  return Math.min(3, Math.max(1, scale))
}

/**
 * 换算实际要用的像素比。
 *
 * 下限是当前显示用的像素比：低于它等于"截图比看到的还糊"，没有意义；
 * 上限由 MAX_EXPORT_EDGE 兜住，避免在大屏 + 高倍时申请一块显卡开不出来的缓冲。
 */
export function resolveExportRatio({ baseRatio = 1, scale = DEFAULT_SCREENSHOT_SCALE, width = 0, height = 0 } = {}) {
  const safeBase = Number.isFinite(baseRatio) && baseRatio > 0 ? baseRatio : 1
  const desired = safeBase * clampScale(scale)

  const longestEdge = Math.max(width, height)
  if (!(longestEdge > 0)) return desired
  if (longestEdge * desired <= MAX_EXPORT_EDGE) return desired
  return Math.max(safeBase, MAX_EXPORT_EDGE / longestEdge)
}

/** 时间戳（本地时间）→ `20260917-110530`，可直接进文件名 */
function fileStamp(ms) {
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}`
}

/**
 * 生成建议文件名：`模型名-20260917-110530@2x.png`。
 * 不能直接用 `formatTimestamp`（里面带冒号，Windows 文件名非法），因此这里单独实现。
 */
export function buildScreenshotFileName({
  fileName = '',
  scale = DEFAULT_SCREENSHOT_SCALE,
  now = Date.now(),
  extension = 'png',
} = {}) {
  // 先只取最后一段文件名（万一带了路径，不能把目录名切进文件名里），再去扩展名
  const lastSegment = String(fileName ?? '').split(/[\\/]/).pop() ?? ''
  const withoutExtension = lastSegment.replace(/\.[^.]*$/, '')
  // 去掉 Windows/macOS 都非法的字符，避免用户拿到一个存不下的默认名
  const safeBase = withoutExtension.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'model-viewer'
  const safeScale = clampScale(scale)
  const suffix = safeScale > 1 ? `@${safeScale}x` : ''
  const safeNow = Number.isFinite(now) ? now : Date.now()
  return `${safeBase}-${fileStamp(safeNow)}${suffix}.${extension.replace(/^\./, '')}`
}

/**
 * 从 data URL 里取出纯 base64（Rust 侧只接受 base64，不解析 data URL 语法）。
 * 非 base64 编码的 data URL（如 URL 编码的 SVG）返回空串——宁可明确失败，也不要写坏文件。
 */
export function stripDataUrlPrefix(dataUrl) {
  if (typeof dataUrl !== 'string') return ''
  const trimmed = dataUrl.trim()
  if (!trimmed) return ''

  const commaIndex = trimmed.indexOf(',')
  if (trimmed.startsWith('data:') && commaIndex >= 0) {
    if (!/;base64/i.test(trimmed.slice(5, commaIndex))) return ''
    return trimmed.slice(commaIndex + 1).replace(/\s+/g, '')
  }
  return trimmed.replace(/\s+/g, '')
}

/** data URL 的 MIME 类型（无法识别时返回空串），用于给出"这确实是一张图"的判断 */
export function dataUrlMimeType(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return ''
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return ''
  return dataUrl.slice(5, commaIndex).split(';')[0].toLowerCase()
}
