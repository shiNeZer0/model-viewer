/**
 * 模型统计（纯函数，可在 Node 下单测）。
 *
 * 统计只依赖 three 对象上的鸭子类型标记（isMesh / isSkinnedMesh / isPoints / isLine），
 * 不引入 three 运行时，便于用轻量替身做测试。
 */

import { collectTextures, materialsOf } from './material-utils.js'

/** 空统计对象，避免各处出现 undefined 分支 */
export function emptyStats() {
  return {
    meshCount: 0,
    pointCount: 0,
    lineCount: 0,
    vertexCount: 0,
    triangleCount: 0,
    materialCount: 0,
    textureCount: 0,
    animationCount: 0,
    hasSkin: false,
  }
}

/**
 * 遍历对象树收集统计信息。
 *
 * 三角面数规则：
 * - 有索引 → index.count / 3；
 * - 无索引 → position.count / 3（仅对 Mesh/SkinnedMesh，线/点不计入面数）。
 *
 * @param {object|null} root three 的 Object3D（或结构相同的替身）
 * @param {{animationCount?: number}} options 动画片段数来自 GLTF 解析结果，不在对象树上
 */
export function collectModelStats(root, { animationCount = 0 } = {}) {
  const stats = emptyStats()
  stats.animationCount = animationCount
  if (!root || typeof root.traverse !== 'function') return stats

  const materials = new Set()
  const textures = new Set()

  root.traverse((node) => {
    const isMeshLike = Boolean(node.isMesh || node.isSkinnedMesh)
    if (isMeshLike) stats.meshCount += 1
    else if (node.isPoints) stats.pointCount += 1
    else if (node.isLine || node.isLineSegments) stats.lineCount += 1

    if (node.isSkinnedMesh) stats.hasSkin = true

    const geometry = node.geometry
    const position = geometry?.attributes?.position
    if (position?.count) stats.vertexCount += position.count

    if (isMeshLike && position?.count) {
      const indexCount = geometry?.index?.count
      stats.triangleCount += Math.floor((indexCount ?? position.count) / 3)
    }

    for (const material of materialsOf(node)) {
      materials.add(material)
      collectTextures(material, textures)
    }
  })

  stats.materialCount = materials.size
  stats.textureCount = textures.size
  return stats
}
