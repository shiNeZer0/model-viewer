/**
 * 桌面端（Tauri）后端实现：系统对话框、asset 协议授权、原生拖放。
 *
 * 只有这一个文件直接接触 `@tauri-apps/*`（storage 后端除外），
 * Web 版永远不会加载它。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { pictureDir, join } from '@tauri-apps/api/path'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open, save } from '@tauri-apps/plugin-dialog'

import { OPEN_DIALOG_FILTERS } from '../constants/formats.js'

/** 系统文件对话框，返回绝对路径数组 */
export async function pickPaths() {
  const selected = await open({
    multiple: true,
    directory: false,
    title: '选择三维模型文件',
    filters: OPEN_DIALOG_FILTERS,
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

/** 本地绝对路径 → asset 协议 URL（内置百分号编码，中文/空格路径安全） */
export function toLoaderUrl(filePath) {
  return convertFileSrc(filePath)
}

/**
 * 供 loader 的 URL 修饰器使用的**同步**转换器。
 * 必须是同步的：LoadingManager.setURLModifier 的回调不接受 Promise，
 * 而 FBO/MTL/FBX 里的贴图引用是加载过程中临时到达的，无法提前批量转换。
 */
export function createLocalPathConverter() {
  return (filePath) => (typeof filePath === 'string' && filePath ? convertFileSrc(filePath) : '')
}

export function probeModelFile(path) {
  return invoke('probe_model_file', { path })
}

export function allowAssetPaths(paths, grantMode) {
  return invoke('allow_asset_paths', { paths, grantMode })
}

export function listAssetGrants() {
  return invoke('list_asset_grants')
}

export function revokeAssetGrants() {
  return invoke('revoke_asset_grants')
}

/**
 * 订阅原生拖放事件。
 * Tauri 默认在系统层拦截拖放（dragDropEnabled=true），HTML5 的 drop 不会触发，
 * 必须用原生事件拿绝对路径。返回取消订阅函数。
 */
export async function subscribeNativeDrop(handler) {
  const webview = getCurrentWebview()
  return webview.onDragDropEvent((event) => {
    if (event.payload?.type === 'drop') handler(event.payload.paths ?? [])
  })
}

/**
 * 桌面端不需要 assetMap：整棵目录已被授权，asset 协议按相对路径自然解析
 * （OBJ 引用的 .mtl 与贴图、glTF 的 .bin 都能直接取到）。
 */
export function createAssetMap() {
  return { map: new Map(), revokeAll: () => {} }
}

/* ------------------------------- 截图（M6-4） ------------------------------- */

/** 另存为对话框；取消时返回 null */
export async function pickSavePath({ defaultPath, filters } = {}) {
  return save({ title: '保存截图', defaultPath, filters })
}

/** 建议的默认保存位置：系统图片目录（取不到就只给文件名，由对话框用默认目录） */
export async function suggestedSavePath(fileName) {
  try {
    return await join(await pictureDir(), fileName)
  } catch (error) {
    console.warn('[tauri] 取图片目录失败，改用系统默认目录', error)
    return fileName
  }
}

/** 把 base64 的 PNG 交给 Rust 写盘（前端不碰 fs，写盘约束收在命令里） */
export function saveScreenshotFile({ path, base64 }) {
  return invoke('save_screenshot', { path, base64 })
}
