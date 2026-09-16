/**
 * 统一的「模型来源」数据模型与纯函数（无平台依赖，可单测）。
 *
 * 桌面端来源是「路径 + asset 协议 URL」，Web 端来源是「File + blob URL」，
 * 但对上层（加载流程、UI）必须长得一样，差异全部封在 platform/* 后端里。
 */

import { resolveFormatByName } from '../constants/formats.js'

/**
 * @typedef {object} ModelSource
 * @property {string} id                 桌面端为绝对路径；Web 端为「文件名::大小」合成键
 * @property {string} name               文件名
 * @property {number} sizeBytes
 * @property {string} formatId           按扩展名判定的格式
 * @property {string|null} sniffedFormatId 按魔数嗅探的格式
 * @property {string} loadFormatId       实际交给 loader 的格式（嗅探优先）
 * @property {boolean} isZipContainer
 * @property {string} url                交给 loader 的 URL
 * @property {Map<string,string>} assetMap 相对名 → URL（Web 多文件格式需要，桌面端为空）
 * @property {string[]} warnings
 */

/** 从路径或文件名中取最后一段 */
export function fileNameOf(filePath) {
  const segments = String(filePath ?? '').split(/[\\/]/)
  return segments[segments.length - 1] ?? ''
}

/** 扩展名与真实格式不一致时的提示；一致或无法嗅探时返回 null */
export function extensionMismatchWarning({ formatId, sniffedFormatId }) {
  if (!formatId || !sniffedFormatId || formatId === sniffedFormatId) return null
  return `扩展名 .${formatId} 与文件真实格式 ${sniffedFormatId} 不一致，已按真实格式加载`
}

/** 嗅探结果优先；嗅探失败时回退扩展名判定 */
export function preferredFormatId(formatId, sniffedFormatId) {
  return sniffedFormatId ?? formatId
}

/** Web 端没有绝对路径，用「文件名::大小」作为去重与最近文件的标识 */
export function syntheticId(name, sizeBytes) {
  return `${name}::${sizeBytes ?? 0}`
}

/**
 * 组装 ModelSource。warnings 会依次收集「扩展名不一致」与后端补充的提示。
 */
export function createModelSource({
  id,
  name,
  sizeBytes = 0,
  formatId,
  sniffedFormatId = null,
  isZipContainer = false,
  url,
  assetMap = new Map(),
  extraWarnings = [],
}) {
  const warnings = [
    extensionMismatchWarning({ formatId, sniffedFormatId }),
    ...extraWarnings,
  ].filter(Boolean)

  return {
    id,
    name,
    sizeBytes,
    formatId,
    sniffedFormatId,
    loadFormatId: preferredFormatId(formatId, sniffedFormatId),
    isZipContainer,
    url,
    assetMap,
    warnings,
  }
}

/** 从一批文件里挑出受支持的模型（Web 端多选时可能混入 .mtl/.bin 等伴随文件） */
export function findSupportedFile(files) {
  return files.find((file) => resolveFormatByName(file.name)) ?? null
}
