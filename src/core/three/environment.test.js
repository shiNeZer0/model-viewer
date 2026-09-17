import { describe, expect, it } from 'vitest'

import { GRADIENT_TEXTURE_SIZE, EnvironmentManager, createGradientEquirectData, environmentCacheKey } from './environment.js'

/** 取第 y 行第一列像素的亮度（线性值） */
function rowLuma(result, y) {
  const index = y * result.width * 4
  return result.data[index] + result.data[index + 1] + result.data[index + 2]
}

describe('createGradientEquirectData', () => {
  it('生成 RGBA 浮点数据，尺寸与 alpha 正确', () => {
    const result = createGradientEquirectData({ width: 8, height: 4 })
    expect(result.width).toBe(8)
    expect(result.height).toBe(4)
    expect(result.data).toBeInstanceOf(Float32Array)
    expect(result.data.length).toBe(8 * 4 * 4)
    // alpha 必须为 1，否则环境贴图会出现透明伪影
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(1)
    }
  })

  it('自上而下由亮到暗（天顶 → 地平线 → 地面）', () => {
    const result = createGradientEquirectData({
      topColor: '#ffffff',
      horizonColor: '#808080',
      bottomColor: '#000000',
      width: 4,
      height: 9,
    })
    const top = rowLuma(result, 0)
    const middle = rowLuma(result, 4)
    const bottom = rowLuma(result, 8)
    expect(top).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(bottom)
  })

  it('同一行内所有像素一致（只有竖直渐变）', () => {
    const result = createGradientEquirectData({ width: 6, height: 3 })
    for (let y = 0; y < result.height; y += 1) {
      const first = rowLuma(result, y)
      for (let x = 1; x < result.width; x += 1) {
        const index = (y * result.width + x) * 4
        expect(result.data[index] + result.data[index + 1] + result.data[index + 2]).toBeCloseTo(first, 5)
      }
    }
  })

  it('非法尺寸与非法颜色不抛错（回退到默认）', () => {
    const result = createGradientEquirectData({ width: 0, height: Number.NaN })
    expect(result.width).toBe(GRADIENT_TEXTURE_SIZE.width)
    expect(result.height).toBe(GRADIENT_TEXTURE_SIZE.height)

    const bad = createGradientEquirectData({ topColor: 'not-a-color', width: 2, height: 2 })
    expect(bad.data.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('高度为 1 时不产生 NaN', () => {
    const result = createGradientEquirectData({ height: 1, width: 2 })
    expect(result.data.every((value) => Number.isFinite(value))).toBe(true)
  })
})

describe('environmentCacheKey', () => {
  it('颜色或来源变化会换 key（用于避免重复生成 PMREM）', () => {
    const base = { source: 'gradient', topColor: '#fff', horizonColor: '#888', bottomColor: '#000' }
    expect(environmentCacheKey(base)).toBe(environmentCacheKey({ ...base }))
    expect(environmentCacheKey(base)).not.toBe(environmentCacheKey({ ...base, topColor: '#eee' }))
    expect(environmentCacheKey(base)).not.toBe(environmentCacheKey({ ...base, source: 'room' }))
  })
})

describe('EnvironmentManager', () => {
  it('缺少渲染器或场景时立即报错（fail fast）', () => {
    expect(() => new EnvironmentManager(null, {})).toThrow()
    expect(() => new EnvironmentManager({}, null)).toThrow()
  })
})
