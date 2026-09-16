import { Box3, Group, Mesh, BoxGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { ModelPlacement, computePlacementOffset } from './modelPlacement.js'

/** 造一个"原点不在几何中心"的模型：这是导出模型最常见的情形 */
function buildOffsetModel({ position = [10, 5, -3], size = 2 } = {}) {
  const root = new Group()
  const mesh = new Mesh(new BoxGeometry(size, size, size))
  mesh.position.set(...position)
  root.add(mesh)
  return root
}

describe('computePlacementOffset', () => {
  const box = new Box3(new Vector3(10, 5, -3), new Vector3(14, 9, 1)) // 中心(12,7,-1)，min.y=5

  it('居中 + 贴地：X/Z 移到原点，底部落到 y=0', () => {
    const offset = computePlacementOffset(box, { center: true, ground: true })
    expect(offset.x).toBeCloseTo(-12, 6)
    expect(offset.y).toBeCloseTo(-5, 6)
    expect(offset.z).toBeCloseTo(1, 6)
  })

  it('居中但不贴地：三轴都居中', () => {
    const offset = computePlacementOffset(box, { center: true, ground: false })
    expect(offset.toArray()).toEqual([-12, -7, 1])
  })

  it('不居中只贴地：仅调整 Y', () => {
    const offset = computePlacementOffset(box, { center: false, ground: true })
    expect(offset.toArray()).toEqual([0, -5, 0])
  })

  it('都不开：不产生任何位移', () => {
    const offset = computePlacementOffset(box, { center: false, ground: false })
    expect(offset.toArray()).toEqual([0, 0, 0])
  })

  it('空包围盒返回零位移而不是 NaN', () => {
    const empty = new Box3()
    expect(computePlacementOffset(empty).toArray()).toEqual([0, 0, 0])
    expect(computePlacementOffset(null).toArray()).toEqual([0, 0, 0])
  })
})

describe('ModelPlacement', () => {
  it('居中贴地后：包围盒中心在 X/Z=0，底部在 y=0', () => {
    const root = buildOffsetModel()
    root.updateWorldMatrix(true, true)
    const placement = new ModelPlacement(root)

    const box = placement.apply({ center: true, ground: true })
    const center = box.getCenter(new Vector3())
    expect(center.x).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    // 尺寸不变（只平移，不缩放）
    const size = box.getSize(new Vector3())
    expect(size.x).toBeCloseTo(2, 6)
    expect(size.y).toBeCloseTo(2, 6)
  })

  it('反复应用不漂移（幂等）', () => {
    const root = buildOffsetModel()
    root.updateWorldMatrix(true, true)
    const placement = new ModelPlacement(root)

    const first = placement.apply({ center: true, ground: true })
    const second = placement.apply({ center: true, ground: true })
    const third = placement.apply({ center: true, ground: true })

    for (const box of [second, third]) {
      expect(box.min.x).toBeCloseTo(first.min.x, 10)
      expect(box.min.y).toBeCloseTo(first.min.y, 10)
      expect(box.min.z).toBeCloseTo(first.min.z, 10)
    }
  })

  it('关闭开关能把模型完整还原到原始坐标', () => {
    const root = buildOffsetModel()
    root.updateWorldMatrix(true, true)
    const originalPosition = root.position.clone()
    const placement = new ModelPlacement(root)

    placement.apply({ center: true, ground: true })
    expect(placement.isPristine).toBe(false)

    const restored = placement.apply({ center: false, ground: false })
    expect(root.position.equals(originalPosition)).toBe(true)
    expect(placement.isPristine).toBe(true)
    // 还原后包围盒回到原位（模型自带偏移 10,5,-3，几何半边长 1）
    expect(restored.min.x).toBeCloseTo(9, 6)
    expect(restored.min.y).toBeCloseTo(4, 6)
    expect(restored.min.z).toBeCloseTo(-4, 6)
  })

  it('开关来回切换不会累积偏移', () => {
    const root = buildOffsetModel()
    root.updateWorldMatrix(true, true)
    const placement = new ModelPlacement(root)

    const on = placement.apply({ center: true, ground: true })
    placement.apply({ center: false, ground: false })
    const onAgain = placement.apply({ center: true, ground: true })

    expect(onAgain.min.x).toBeCloseTo(on.min.x, 10)
    expect(onAgain.min.y).toBeCloseTo(on.min.y, 10)
    expect(onAgain.min.z).toBeCloseTo(on.min.z, 10)
  })

  it('只居中不贴地时 Y 也居中', () => {
    const root = buildOffsetModel()
    root.updateWorldMatrix(true, true)
    const placement = new ModelPlacement(root)
    const box = placement.apply({ center: true, ground: false })
    const center = box.getCenter(new Vector3())
    expect(center.y).toBeCloseTo(0, 6)
  })

  it('模型自带旋转/缩放时仍然正确（平移量在世界空间计算）', () => {
    const root = buildOffsetModel()
    root.children[0].rotation.set(0.4, 0.9, 0)
    root.children[0].scale.setScalar(3)
    root.updateWorldMatrix(true, true)

    const placement = new ModelPlacement(root)
    const box = placement.apply({ center: true, ground: true })
    const center = box.getCenter(new Vector3())
    expect(center.x).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
  })

  it('空对象返回 null 且不抛错', () => {
    const empty = new Group()
    empty.updateWorldMatrix(true, true)
    const placement = new ModelPlacement(empty)
    expect(placement.apply()).toBe(null)
    expect(() => new ModelPlacement(null)).toThrow()
  })
})
