import { describe, expect, it } from 'vitest'

import {
  CameraTween,
  DEFAULT_TWEEN_MS,
  MAX_TWEEN_MS,
  MIN_TWEEN_MS,
  clampDuration,
  easeInOutCubic,
  normalizePose,
  sampleCameraTween,
} from './cameraTween.js'

const FROM = { position: [0, 0, 10], target: [0, 0, 0] }
const TO = { position: [10, 0, 0], target: [1, 0, 0] }

describe('easeInOutCubic', () => {
  it('两端精确锚定，中点为 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10)
  })

  it('单调不减，且起点慢、中间快（缓入缓出的形状）', () => {
    const samples = Array.from({ length: 21 }, (_, index) => easeInOutCubic(index / 20))
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] - 1e-12)
    }
    // 前 10% 的进度只走掉很小一段（比线性慢）
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1)
    // 中段速度最快
    expect(easeInOutCubic(0.55) - easeInOutCubic(0.45)).toBeGreaterThan(0.1)
  })

  it('非法输入收敛到 0，不产生 NaN', () => {
    expect(easeInOutCubic(Number.NaN)).toBe(0)
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
    expect(easeInOutCubic(undefined)).toBe(0)
  })
})

describe('clampDuration', () => {
  it('夹到可感知区间，非法值用默认时长', () => {
    expect(clampDuration(300)).toBe(300)
    expect(clampDuration(1)).toBe(MIN_TWEEN_MS)
    expect(clampDuration(99999)).toBe(MAX_TWEEN_MS)
    expect(clampDuration(Number.NaN)).toBe(DEFAULT_TWEEN_MS)
    expect(clampDuration(undefined)).toBe(DEFAULT_TWEEN_MS)
  })
})

describe('normalizePose', () => {
  it('接受 [x,y,z] 数组，拒绝缺字段与 NaN', () => {
    expect(normalizePose(FROM)).toEqual({ position: [0, 0, 10], target: [0, 0, 0] })
    expect(normalizePose({ position: [0, 0], target: [0, 0, 0] })).toBeNull()
    expect(normalizePose({ position: [0, Number.NaN, 0], target: [0, 0, 0] })).toBeNull()
    expect(normalizePose({ position: [0, 0, 0] })).toBeNull()
    expect(normalizePose(null)).toBeNull()
  })
})

describe('sampleCameraTween', () => {
  it('起点与终点精确命中', () => {
    expect(sampleCameraTween({ from: FROM, to: TO, elapsedMs: 0, durationMs: 400 }).position).toEqual(
      FROM.position,
    )
    const end = sampleCameraTween({ from: FROM, to: TO, elapsedMs: 400, durationMs: 400 })
    expect(end.position).toEqual(TO.position)
    expect(end.target).toEqual(TO.target)
    expect(end.done).toBe(true)
    // 超过时长也不会过冲
    expect(sampleCameraTween({ from: FROM, to: TO, elapsedMs: 9999, durationMs: 400 }).position).toEqual(
      TO.position,
    )
  })

  it('中点位置 = 缓动后的线性插值（缓动在 0.5 处恰好是 0.5）', () => {
    const mid = sampleCameraTween({ from: FROM, to: TO, elapsedMs: 200, durationMs: 400 })
    expect(mid.progress).toBeCloseTo(0.5, 10)
    expect(mid.position[0]).toBeCloseTo(5, 10)
    expect(mid.target[0]).toBeCloseTo(0.5, 10)
    expect(mid.done).toBe(false)
  })

  it('时长为 0 会被夹到下限：瞬时应用由调用方直接赋值，而不是"跑一段 0ms 动画"', () => {
    const atStart = sampleCameraTween({ from: FROM, to: TO, elapsedMs: 0, durationMs: 0 })
    expect(MIN_TWEEN_MS).toBeGreaterThan(0)
    expect(atStart.done).toBe(false)
    expect(atStart.position).toEqual(FROM.position)

    const afterMin = sampleCameraTween({ from: FROM, to: TO, elapsedMs: MIN_TWEEN_MS, durationMs: 0 })
    expect(afterMin.done).toBe(true)
    expect(afterMin.position).toEqual(TO.position)
  })
})

describe('CameraTween', () => {
  it('起终点相同时不动画（避免"点了没反应却要等一会"）', () => {
    const tween = new CameraTween()
    expect(tween.start({ from: FROM, to: { ...FROM } })).toBe(false)
    expect(tween.active).toBe(false)
    expect(tween.update(16)).toBeNull()
  })

  it('逐步推进：中途返回插值，到点后自动结束', () => {
    const tween = new CameraTween({ durationMs: 400 })
    expect(tween.start({ from: FROM, to: TO })).toBe(true)
    expect(tween.active).toBe(true)

    const quarter = tween.update(100)
    expect(quarter.done).toBe(false)
    expect(quarter.position[0]).toBeGreaterThan(0)
    expect(quarter.position[0]).toBeLessThan(5) // 缓入：前 1/4 走不到 1/4

    const rest = tween.update(400)
    expect(rest.done).toBe(true)
    expect(rest.position).toEqual(TO.position)
    expect(tween.active).toBe(false)
    expect(tween.update(16)).toBeNull()
  })

  it('被打断时就地停下（不跳变），随后可重新开始', () => {
    const tween = new CameraTween({ durationMs: 400 })
    tween.start({ from: FROM, to: TO })
    const partial = tween.update(200)
    tween.cancel()
    expect(tween.active).toBe(false)
    expect(tween.update(16)).toBeNull()

    // 从"当前所在位置"重新开始另一段
    const resumed = tween.start({ from: { position: partial.position, target: partial.target }, to: FROM })
    expect(resumed).toBe(true)
    expect(tween.update(400).position).toEqual(FROM.position)
  })

  it('连续切换视图时后一段覆盖前一段（不会两段同时生效）', () => {
    const tween = new CameraTween({ durationMs: 400 })
    tween.start({ from: FROM, to: TO })
    tween.update(100)
    tween.start({ from: FROM, to: { position: [0, 10, 0], target: [0, 0, 0] } })
    expect(tween.update(400).position).toEqual([0, 10, 0])
  })

  it('每段可覆盖时长，非法时长回落到默认值', () => {
    const tween = new CameraTween()
    tween.start({ from: FROM, to: TO }, { durationMs: 600 })
    expect(tween.durationMs).toBe(600)
    tween.start({ from: FROM, to: TO }, { durationMs: Number.NaN })
    expect(tween.durationMs).toBe(DEFAULT_TWEEN_MS)
  })

  it('NaN 位姿不启动动画（退化为瞬时应用）', () => {
    const tween = new CameraTween()
    expect(tween.start({ from: FROM, to: { position: [Number.NaN, 0, 0], target: [0, 0, 0] } })).toBe(
      false,
    )
    expect(tween.active).toBe(false)
  })

  it('finish 返回终点并结束动画（尊重"减少动效"偏好时用）', () => {
    const tween = new CameraTween()
    tween.start({ from: FROM, to: TO })
    expect(tween.finish()).toEqual(TO)
    expect(tween.active).toBe(false)
    expect(tween.finish()).toBeNull()
  })

  it('delta 非法或为负时进度不倒退', () => {
    const tween = new CameraTween({ durationMs: 400 })
    tween.start({ from: FROM, to: TO })
    tween.update(200)
    tween.update(-100)
    tween.update(Number.NaN)
    const sample = tween.update(200)
    expect(sample.done).toBe(true)
  })
})
