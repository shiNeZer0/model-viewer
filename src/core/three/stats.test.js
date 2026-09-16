import { describe, expect, it } from 'vitest'

import { collectModelStats, emptyStats } from './stats.js'

/** 极简 three 替身：只保留统计逻辑用到的鸭子类型标记与属性 */
function fakeMesh({ vertices = 3, index = null, material = null, skinned = false } = {}) {
  return {
    isMesh: !skinned,
    isSkinnedMesh: skinned,
    geometry: {
      attributes: { position: { count: vertices } },
      index: index === null ? null : { count: index },
    },
    material,
  }
}

function fakeTree(children) {
  return {
    children,
    traverse(callback) {
      callback(this)
      for (const child of children) {
        // 叶子节点没有 traverse（three 的 Object3D 有），两种情况都要能遍历到
        if (typeof child.traverse === 'function') child.traverse(callback)
        else callback(child)
      }
    },
  }
}

describe('collectModelStats', () => {
  it('空树返回空统计', () => {
    expect(collectModelStats(null)).toEqual(emptyStats())
  })

  it('无索引几何体按顶点数 / 3 计面', () => {
    const root = fakeTree([fakeMesh({ vertices: 36 })])
    const stats = collectModelStats(root)
    expect(stats.meshCount).toBe(1)
    expect(stats.vertexCount).toBe(36)
    expect(stats.triangleCount).toBe(12)
  })

  it('有索引几何体按索引数 / 3 计面，且不影响顶点数', () => {
    const root = fakeTree([fakeMesh({ vertices: 8, index: 36 })])
    const stats = collectModelStats(root)
    expect(stats.vertexCount).toBe(8)
    expect(stats.triangleCount).toBe(12)
  })

  it('索引数不是 3 的倍数时向下取整', () => {
    const root = fakeTree([fakeMesh({ vertices: 5, index: 8 })])
    expect(collectModelStats(root).triangleCount).toBe(2)
  })

  it('多点/线节点不计入面数，但计入各自数量', () => {
    const root = fakeTree([
      { isPoints: true, geometry: { attributes: { position: { count: 100 } } } },
      { isLine: true, geometry: { attributes: { position: { count: 20 } } } },
    ])
    const stats = collectModelStats(root)
    expect(stats.pointCount).toBe(1)
    expect(stats.lineCount).toBe(1)
    expect(stats.meshCount).toBe(0)
    expect(stats.triangleCount).toBe(0)
  })

  it('材质与贴图去重统计，贴图插槽名不限', () => {
    const sharedTexture = { isTexture: true }
    const sharedMaterial = { map: sharedTexture, normalMap: sharedTexture, color: { r: 1 } }
    const root = fakeTree([
      fakeMesh({ material: sharedMaterial }),
      fakeMesh({ material: sharedMaterial }),
      fakeMesh({ material: [{ roughnessMap: { isTexture: true } }] }),
    ])
    const stats = collectModelStats(root)
    expect(stats.materialCount).toBe(2)
    expect(stats.textureCount).toBe(2)
  })

  it('骨骼网格被识别，动画数由外部传入', () => {
    const root = fakeTree([fakeMesh({ skinned: true })])
    const stats = collectModelStats(root, { animationCount: 3 })
    expect(stats.hasSkin).toBe(true)
    expect(stats.animationCount).toBe(3)
    // 骨骼网格同样计入 meshCount，避免"看起来没有网格"
    expect(stats.meshCount).toBe(1)
  })

  it('缺少 geometry 的节点不会抛错', () => {
    const root = fakeTree([{ isMesh: true }])
    const stats = collectModelStats(root)
    expect(stats.meshCount).toBe(1)
    expect(stats.vertexCount).toBe(0)
  })
})
