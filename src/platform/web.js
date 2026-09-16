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
