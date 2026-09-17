import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SHADE_MODE,
  EDGE_THRESHOLD_DEG,
  SHADE_MODES,
  ShadeController,
  createCheckerTexture,
  hidesSolid,
  needsWireframeOverlay,
  overridesMaterial,
  resolveShadeMode,
  triangleCountOf,
} from './shadeModes.js'

/** 造一个带材质的网格（three 的几何/材质在 Node 下可直接构造，无需 WebGL） */
function buildMesh(geometry = new BoxGeometry(), material = new MeshStandardMaterial()) {
  const root = new Group()
  const mesh = new Mesh(geometry, material)
  root.add(mesh)
  return { root, mesh }
}

describe('SHADE_MODES', () => {
  it('共 8 种模式且 id 唯一、可解析', () => {
    const ids = SHADE_MODES.map((mode) => mode.id)
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    for (const id of ids) expect(resolveShadeMode(id)?.label).toBeTruthy()
  })

  it('未知 id 返回 null（由调用方回退到默认模式）', () => {
    expect(resolveShadeMode('nope')).toBe(null)
    expect(resolveShadeMode(undefined)).toBe(null)
    expect(DEFAULT_SHADE_MODE).toBe('shaded')
  })

  it('线框/隐藏实体/材质覆盖的判定表', () => {
    expect(needsWireframeOverlay('shadedWire')).toBe(true)
    expect(needsWireframeOverlay('wire')).toBe(true)
    expect(needsWireframeOverlay('shaded')).toBe(false)

    expect(hidesSolid('wire')).toBe(true)
    expect(hidesSolid('shadedWire')).toBe(false)

    expect(overridesMaterial('shaded')).toBe(false)
    expect(overridesMaterial('clay')).toBe(true)
    expect(overridesMaterial('normal')).toBe(true)
  })
})

describe('triangleCountOf', () => {
  it('有索引取索引数、无索引取顶点数', () => {
    const indexed = new BoxGeometry() // BoxGeometry 自带索引
    expect(triangleCountOf(indexed)).toBe(12)

    const nonIndexed = new PlaneGeometry(1, 1, 1, 1).toNonIndexed()
    expect(triangleCountOf(nonIndexed)).toBe(2)

    expect(triangleCountOf(null)).toBe(0)
    expect(triangleCountOf({ attributes: {} })).toBe(0)
  })
})

describe('createCheckerTexture', () => {
  it('Node（无 DOM）环境下返回 null 而不是抛错', () => {
    expect(createCheckerTexture()).toBe(null)
  })
})

describe('ShadeController', () => {
  it('flat 模式克隆材质并开启平面着色，切回后完全还原', () => {
    const { root, mesh } = buildMesh()
    const original = mesh.material
    const controller = new ShadeController(root)

    controller.apply('flat')
    expect(mesh.material).not.toBe(original)
    expect(mesh.material.flatShading).toBe(true)
    expect(original.flatShading).toBe(false) // 原始材质不被污染

    controller.apply('shaded')
    expect(mesh.material).toBe(original)
    controller.dispose()
  })

  it('clay 模式使用共享黏土材质（多个网格共用一份）', () => {
    const root = new Group()
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    root.add(a, b)

    const controller = new ShadeController(root)
    controller.apply('clay')
    expect(a.material).toBe(b.material)
    expect(a.material.name).toBe('mv-shade-clay')

    controller.apply('shaded')
    expect(a.material).not.toBe(b.material)
    controller.dispose()
  })

  it('顶点色缺失时给出提示且不改动材质', () => {
    const { root, mesh } = buildMesh()
    const original = mesh.material
    const controller = new ShadeController(root)

    const warnings = controller.apply('vertexColor')
    expect(warnings.join()).toContain('顶点颜色')
    expect(mesh.material).toBe(original)
    controller.dispose()
  })

  it('UV 缺失时给出提示', () => {
    const { root } = buildMesh()
    const controller = new ShadeController(root)
    // BoxGeometry 自带 uv：不应出现「没有 UV 坐标」的提示
    const warnings = controller.apply('uv')
    expect(warnings.some((item) => item.includes('没有 UV 坐标'))).toBe(false)

    const geometry = new BoxGeometry()
    geometry.deleteAttribute('uv')
    const { root: root2 } = buildMesh(geometry)
    const controller2 = new ShadeController(root2)
    expect(controller2.apply('uv').join()).toContain('没有 UV 坐标')
    controller.dispose()
    controller2.dispose()
  })

  it('线框叠加：生成 LineSegments 并挂在父节点上（可见性不归它管）', () => {
    const { root, mesh } = buildMesh()
    const controller = new ShadeController(root)

    controller.apply('shadedWire')
    expect(root.children.filter((child) => child.isLineSegments)).toHaveLength(1)

    controller.apply('wire')
    // 线框挂在父节点（root）上，因此「仅线框」隐藏 mesh 不会连带隐藏线框
    expect(root.children.filter((child) => child.isLineSegments)).toHaveLength(1)

    controller.apply('shaded')
    expect(root.children.filter((child) => child.isLineSegments)).toHaveLength(0)
    controller.dispose()
  })

  it('绝不修改节点可见性（交给 visibility.js 统一解析，避免与用户开关打架）', () => {
    const { root, mesh } = buildMesh()
    const controller = new ShadeController(root)

    for (const mode of ['shadedWire', 'wire', 'clay', 'flat', 'shaded']) {
      controller.apply(mode)
      expect(mesh.visible).toBe(true)
    }
    controller.dispose()
  })

  it('切模式时不留残留线框（幂等）', () => {
    const { root } = buildMesh()
    const controller = new ShadeController(root)
    controller.apply('wire')
    controller.apply('wire')
    controller.apply('shadedWire')
    expect(root.children.filter((child) => child.isLineSegments)).toHaveLength(1)
    controller.dispose()
  })

  it('超过 fullLimit 退化为结构边，超过 hardLimit 直接跳过并提示', () => {
    const { root } = buildMesh()

    const softController = new ShadeController(root, { wireframeTriangleLimit: 6 })
    const softWarnings = softController.apply('wire')
    expect(softWarnings.join()).toContain(String(EDGE_THRESHOLD_DEG))
    softController.dispose()

    const hardController = new ShadeController(root, { wireframeHardLimit: 6 })
    const hardWarnings = hardController.apply('wire')
    expect(hardWarnings.join()).toContain('已跳过线框生成')
    expect(root.children.filter((child) => child.isLineSegments)).toHaveLength(0)
    hardController.dispose()
  })

  it('模型自带隐藏节点不会被模式切换"点亮"（控制器不动 visible）', () => {
    const { root, mesh } = buildMesh()
    mesh.visible = false
    const controller = new ShadeController(root)

    for (const mode of ['clay', 'wire', 'shaded']) {
      controller.apply(mode)
      expect(mesh.visible).toBe(false)
    }
    controller.dispose()
  })

  it('数组材质的网格在 flat 模式下逐个克隆', () => {
    const material = [new MeshStandardMaterial(), new MeshStandardMaterial()]
    const { root, mesh } = buildMesh(new BoxGeometry(), material)
    const controller = new ShadeController(root)

    controller.apply('flat')
    expect(Array.isArray(mesh.material)).toBe(true)
    expect(mesh.material).toHaveLength(2)
    expect(mesh.material.every((item) => item.flatShading)).toBe(true)

    controller.apply('shaded')
    expect(mesh.material).toBe(material)
    controller.dispose()
  })
})
