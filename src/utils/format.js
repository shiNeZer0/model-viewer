/**
 * 显示用格式化函数（纯函数，可单测）。
 */

/** 字节 → 人类可读（1024 进制，保留 1 位小数） */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** 千分位计数；空值显示 0，避免界面出现 undefined */
export function formatCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return value.toLocaleString('zh-CN')
}

/** 毫秒时间戳 → 本地时间字符串 */
export function formatTimestamp(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
