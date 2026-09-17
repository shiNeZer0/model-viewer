import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial } from 'three'
import { describe, expect, it } from 'vitest'

import { buildHierarchy, describeNodeType, flattenHierarchy } from './hierarchy.js'
import { collectModelStats } from './stats.js'

function buildNestedModel() {
  const root = new Group()
  root.name = 'Scene'

  const arm = new Group()
  arm.name = 'Arm'
  const meshA = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  meshA.name = 'BoxA'
  const meshB = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  // 故意不给 B 命名，验证占位标签
  arm.add(meshA, meshB)

  const pointCloud = new Points(new BoxGeometry(), new PointsMaterial())

  root.add(arm, pointCloud)
  return { root, arm, meshA, meshB, pointCloud }
}

describe('describeNodeType', () => {
  it('识别常见节点类型', () => {
    expect(describeNodeType(new Mesh())).toBe('网格')
    expect(describeNodeType(new Group())).toBe('组')
    expect(describeNodeType(new Points())).toBe('点云')
    expect(describeNodeType(null)).toBe('对象')
  })
})

describe('buildHierarchy', () => {
  it('保留嵌套结构，节点 id 唯一且能从 Map 取回真实对象', () => {
    const { root, arm, meshA } = buildNestedModel()
    const { nodes, nodeById, count } = buildHierarchy(root)

    // Scene + Arm + BoxA + 无名网格 + 点云 = 5
    expect(count).toBe(5)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].label).toBe('Scene')

    const flat = flattenHierarchy(nodes)
    expect(flat.map((node) => node.label)).toContain('Arm')
    expect(flat.map((node) => node.label)).toContain('BoxA')
    expect(new Set(flat.map((node) => node.id)).size).toBe(flat.length)

    expect(nodeById.get(arm.uuid)).toBe(arm)
    expect(nodeById.get(meshA.uuid)).toBe(meshA)
  })

  it('每个节点的三角面数与整体统计一致（点云/线不计面数）', () => {
    const { root } = buildNestedModel()
    const { nodes } = buildHierarchy(root)
    const flat = flattenHierarchy(nodes)
    const sum = flat.reduce((total, node) => total + node.triangles, 0)
    expect(sum).toBe(collectModelStats(root).triangleCount)

    // 点云节点即使带几何体也不应报出三角面
    const pointNode = flat.find((node) => node.type === '点云')
    expect(pointNode.triangles).toBe(0)
    expect(pointNode.vertices).toBeGreaterThan(0)
  })

  it('无名节点给出可辨识的占位标签', () => {
    const { root } = buildNestedModel()
    const flat = flattenHierarchy(buildHierarchy(root).nodes)
    const unnamed = flat.find((node) => node.type === '网格' && node.label.startsWith('网格 #'))
    expect(unnamed).toBeTruthy()
    expect(unnamed.label).toMatch(/^网格 #[0-9a-f]{4}$/)
  })

  it('记录节点可见性（模型自带隐藏节点）', () => {
    const { root, meshA } = buildNestedModel()
    meshA.visible = false
    const flat = flattenHierarchy(buildHierarchy(root).nodes)
    expect(flat.find((node) => node.label === 'BoxA').visible).toBe(false)
    expect(flat.find((node) => node.label === 'Arm').visible).toBe(true)
  })

  it('skipEmpty 跳过既无几何也无子节点的空节点', () => {
    const root = new Group()
    root.name = 'Root'
    root.add(new Group()) // 空壳节点
    const { nodes, count } = buildHierarchy(root)
    expect(count).toBe(1)
    expect(nodes[0].children).toHaveLength(0)

    const kept = buildHierarchy(root, { skipEmpty: false })
    expect(kept.count).toBe(2)
  })

  it('节点数超过上限时截断并给出标记（防止 el-tree 渲染上万节点卡死）', () => {
    const root = new Group()
    for (let index = 0; index < 20; index += 1) {
      root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
    }
    const { count, truncated } = buildHierarchy(root, { maxNodes: 5 })
    expect(truncated).toBe(true)
    expect(count).toBeLessThanOrEqual(5)
  })

  it('空根返回空结果且不抛错', () => {
    expect(buildHierarchy(null)).toMatchObject({ nodes: [], count: 0, truncated: false })
    expect(buildHierarchy(null).nodeById.size).toBe(0)
    expect(flattenHierarchy(null)).toEqual([])
  })
})
