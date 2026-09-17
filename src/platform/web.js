/**
 * Web 端（普通浏览器）后端实现。
 *
 * 浏览器沙箱下拿不到绝对路径，只能持有用户选择/拖入的 File 对象：
 * - 用 blob URL 交给 loader；
 * - 多文件格式（glTF + .bin + 贴图、OBJ + .mtl）通过 assetMap 做「相对名 → blob URL」重写；
 * - 文件元信息与真实格式由前端自己嗅探（见 sniff.js）。
 */

import { ACCEPT_ATTRIBUTE } from '../constants/formats.js'
import { PROBE_HEAD_BYTES, isZipContainer, sniffFormat } from './sniff.js'

/**
 * 弹出隐藏的 file input 让用户选择文件。
 * 同时监听 change 与 cancel：用户取消时也必须 resolve，否则调用方的 Promise 永远挂着。
 */
export function pickFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT_ATTRIBUTE
    input.multiple = multiple
    input.style.display = 'none'

    const finish = (files) => {
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
    input.addEventListener('cancel', () => finish([]), { once: true })

    document.body.appendChild(input)
    input.click()
  })
}

/** 读取文件头部并嗅探真实格式（等价于桌面端的 probe_model_file） */
export async function probeFile(file) {
  const head = new Uint8Array(await file.slice(0, PROBE_HEAD_BYTES).arrayBuffer())
  return {
    sniffedFormat: sniffFormat(head, file.size),
    isZipContainer: isZipContainer(head),
    sizeBytes: file.size,
  }
}

/**
 * 为选中的全部文件建立「相对名 → blob URL」映射。
 * 同时登记完整文件名与 basename：glTF/MTL 里的引用有时写成 `textures/a.png`，有时只写 `a.png`。
 */
export function createAssetMap(files) {
  const map = new Map()
  const createdUrls = []

  for (const file of files) {
    const url = URL.createObjectURL(file)
    createdUrls.push(url)
    map.set(file.name, url)
    const baseName = file.name.split(/[\\/]/).pop()
    if (baseName && !map.has(baseName)) map.set(baseName, url)
  }

  return {
    map,
    revokeAll: () => {
      for (const url of createdUrls) URL.revokeObjectURL(url)
    },
  }
}

/**
 * Web 端没有绝对本地路径（浏览器只给 blob），因此没有可用的路径转换器。
 * 返回 null 而不是抛错：调用方据此跳过 URL 重写，贴图走 assetMap / 原样请求。
 */
export function createLocalPathConverter() {
  return null
}

/* ------------------------------- 截图（M6-4） ------------------------------- */

/** 浏览器没有另存为对话框（下载位置由浏览器/用户设置决定），返回 null */
export async function pickSavePath() {
  return null
}

/** Web 端没有"图片目录"概念，直接用文件名（浏览器会落到下载目录） */
export async function suggestedSavePath(fileName) {
  return fileName
}

/**
 * 触发下载。
 * 用 blob URL 而不是直接把 data URL 塞给 `<a href>`：几 MB 的 data URL 在部分浏览器上
 * 会被当作导航而不是下载，blob 更稳；用完立刻释放，避免长期占内存。
 */
export function downloadScreenshot({ fileName, dataUrl }) {
  const base64 = String(dataUrl).split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 交给浏览器读取后即可释放
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)

  return { path: fileName, bytes: bytes.length }
}

/**
 * 订阅 HTML5 拖放（仅 Web 端使用；桌面端由原生事件提供路径）。
 * @param {HTMLElement} target 拖放目标元素
 * @param {(files: File[]) => void} handler
 * @returns {() => void} 取消订阅
 */
export function subscribeHtml5Drop(target, handler) {
  const onDragOver = (event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) handler(files)
  }

  target.addEventListener('dragover', onDragOver)
  target.addEventListener('drop', onDrop)

  return () => {
    target.removeEventListener('dragover', onDragOver)
    target.removeEventListener('drop', onDrop)
  }
}
