/**
 * 平台适配层入口。
 *
 * 上层只用这里导出的 API，不关心自己跑在 Tauri 还是浏览器里。
 * 两端后端都是**动态 import**：Web 包不会把 @tauri-apps/* 拉进首屏，
 * 桌面包也不会加载 Web 的 blob 逻辑。
 */

import { resolveFormatByName } from '../constants/formats.js'
import { describeError, splitErrorCode } from '../utils/error-messages.js'
import { capabilities, isTauri, runtime, RUNTIME } from './runtime.js'
import { createModelSource, fileNameOf, syntheticId } from './sources.js'

export { capabilities, isTauri, runtime, RUNTIME }

let tauriBackendPromise = null
let webBackendPromise = null

function loadTauriBackend() {
  if (!tauriBackendPromise) tauriBackendPromise = import('./tauri.js')
  return tauriBackendPromise
}

function loadWebBackend() {
  if (!webBackendPromise) webBackendPromise = import('./web.js')
  return webBackendPromise
}

/** 后端拒绝整树授权的错误码（磁盘根目录 / 用户主目录） */
const PROTECTED_DIR_CODE = 'GRANT_REFUSED_PROTECTED_DIR'

const PROTECTED_DIR_WARNING =
  '该文件位于受保护目录（磁盘根目录或用户主目录），已自动改为仅授权该文件；' +
  '若模型依赖同目录的贴图或 .mtl，可能加载不完整。'

/**
 * 桌面端：路径 → 授权 → ModelSource。
 * 授权默认按设置里的模式；若父目录受保护则退化为「仅授权该文件」。
 */
export async function sourcesFromPaths(paths, { grantMode = 'parent-recursive' } = {}) {
  const backend = await loadTauriBackend()
  const sources = []

  for (const filePath of paths) {
    const name = fileNameOf(filePath)
    const format = resolveFormatByName(name)
    if (!format) {
      throw new Error(`UNSUPPORTED_FORMAT: ${name || filePath}`)
    }

    const probe = await backend.probeModelFile(filePath)

    const extraWarnings = []
    let report
    try {
      report = await backend.allowAssetPaths([filePath], grantMode)
    } catch (error) {
      const split = splitErrorCode(String(error?.message ?? error))
      if (split?.code !== PROTECTED_DIR_CODE || grantMode === 'file') throw error
      report = await backend.allowAssetPaths([filePath], 'file')
      extraWarnings.push(PROTECTED_DIR_WARNING)
    }

    const failed = report.errors?.[0]
    if (failed) throw new Error(failed.code)

    sources.push(
      createModelSource({
        id: filePath,
        name,
        sizeBytes: report.grants?.[0]?.sizeBytes ?? probe.sizeBytes ?? 0,
        formatId: format.id,
        sniffedFormatId: probe.sniffedFormat ?? null,
        isZipContainer: Boolean(probe.isZipContainer),
        url: backend.toLoaderUrl(filePath),
        assetMap: new Map(),
        extraWarnings,
      }),
    )
  }

  return { sources, dispose: () => {} }
}

/**
 * Web 端：File 列表 → ModelSource。
 * 一次选择里的所有文件都会进 assetMap（多文件格式的 .bin/贴图需要），
 * 只有受支持的模型文件会各自生成 source。
 */
export async function sourcesFromFiles(files) {
  const backend = await loadWebBackend()
  const fileList = Array.from(files ?? [])
  const assetMapHandle = backend.createAssetMap(fileList)
  const sources = []

  for (const file of fileList) {
    const format = resolveFormatByName(file.name)
    if (!format) continue // 伴随文件（.mtl/.bin/贴图）只进 assetMap

    const probe = await backend.probeFile(file)
    sources.push(
      createModelSource({
        id: syntheticId(file.name, file.size),
        name: file.name,
        sizeBytes: file.size,
        formatId: format.id,
        sniffedFormatId: probe.sniffedFormat,
        isZipContainer: probe.isZipContainer,
        url: assetMapHandle.map.get(file.name) ?? URL.createObjectURL(file),
        assetMap: assetMapHandle.map,
      }),
    )
  }

  return { sources, dispose: assetMapHandle.revokeAll }
}

/** 打开模型：桌面端弹系统对话框，Web 端弹 file input */
export async function openModelSources(options) {
  if (isTauri) {
    const backend = await loadTauriBackend()
    const paths = await backend.pickPaths()
    if (!paths.length) return { sources: [], dispose: () => {} }
    return sourcesFromPaths(paths, options)
  }

  const backend = await loadWebBackend()
  const files = await backend.pickFiles()
  if (!files.length) return { sources: [], dispose: () => {} }
  return sourcesFromFiles(files)
}

/**
 * 桌面端：按历史路径重新打开。
 * 必须重新走一遍授权 —— asset 协议的 scope 只存在于内存里（进程重启或用户撤销后即失效），
 * 直接把路径交给 loader 会得到一个"读不到文件"的沉默失败。
 * Web 端没有路径（历史记录里存的是「文件名::大小」合成键），明确拒绝而不是假装成功。
 */
export async function openModelAtPath(filePath, options = {}) {
  if (!isTauri) throw new Error('REOPEN_UNSUPPORTED: Web 预览')
  return sourcesFromPaths([filePath], options)
}

/**
 * 订阅拖放。
 * 桌面端走原生事件（拿到绝对路径），Web 端走 HTML5 drop（拿到 File）。
 * @param {HTMLElement|null} target HTML5 拖放目标（桌面端忽略）
 * @param {(payload: {sources: Array, dispose: Function}) => void} handler
 */
export async function subscribeModelDrop(target, handler) {
  if (isTauri) {
    const backend = await loadTauriBackend()
    return backend.subscribeNativeDrop(async (paths) => {
      if (!paths.length) return
      handler(await sourcesFromPaths(paths))
    })
  }

  const backend = await loadWebBackend()
  return backend.subscribeHtml5Drop(target, async (files) => {
    if (!files.length) return
    handler(await sourcesFromFiles(files))
  })
}

/* --------------------------- 授权管理（仅桌面端有） --------------------------- */

export async function listGrants() {
  if (!isTauri) return []
  const backend = await loadTauriBackend()
  return backend.listAssetGrants()
}

export async function revokeGrants() {
  if (!isTauri) return { revoked: 0 }
  const backend = await loadTauriBackend()
  return backend.revokeAssetGrants()
}

/** 供 UI 统一翻译错误：平台层抛出的错误码与后端一致 */
export { describeError }
