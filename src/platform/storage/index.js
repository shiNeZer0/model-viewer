/**
 * 持久化门面：按运行环境选后端。
 *
 * 用动态 import 而不是静态 import，好处是 Web 包不会把 @tauri-apps/plugin-sql 打进首屏，
 * 桌面包也不会加载 localStorage 实现。
 *
 * 约定：所有函数都可能抛错（数据库未就绪、迁移未执行、配额不足等），
 * 调用方需自行兜底 —— 不能让「设置存不上」阻断查看模型这个主流程。
 */

import { isTauri } from '../runtime.js'

let backendPromise = null

function loadBackend() {
  if (!backendPromise) {
    backendPromise = (isTauri ? import('./tauri-sqlite.js') : import('./web-local.js')).catch(
      (error) => {
        backendPromise = null
        throw error
      },
    )
  }
  return backendPromise
}

export async function readAllSettings() {
  return (await loadBackend()).readAllSettings()
}

export async function writeSetting(key, value) {
  return (await loadBackend()).writeSetting(key, value)
}

export async function listRecentFiles(limit) {
  return (await loadBackend()).listRecentFiles(limit)
}

export async function touchRecentFile(entry) {
  return (await loadBackend()).touchRecentFile(entry)
}

export async function clearRecentFiles() {
  return (await loadBackend()).clearRecentFiles()
}
