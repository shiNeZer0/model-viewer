/**
 * 文件头格式嗅探（前端实现）。
 *
 * 这是 `src-tauri/src/asset_scope.rs::sniff_format` 的等价实现，供 Web 版使用
 * （Web 没有 Rust 后端，只能自己读 File 的前 512 字节）。
 *
 * 两份实现的判定规则必须完全一致：共享测试向量放在
 * `tests/fixtures/format-sniff-cases.json`，Rust 与 JS 的单测都会读取它。
 */

/** 探测时读取的头部字节数（需 ≥84 才能校验二进制 STL 的面数头） */
export const PROBE_HEAD_BYTES = 512

const OBJ_PREFIXES = ['v ', 'vn ', 'vt ', 'f ', 'o ', 'g ', 's ', 'mtllib ', 'usemtl ']

/** NUL 之前视为有效文本，并去掉 BOM 与行首空白 */
function headAsText(head) {
  const end = head.indexOf(0)
  const slice = end === -1 ? head : head.subarray(0, end)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(slice)
  return text.replace(/^[\uFEFF \t\r\n]+/, '')
}

function looksLikeBinaryStl(head, fileLen) {
  if (fileLen < 84 || head.length < 84) return false
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const triangles = view.getUint32(80, true)
  return 84 + triangles * 50 === fileLen
}

function looksLikeObj(text) {
  return text
    .split('\n')
    .slice(0, 20)
    .some((line) => {
      const trimmed = line.replace(/\s+$/, '')
      return OBJ_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    })
}

function startsWithBytes(head, bytes) {
  if (head.length < bytes.length) return false
  return bytes.every((value, index) => head[index] === value)
}

const ASCII = (text) => Array.from(text, (char) => char.charCodeAt(0))

/**
 * 通过文件头部判断真实格式。
 * @param {Uint8Array} head 文件头部字节
 * @param {number} fileLen 文件总长度
 * @returns {string|null} 格式 id，无法判定时为 null
 */
export function sniffFormat(head, fileLen) {
  if (!head || head.length === 0) return null

  if (startsWithBytes(head, ASCII('glTF'))) return 'glb'
  if (startsWithBytes(head, [0x50, 0x4b, 0x03, 0x04])) return '3mf' // 3MF 是 ZIP 容器
  if (startsWithBytes(head, ASCII('ply'))) return 'ply'
  if (startsWithBytes(head, ASCII('Kaydara FBX Binary'))) return 'fbx'
  if (looksLikeBinaryStl(head, fileLen)) return 'stl'

  const text = headAsText(head)
  if (text.startsWith('{')) return 'gltf' // glTF 的 JSON 描述文件
  if (text.startsWith('; FBX')) return 'fbx' // ASCII FBX 以注释行开头
  if (text.startsWith('solid')) return 'stl'
  if (looksLikeObj(text)) return 'obj'

  return null
}

/** 是否为 ZIP 容器（3MF 需要特殊提示） */
export function isZipContainer(head) {
  return Boolean(head) && startsWithBytes(head, [0x50, 0x4b, 0x03, 0x04])
}

/** 十六进制字符串转字节数组（单测与调试用） */
export function hexToBytes(hex) {
  const clean = String(hex ?? '')
  const bytes = new Uint8Array(Math.floor(clean.length / 2))
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
