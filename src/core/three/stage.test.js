import { Box3, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_MODE,
  Stage,
  niceGridSize,
  resolveBackgroundMode,
} from './stage.js'

describe('阴影接收面', () => {
  it('按开关补建与隐藏，并接收阴影', () => {
    const scene = new Scene()
    const stage = new Stage(scene)

    stage.setHelpers({ showAxes: false, showShadow: false })
    expect(stage.shadowCatcher).toBe(null)

    stage.setHelpers({ showAxes: false, showShadow: true })
    expect(stage.shadowCatcher).not.toBe(null)
    expect(stage.shadowCatcher.receiveShadow).toBe(true)
    expect(stage.shadowCatcher.visible).toBe(true)
    expect(scene.children).toContain(stage.shadowCatcher)

    stage.setHelpers({ showAxes: false, showShadow: false })
    expect(stage.shadowCatcher.visible).toBe(false)

    stage.dispose()
  })

  it('贴到模型地面高度；网格尺寸变化后重建而不是留着旧尺寸', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setHelpers({ showAxes: false, showShadow: true })

    stage.fitToBox(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)))
    expect(stage.shadowCatcher.position.y).toBeCloseTo(0, 5)
    const first = stage.shadowCatcher

    // 网格尺寸变了会走 rebuildHelpers：接收面必须按新尺寸重建，且可见性按意图恢复
    stage.fitToBox(new Box3(new Vector3(-100, 0, -100), new Vector3(100, 200, 100)))
    expect(stage.shadowCatcher).not.toBe(first)
    expect(stage.shadowCatcher.visible).toBe(true)
    expect(stage.shadowCatcher.scale.x).toBeGreaterThan(0)
    expect(stage.shadowCatcher.position.y).toBeCloseTo(0, 5)

    stage.dispose()
  })

  it('dispose 后场景里不残留接收面', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setHelpers({ showAxes: false, showShadow: true })
    expect(scene.children.length).toBeGreaterThan(0)

    stage.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

describe('niceGridSize', () => {
  it('取整到 1/2/5 × 10^n', () => {
    expect(niceGridSize(1.5)).toBe(2)
    expect(niceGridSize(1)).toBe(1)
    expect(niceGridSize(3)).toBe(5)
    expect(niceGridSize(7)).toBe(10)
    expect(niceGridSize(1500)).toBe(2000)
    expect(niceGridSize(0.0015)).toBe(0.002)
  })

  it('非法输入回退到 10', () => {
    expect(niceGridSize(0)).toBe(10)
    expect(niceGridSize(-5)).toBe(10)
    expect(niceGridSize(Number.NaN)).toBe(10)
    expect(niceGridSize(undefined)).toBe(10)
  })
})

describe('resolveBackgroundMode', () => {
  it('解析已知模式，未知返回 null', () => {
    expect(resolveBackgroundMode('solid')?.id).toBe('solid')
    expect(resolveBackgroundMode('gradient')?.id).toBe('gradient')
    expect(resolveBackgroundMode('transparent')?.id).toBe('transparent')
    expect(resolveBackgroundMode('nope')).toBe(null)
    expect(resolveBackgroundMode(undefined)).toBe(null)
  })
})

describe('Stage 背景', () => {
  it('纯色模式写入 scene.background', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    expect(stage.setBackground({ mode: 'solid', color: '#123456' })).toBe('solid')
    expect(scene.background?.isColor).toBe(true)
    expect(scene.background.getHexString()).toBe('123456')
    stage.dispose()
  })

  it('透明模式把背景置空，供 CSS 棋盘显示', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setBackground({ mode: 'solid', color: DEFAULT_BACKGROUND_COLOR })
    expect(scene.background).not.toBe(null)
    stage.setBackground({ mode: 'transparent' })
    expect(scene.background).toBe(null)
    stage.dispose()
  })

  it('非法模式回退到默认模式', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    expect(stage.setBackground({ mode: 'nope' })).toBe(DEFAULT_BACKGROUND_MODE)
    stage.dispose()
  })

  it('无 DOM 环境生成不了渐变纹理时，回退为纯色而不是留下 null 背景', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setBackground({ mode: 'gradient', color: '#0a0b0c', gradientTop: '#fff', gradientBottom: '#000' })
    // Node 下 createGradientTexture 返回 null：不能把背景留成 null（否则看起来像"什么都没设置"）
    expect(scene.background).not.toBe(null)
    stage.dispose()
  })
})

describe('Stage 辅助显示（网格 / 坐标轴）', () => {
  it('开启网格才创建，关闭是隐藏而不是销毁', () => {
    const scene = new Scene()
    const stage = new Stage(scene)

    stage.setHelpers({ showGrid: false, showAxes: true })
    expect(stage.grid).toBe(null)
    expect(stage.axes).toBeTruthy()
    expect(stage.axes.visible).toBe(true)

    stage.setHelpers({ showGrid: true, showAxes: true })
    expect(stage.grid).toBeTruthy()
    expect(stage.grid.visible).toBe(true)
    expect(scene.children).toContain(stage.grid)

    stage.setHelpers({ showGrid: false, showAxes: false })
    expect(stage.grid.visible).toBe(false)
    expect(stage.axes.visible).toBe(false)
    // 隐藏保留对象：再次开启无需重建几何
    expect(scene.children).toContain(stage.grid)
    stage.dispose()
  })

  it('模型加载后（尺寸重建）开关依然有效，且重建不会让"关着的"辅助显示复活', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setHelpers({ showGrid: true, showAxes: true })

    const box = new Box3().setFromCenterAndSize(new Vector3(0, 0, 0), new Vector3(100, 50, 100))
    stage.fitToBox(box)

    expect(stage.gridSize).toBe(niceGridSize(150))
    expect(stage.grid).toBeTruthy()
    expect(stage.grid.visible).toBe(true)
    expect(stage.axes.visible).toBe(true)
    // 网格与坐标轴落到模型底部
    expect(stage.grid.position.y).toBeCloseTo(box.min.y, 6)
    expect(stage.axes.position.y).toBeCloseTo(box.min.y, 6)

    stage.setHelpers({ showGrid: false, showAxes: false })
    expect(stage.grid.visible).toBe(false)
    expect(stage.axes.visible).toBe(false)

    stage.setHelpers({ showGrid: true, showAxes: true })
    expect(stage.grid.visible).toBe(true)
    expect(stage.axes.visible).toBe(true)
    stage.dispose()
  })

  it('先加载模型、后开启网格时能按模型尺寸创建（这是最常用的操作顺序）', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setHelpers({ showGrid: false, showAxes: true })

    const box = new Box3().setFromCenterAndSize(new Vector3(0, 0, 0), new Vector3(100, 50, 100))
    stage.fitToBox(box)
    expect(stage.grid).toBe(null)

    stage.setHelpers({ showGrid: true, showAxes: true })
    expect(stage.grid).toBeTruthy()
    expect(stage.grid.visible).toBe(true)
    expect(scene.children).toContain(stage.grid)
    expect(stage.grid.position.y).toBeCloseTo(box.min.y, 6)
    stage.dispose()
  })

  it('关掉的坐标轴在加载模型后不会自己复活（意图优先于几何重建）', () => {
    const scene = new Scene()
    const stage = new Stage(scene)

    // 引擎构造时会先开启坐标轴，这里模拟"用户随后把它关掉"
    stage.setHelpers({ showGrid: false, showAxes: true })
    expect(stage.axes.visible).toBe(true)
    stage.setHelpers({ showGrid: false, showAxes: false })
    expect(stage.axes.visible).toBe(false)

    // 加载模型（尺寸变化触发重建）
    const box = new Box3().setFromCenterAndSize(new Vector3(0, 0, 0), new Vector3(100, 50, 100))
    stage.fitToBox(box)
    expect(stage.axes?.visible ?? false).toBe(false)
    expect(stage.grid).toBe(null)

    // 再换一个尺寸不同的模型，仍然必须保持关闭
    const bigger = new Box3().setFromCenterAndSize(new Vector3(0, 0, 0), new Vector3(900, 100, 900))
    stage.fitToBox(bigger)
    expect(stage.axes?.visible ?? false).toBe(false)
    stage.dispose()
  })

  it('dispose 后场景里不再残留网格/坐标轴', () => {
    const scene = new Scene()
    const stage = new Stage(scene)
    stage.setHelpers({ showGrid: true, showAxes: true })
    const names = scene.children.map((child) => child.name)
    expect(names).toContain('mv-grid')
    expect(names).toContain('mv-axes')

    stage.dispose()
    const after = scene.children.map((child) => child.name)
    expect(after).not.toContain('mv-grid')
    expect(after).not.toContain('mv-axes')
  })
})
