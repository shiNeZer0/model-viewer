import { describe, expect, it } from 'vitest'

import { DEFAULT_IDLE_MS, createIdlePolicy, hasContinuousWork } from './idlePolicy.js'

describe('createIdlePolicy', () => {
  it('活动后 idleMs 内继续渲染，超时后进入空闲', () => {
    const policy = createIdlePolicy({ idleMs: 1000 })
    policy.noteActivity(0)
    expect(policy.shouldRender(0)).toBe(true)
    expect(policy.shouldRender(999)).toBe(true)
    // 边界：正好到 idleMs 即视为空闲（避免永远差一帧）
    expect(policy.shouldRender(1000)).toBe(false)
    expect(policy.isIdle(1000)).toBe(true)
  })

  it('持续工作（转盘/动画）时忽略空闲', () => {
    const policy = createIdlePolicy({ idleMs: 10 })
    policy.noteActivity(0)
    expect(policy.shouldRender(999999, { continuous: true })).toBe(true)
    expect(policy.shouldRender(999999, { continuous: false })).toBe(false)
  })

  it('goIdle 之后立即停止渲染', () => {
    const policy = createIdlePolicy({ idleMs: 1000 })
    policy.noteActivity(0)
    expect(policy.shouldRender(0)).toBe(true)
    policy.goIdle()
    expect(policy.shouldRender(0)).toBe(false)
  })

  it('非法 idleMs 回退到默认值；setIdleMs 可动态调整', () => {
    expect(createIdlePolicy({ idleMs: Number.NaN }).idleMs).toBe(DEFAULT_IDLE_MS)
    expect(createIdlePolicy({ idleMs: -5 }).idleMs).toBe(DEFAULT_IDLE_MS)
    expect(createIdlePolicy().idleMs).toBe(DEFAULT_IDLE_MS)

    const policy = createIdlePolicy({ idleMs: 1000 })
    policy.noteActivity(0)
    policy.setIdleMs(100)
    expect(policy.shouldRender(100)).toBe(false)
    policy.setIdleMs(Number.NaN) // 非法值不应破坏现有设置
    expect(policy.idleMs).toBe(100)
  })

  it('非法 nowMs 不抛错', () => {
    const policy = createIdlePolicy()
    policy.noteActivity(Number.NaN)
    expect(typeof policy.shouldRender(Number.NaN)).toBe('boolean')
  })
})

describe('hasContinuousWork', () => {
  it('转盘或动画任一为真即需持续渲染', () => {
    expect(hasContinuousWork()).toBe(false)
    expect(hasContinuousWork({ autoRotate: true })).toBe(true)
    expect(hasContinuousWork({ animationPlaying: true })).toBe(true)
    expect(hasContinuousWork({ autoRotate: false, animationPlaying: false })).toBe(false)
  })
})
