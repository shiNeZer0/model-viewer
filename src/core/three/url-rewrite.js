/**
 * 加载时的 URL 重写（纯函数，可单测）。
 *
 * Web 端一次选择/拖入的多个文件之间没有目录结构（只有 File 对象），
 * .gltf 里引用的 `robot.bin`、.mtl 里引用的 `textures/a.png` 无法按相对路径取到，
 * 因此需要把请求重写到对应的 blob URL 上。
 *
 * 桌面端不需要：目录已授权，asset 协议能按相对路径自然解析，assetMap 为空即直接放行。
 */

/** 取 URL 的文件名部分（去掉 query/hash 与目录） */
export function baseNameOfUrl(url) {
  const withoutQuery = String(url ?? '').split(/[?#]/)[0]
  const segments = withoutQuery.split(/[\\/]/)
  return segments[segments.length - 1] ?? ''
}

/**
 * 把请求的 URL 解析成 assetMap 中的 blob URL。
 * 先按完整相对路径匹配，失败再退回 basename（不同导出工具写法不一）。
 */
export function resolveAssetUrl(requested, assetMap) {
  if (!requested || !assetMap || assetMap.size === 0) return requested
  if (assetMap.has(requested)) return assetMap.get(requested)

  const baseName = baseNameOfUrl(requested)
  if (baseName && assetMap.has(baseName)) return assetMap.get(baseName)

  return requested
}
