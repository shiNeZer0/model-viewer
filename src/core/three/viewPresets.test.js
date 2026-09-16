import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW_PRESET,
  VIEW_PRESETS,
  computeCameraPlacement,
  computeViewDistance,
  normalizeDirection,
  resolveViewPreset,
} from './viewPresets.js'

describe('VIEW_PRESETS', () => {
  it('id 唯一，且包含 6 个正交视图与等轴测', () => {
    const ids = VIEW_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'])
  })

  it('resolveViewPreset 未命中返回 null', () => {
    expect(resolveViewPreset('front')?.label).toBe('前视图')
    expect(resolveViewPreset('nope')).toBe(null)
    expect(resolveViewPreset(undefined)).toBe(null)
  })
})

describe('normalizeDirection', () => {
  it('输出单位向量', () => {
    const [x, y, z] = normalizeDirection([2, 0, 0])
    expect([x, y, z]).toEqual([1, 0, 0])
    expect(Math.hypot(...normalizeDirection([1, 0.62, 1]))).toBeCloseTo(1, 10)
  })

  it('零向量/非法输入回退到等轴测方向，绝不产生 NaN', () => {
    for (const input of [[0, 0, 0], null, [1, Number.NaN, 2], 'nope']) {
      const result = normalizeDirection(input)
      expect(result.every((value) => Number.isFinite(value))).toBe(true)
      expect(Math.hypot(...result)).toBeCloseTo(1, 10)
    }
  })
})

describe('computeViewDistance', () => {
  it('距离随半径线性增长', () => {
    const small = computeViewDistance(1, 50, 1.6)
    const large = computeViewDistance(2, 50, 1.6)
    expect(large / small).toBeCloseTo(2, 6)
  })

  it('窄窗口（aspect < 1）取水平视角，距离比宽窗口更远', () => {
    const wide = computeViewDistance(1, 50, 2)
    const narrow = computeViewDistance(1, 50, 0.5)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('padding 放大距离，非法值不破坏结果', () => {
    const base = computeViewDistance(1, 50, 1.6, 1)
    expect(computeViewDistance(1, 50, 1.6, 2)).toBeCloseTo(base * 2, 6)
    expect(Number.isFinite(computeViewDistance(1, 50, 1.6, Number.NaN))).toBe(true)
    expect(Number.isFinite(computeViewDistance(0, 50, 1.6))).toBe(true)
  })

  it('非法 fov（缺省/NaN/0/超范围）回退到默认值，绝不产生 NaN', () => {
    for (const fov of [undefined, Number.NaN, 0, -10, 200]) {
      expect(Number.isFinite(computeViewDistance(1, fov, 1.6))).toBe(true)
    }
    expect(computeViewDistance(1, undefined, 1.6)).toBeCloseTo(
      computeViewDistance(1, 50, 1.6),
      10,
    )
  })
})

describe('computeCameraPlacement', () => {
  const base = { center: { x: 1, y: 2, z: 3 }, radius: 2, fovDeg: 50, aspect: 1.6 }

  it('前视图把相机放在 +Z 方向', () => {
    const placement = computeCameraPlacement({ ...base, presetId: 'front' })
    expect(placement.position[0]).toBeCloseTo(1, 6)
    expect(placement.position[1]).toBeCloseTo(2, 6)
    expect(placement.position[2]).toBeGreaterThan(3)
  })

  it('顶视图把相机放到上方', () => {
    const placement = computeCameraPlacement({ ...base, presetId: 'top' })
    expect(placement.position[1]).toBeGreaterThan(2)
    expect(placement.position[1] - 2).toBeCloseTo(placement.distance, 3)
  })

  it('未指定或非法预设时回退到默认预设', () => {
    expect(computeCameraPlacement(base).presetId).toBe(DEFAULT_VIEW_PRESET)
    expect(computeCameraPlacement({ ...base, presetId: 'nope' }).presetId).toBe(DEFAULT_VIEW_PRESET)
  })

  it('兼容数组形式的中心点，且缺省参数不产生 NaN', () => {
    const placement = computeCameraPlacement({ center: [0, 0, 0], radius: 1, fovDeg: 45, aspect: 1 })
    expect(placement.position.every((value) => Number.isFinite(value))).toBe(true)
    const empty = computeCameraPlacement()
    expect(empty.position.every((value) => Number.isFinite(value))).toBe(true)
  })
})
