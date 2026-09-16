/**
 * 桌面端持久化后端：SQLite（沿用模板既有的「前端 plugin-sql 直连」模式）。
 *
 * 数据文件与 Rust 侧一致：`<用户主目录>/.model-viewer/app/app.db`，
 * 表结构由 `src-tauri/migrations/*.sql` 创建，这里只做读写。
 */

import { homeDir, join } from '@tauri-apps/api/path'
import Database from '@tauri-apps/plugin-sql'

let connectionPromise = null

async function createConnection() {
  // 与 Rust 侧 lib.rs 中的路径保持一致：不用 "~" 拼接，统一走 homeDir()
  const directory = await join(await homeDir(), '.model-viewer', 'app')
  const dbFile = await join(directory, 'app.db')
  return Database.load(`sqlite:${dbFile}`)
}

/** 单例连接；失败时清空缓存以便下次重试 */
function getDb() {
  if (!connectionPromise) {
    connectionPromise = createConnection().catch((error) => {
      connectionPromise = null
      throw error
    })
  }
  return connectionPromise
}

export async function readAllSettings() {
  const db = await getDb()
  const rows = await db.select('SELECT key, value FROM viewer_settings')
  const settings = {}
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      settings[row.key] = row.value
    }
  }
  return settings
}

export async function writeSetting(key, value) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO viewer_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value ?? null)],
  )
}

export async function listRecentFiles(limit = 10) {
  const db = await getDb()
  return db.select(
    `SELECT path, file_name, format, size_bytes, last_opened_at, open_count
     FROM recent_files ORDER BY last_opened_at DESC LIMIT ?`,
    [limit],
  )
}

export async function touchRecentFile({ filePath, fileName, formatId, sizeBytes = null }) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO recent_files (path, file_name, format, size_bytes, last_opened_at, open_count)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
     ON CONFLICT(path) DO UPDATE SET
       file_name = excluded.file_name,
       format = excluded.format,
       size_bytes = excluded.size_bytes,
       last_opened_at = CURRENT_TIMESTAMP,
       open_count = recent_files.open_count + 1`,
    [filePath, fileName, formatId, sizeBytes],
  )
}

export async function clearRecentFiles() {
  const db = await getDb()
  await db.execute('DELETE FROM recent_files')
}
