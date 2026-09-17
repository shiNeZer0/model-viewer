import { describe, expect, it } from 'vitest'

import {
  GRADIENT_TEXTURE_SIZE,
  EnvironmentManager,
  createGradientEquirectData,
  environmentCacheKey,
  resolveEnvironmentPlan,
} from './environment.js'

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

describe('resolveEnvironmentPlan（M6-5 导入环境贴图的选择逻辑）', () => {
  it('三种程序化来源直接透传', () => {
    expect(resolveEnvironmentPlan({ source: 'gradient' }).kind).toBe('gradient')
    expect(resolveEnvironmentPlan({ source: 'room' }).kind).toBe('room')
    expect(resolveEnvironmentPlan({ source: 'none' }).kind).toBe('none')
    // 非法来源退回渐变（与 normalizeLightingState 的兜底一致）
    expect(resolveEnvironmentPlan({ source: 'weird' }).kind).toBe('gradient')
  })

  it('导入的贴图已登记时用 imported，缓存键跟 URL 走', () => {
    const environment = { source: 'imported', customHdrUrl: 'asset://localhost/env/studio.hdr' }
    const plan = resolveEnvironmentPlan(environment, { importedReady: true })
    expect(plan.kind).toBe('imported')
    expect(plan.cacheKey).toBe('imported|asset://localhost/env/studio.hdr')
    expect(plan.fellBack).toBe(false)

    // 换一张贴图必须换 key（否则会复用上一张的 PMREM）
    const other = resolveEnvironmentPlan(
      { ...environment, customHdrUrl: 'asset://localhost/env/other.hdr' },
      { importedReady: true },
    )
    expect(other.cacheKey).not.toBe(plan.cacheKey)
  })

  it('贴图还没加载好 / 没有地址时退化为渐变并标记 fellBack（画面不会变黑）', () => {
    const notReady = resolveEnvironmentPlan(
      { source: 'imported', customHdrUrl: 'asset://localhost/env/studio.hdr' },
      { importedReady: false },
    )
    expect(notReady.kind).toBe('gradient')
    expect(notReady.fellBack).toBe(true)

    const noUrl = resolveEnvironmentPlan({ source: 'imported' }, { importedReady: true })
    expect(noUrl.kind).toBe('gradient')
    expect(noUrl.fellBack).toBe(true)
  })
})

describe('EnvironmentManager', () => {
  it('缺少渲染器或场景时立即报错（fail fast）', () => {
    expect(() => new EnvironmentManager(null, {})).toThrow()
    expect(() => new EnvironmentManager({}, null)).toThrow()
  })
})
