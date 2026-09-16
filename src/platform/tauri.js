/**
 * 桌面端（Tauri）后端实现：系统对话框、asset 协议授权、原生拖放。
 *
 * 只有这一个文件直接接触 `@tauri-apps/*`（storage 后端除外），
 * Web 版永远不会加载它。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'

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
