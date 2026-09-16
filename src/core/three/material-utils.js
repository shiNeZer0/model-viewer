/**
 * 材质相关的公共小工具。
 * 单独成文件是为了让 stats.js（统计）与 disposal.js（释放）共用同一套遍历逻辑。
 */

/** 把节点上的材质统一成数组（three 允许 mesh.material 是数组） */
export function materialsOf(node) {
  const material = node?.material
  if (!material) return []
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

/**
 * 收集材质引用的所有贴图。
 * 不写死插槽名（map/normalMap/...），而是扫描所有 `isTexture` 属性，
 * 这样自定义着色器材质与未来新增插槽也能被正确释放/统计。
 */
export function collectTextures(material, sink) {
  if (!material) return sink
  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      sink.add(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item?.isTexture) sink.add(item)
      }
    }
  }
  return sink
}
