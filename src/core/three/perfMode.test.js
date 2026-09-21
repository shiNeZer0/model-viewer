import { describe, expect, it } from 'vitest'

import { DEFAULT_POSTFX_SAMPLES } from './postfx.js'
import {
  DEFAULT_MAX_PIXEL_RATIO,
  LOW_PERFORMANCE_PIXEL_RATIO,
  LOW_PERFORMANCE_SAMPLES,
  resolveAntialias,
  resolvePixelRatioLimit,
  resolvePostFxSamples,
} from './perfMode.js'

describe('resolvePixelRatioLimit', () => {
  it('常规模式用用户设置的像素比上限', () => {
    expect(resolvePixelRatioLimit({ maxPixelRatio: 1.5 })).toBe(1.5)
    expect(resolvePixelRatioLimit({ maxPixelRatio: 3 })).toBe(3)
  })

  it('低性能模式强制降到 1，且优先于用户设置', () => {
    expect(resolvePixelRatioLimit({ lowPerformance: true, maxPixelRatio: 3 })).toBe(
      LOW_PERFORMANCE_PIXEL_RATIO,
    )
    expect(resolvePixelRatioLimit({ lowPerformance: true })).toBe(1)
  })

  it('非法或缺失回退到默认上限', () => {
    expect(resolvePixelRatioLimit()).toBe(DEFAULT_MAX_PIXEL_RATIO)
    expect(resolvePixelRatioLimit({ maxPixelRatio: 0 })).toBe(DEFAULT_MAX_PIXEL_RATIO)
    expect(resolvePixelRatioLimit({ maxPixelRatio: -1 })).toBe(DEFAULT_MAX_PIXEL_RATIO)
    expect(resolvePixelRatioLimit({ maxPixelRatio: Number.NaN })).toBe(DEFAULT_MAX_PIXEL_RATIO)
    expect(resolvePixelRatioLimit({ maxPixelRatio: '2' })).toBe(DEFAULT_MAX_PIXEL_RATIO)
  })
})

describe('resolvePostFxSamples', () => {
  it('常规模式保留默认 MSAA', () => {
    expect(resolvePostFxSamples()).toBe(DEFAULT_POSTFX_SAMPLES)
    expect(resolvePostFxSamples({ lowPerformance: false })).toBe(DEFAULT_POSTFX_SAMPLES)
  })

  it('低性能模式关掉 MSAA', () => {
    expect(resolvePostFxSamples({ lowPerformance: true })).toBe(LOW_PERFORMANCE_SAMPLES)
    expect(LOW_PERFORMANCE_SAMPLES).toBe(0)
  })
})

describe('resolveAntialias', () => {
  it('只有低性能模式才放弃默认帧缓冲的抗锯齿', () => {
    expect(resolveAntialias()).toBe(true)
    expect(resolveAntialias({ lowPerformance: true })).toBe(false)
  })
})
