/**
 * 模型资源释放。
 *
 * 切换模型时若不显式释放，BufferGeometry / Material / Texture 会一直留在显存里，
 * 连续打开几个大模型就会把显存吃光 —— 这是查看器类应用最常见的“越用越卡”根因。
 * 释放后的统计值会被写进日志，便于回归验证（见设计文档 §9 内存用例）。
 */

import { collectTextures, materialsOf } from './material-utils.js'

/**
 * 释放整棵对象树持有的 GPU 资源，并把它从父节点摘除。
 * @returns {{geometries:number, materials:number, textures:number}} 释放数量统计
 */
export function disposeObject3D(root) {
  const report = { geometries: 0, materials: 0, textures: 0 }
  if (!root) return report

  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()

  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry)
    for (const material of materialsOf(node)) {
      materials.add(material)
      collectTextures(material, textures)
    }
    // 骨骼动画的骨架同样持有 GPU 侧的骨骼纹理
    if (node.isSkinnedMesh && node.skeleton) {
      try {
        node.skeleton.dispose()
      } catch (error) {
        console.warn('[disposal] 释放骨架失败', error)
      }
    }
  })

  for (const geometry of geometries) {
    geometry.dispose()
    report.geometries += 1
  }
  for (const material of materials) {
    material.dispose()
    report.materials += 1
  }
  for (const texture of textures) {
    texture.dispose()
    report.textures += 1
  }

  if (typeof root.removeFromParent === 'function') {
    root.removeFromParent()
  }

  return report
}
