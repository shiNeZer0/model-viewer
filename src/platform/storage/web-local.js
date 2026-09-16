/**
 * Web 端持久化后端：localStorage。
 *
 * 浏览器里没有 SQLite，但设置项与最近文件都是小体量键值数据，localStorage 足够；
 * 对外暴露的 API 与桌面端 SQLite 后端完全一致。
 *
 * 注意：Web 端没有绝对路径，最近文件用「文件名::大小」作为标识，因此**无法按路径重新打开**，
 * 已知限制记录在 docs/设计文档.md 的双端差异一节。
 */

const SETTINGS_PREFIX = 'mv.settings.'
const RECENT_KEY = 'mv.recentFiles'
const MAX_RECENT_FILES = 20

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export async function readAllSettings() {
  const settings = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(SETTINGS_PREFIX)) continue
    const settingName = key.slice(SETTINGS_PREFIX.length)
    try {
      settings[settingName] = JSON.parse(localStorage.getItem(key))
    } catch {
      settings[settingName] = localStorage.getItem(key)
    }
  }
  return settings
}

export async function writeSetting(key, value) {
  writeJson(`${SETTINGS_PREFIX}${key}`, value ?? null)
}

export async function listRecentFiles(limit = 10) {
  const files = readJson(RECENT_KEY, [])
  if (!Array.isArray(files)) return []
  return files
    .slice()
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, limit)
}

export async function touchRecentFile({ filePath, fileName, formatId, sizeBytes = null }) {
  const files = readJson(RECENT_KEY, [])
  const list = Array.isArray(files) ? files : []
  const existing = list.find((item) => item.path === filePath)

  if (existing) {
    existing.fileName = fileName
    existing.format = formatId
    existing.sizeBytes = sizeBytes
    existing.lastOpenedAt = Date.now()
    existing.openCount = (existing.openCount ?? 1) + 1
  } else {
    list.push({
      path: filePath,
      fileName,
      format: formatId,
      sizeBytes,
      lastOpenedAt: Date.now(),
      openCount: 1,
    })
  }

  const trimmed = list
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, MAX_RECENT_FILES)
  writeJson(RECENT_KEY, trimmed)
}

export async function clearRecentFiles() {
  localStorage.removeItem(RECENT_KEY)
}
