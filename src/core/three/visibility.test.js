import { BoxGeometry, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, Points, PointsMaterial } from 'three'
import { describe, expect, it } from 'vitest'

import { applyVisibility, captureVisibility, resolveNodeVisibility } from './visibility.js'

function buildModel() {
  const root = new Group()
  const meshA = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  const meshB = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  const points = new Points(new BoxGeometry(), new PointsMaterial())
  const line = new Line(new BoxGeometry(), new LineBasicMaterial())
  root.add(meshA, meshB, points, line)
  return { root, meshA, meshB, points, line }
}

describe('resolveNodeVisibility', () => {
  it('用户开关优先于模型原始可见性', () => {
    expect(resolveNodeVisibility({ originalVisible: true, userOverride: false })).toBe(false)
    expect(resolveNodeVisibility({ originalVisible: false, userOverride: true })).toBe(true)
  })

  it('没有用户开关时沿用原始可见性，都没有则默认可见', () => {
    expect(resolveNodeVisibility({ originalVisible: false })).toBe(false)
    expect(resolveNodeVisibility({ originalVisible: true })).toBe(true)
    expect(resolveNodeVisibility({})).toBe(true)
  })

  it('仅线框模式只隐藏实体网格，点云与线不受影响', () => {
    expect(resolveNodeVisibility({ isMesh: true, hideSolids: true })).toBe(false)
    expect(resolveNodeVisibility({ isMesh: false, hideSolids: true })).toBe(true)
    // 用户显式隐藏的点云仍然是隐藏的
    expect(resolveNodeVisibility({ isMesh: false, hideSolids: true, userOverride: false })).toBe(false)
  })

  it('仅线框不能覆盖"用户显式隐藏"以外的语义（隐藏仍是隐藏）', () => {
    expect(resolveNodeVisibility({ isMesh: true, hideSolids: true, userOverride: true })).toBe(false)
  })
})

describe('applyVisibility', () => {
  it('用户隐藏的网格在模式切回后仍然隐藏（这是最容易踩的坑）', () => {
    const { root, meshA, meshB } = buildModel()
    const originals = captureVisibility(root)
    const overrides = new Map([[meshA, false]])

    // 切到「仅线框」：全部实体隐藏
    applyVisibility(root, { overrides, originals, hideSolids: true })
    expect(meshA.visible).toBe(false)
    expect(meshB.visible).toBe(false)

    // 切回实体：用户手动隐藏的 A 必须保持隐藏，B 恢复可见
    applyVisibility(root, { overrides, originals, hideSolids: false })
    expect(meshA.visible).toBe(false)
    expect(meshB.visible).toBe(true)
  })

  it('模型自带的隐藏节点始终保持隐藏', () => {
    const { root, meshA } = buildModel()
    meshA.visible = false
    const originals = captureVisibility(root)

    applyVisibility(root, { originals, hideSolids: false })
    expect(meshA.visible).toBe(false)

    applyVisibility(root, { originals, hideSolids: true })
    expect(meshA.visible).toBe(false)

    applyVisibility(root, { originals, hideSolids: false })
    expect(meshA.visible).toBe(false)
  })

  it('仅线框模式下点云与线保持可见', () => {
    const { root, points, line } = buildModel()
    const originals = captureVisibility(root)
    applyVisibility(root, { originals, hideSolids: true })
    expect(points.visible).toBe(true)
    expect(line.visible).toBe(true)
  })

  it('返回实际变化数，重复调用第二次应为 0（幂等）', () => {
    const { root, meshA } = buildModel()
    const originals = captureVisibility(root)
    const overrides = new Map([[meshA, false]])

    const first = applyVisibility(root, { overrides, originals, hideSolids: false })
    expect(first).toBe(1)
    expect(applyVisibility(root, { overrides, originals, hideSolids: false })).toBe(0)
  })

  it('空根不抛错', () => {
    expect(applyVisibility(null)).toBe(0)
    expect(captureVisibility(null).size).toBe(0)
  })
})
