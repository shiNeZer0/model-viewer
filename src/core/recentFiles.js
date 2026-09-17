/**
 * 「最近打开的文件」记录的归一化与展示（纯函数，可单测）。
 *
 * 为什么需要这一层：两端后端存下来的记录形状并不一致，界面不应该关心这件事。
 * - 桌面 SQLite：snake_case 列名，`last_opened_at` 来自 `CURRENT_TIMESTAMP`，
 *   是**不带时区标记的 UTC 字符串**（如 `2026-09-17 10:24:00`）；
 * - Web localStorage：camelCase 字段名，时间戳是毫秒数。
 *
 * 时间解析必须显式按 UTC 处理：`Date.parse('2026-09-17 10:24:00')` 在 V8 里被当作**本地时间**，
 * 直接用会让列表里所有记录整体偏移一个时区（东八区表现为"8 小时前"）。
 */

/** 与 Web 端存储后端的裁剪上限保持一致 */
export const MAX_RECENT_FILES = 20

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** SQLite 的 datetime 文本（秒可省略） */
const SQLITE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * 把后端记录里的时间字段转成毫秒时间戳；无法识别时返回 0（界面显示「—」而不是 NaN）。
 * @param {number|string|null|undefined} value
 */
export function toTimestampMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0
  if (typeof value !== 'string') return 0

  const text = value.trim()
  if (!text) return 0

  const matched = SQLITE_DATETIME.exec(text)
  if (matched) {
    const [, year, month, day, hour, minute, second = '0'] = matched
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 从路径取文件名。
 * 刻意不从 `platform/sources.js` 复用 `fileNameOf`：core 是平台无关层，不该反向依赖 platform。
 */
function baseNameOf(filePath) {
  const segments = String(filePath ?? '').split(/[\\/]/)
  return segments[segments.length - 1] ?? ''
}

/**
 * 把一条后端记录归一化成界面统一形状；缺少路径的记录视为无效返回 null。
 * @returns {{path: string, fileName: string, formatId: string, sizeBytes: number|null,
 *            lastOpenedAtMs: number, openCount: number}|null}
 */
export function normalizeRecentEntry(raw) {
  if (!raw || typeof raw !== 'object') return null

  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!path) return null

  const rawName = raw.file_name ?? raw.fileName
  const fileName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : baseNameOf(path)

  const rawSize = raw.size_bytes ?? raw.sizeBytes
  const sizeBytes = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null

  const rawCount = raw.open_count ?? raw.openCount
  const openCount = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1

  const rawFormat = raw.format ?? raw.formatId

  return {
    path,
    fileName,
    formatId: typeof rawFormat === 'string' ? rawFormat.toLowerCase() : '',
    sizeBytes,
    lastOpenedAtMs: toTimestampMs(raw.last_opened_at ?? raw.lastOpenedAt),
    openCount,
  }
}

/**
 * 归一化整份列表：丢弃无效记录、按路径去重（保留最近一次）、按时间倒序、裁剪到上限。
 */
export function normalizeRecentList(rawList, { limit = MAX_RECENT_FILES } = {}) {
  if (!Array.isArray(rawList)) return []

  const byPath = new Map()
  for (const raw of rawList) {
    const entry = normalizeRecentEntry(raw)
    if (!entry) continue
    const existing = byPath.get(entry.path)
    if (!existing || entry.lastOpenedAtMs > existing.lastOpenedAtMs) byPath.set(entry.path, entry)
  }

  return [...byPath.values()]
    .sort((a, b) => b.lastOpenedAtMs - a.lastOpenedAtMs)
    .slice(0, Math.max(0, limit))
}

/** 移除一条记录（按路径） */
export function withoutRecentEntry(entries, path) {
  if (!Array.isArray(entries)) return []
  return entries.filter((entry) => entry.path !== path)
}

/**
 * 相对时间文案。`now` 显式传入是为了可单测（也方便一次渲染里所有条目用同一个基准）。
 */
export function describeRecentTime(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'

  const delta = now - ms
  // 时钟回拨或记录时间在"未来"时，不显示负数
  if (delta < MINUTE_MS) return '刚刚'
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} 分钟前`
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} 小时前`
  if (delta < 2 * DAY_MS) return '昨天'
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)} 天前`

  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
