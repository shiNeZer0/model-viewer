import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_LOOP_MODE, DEFAULT_SPEED, SPEED_RANGE } from '../core/three/animation.js'
import { useAnimationStore } from './animationStore.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('animationStore 状态', () => {
  it('初始无片段时 hasClips 为 false，状态干净', () => {
    const animation = useAnimationStore()
    expect(animation.hasClips).toBe(false)
    expect(animation.clips).toEqual([])
    expect(animation.playing).toBe(false)
    expect(animation.speed).toBe(DEFAULT_SPEED)
    expect(animation.loopMode).toBe(DEFAULT_LOOP_MODE)
    expect(animation.normalized).toBe(0)
    expect(animation.timeText).toBe('0.00 / 0.00 秒')
  })

  it('setClips + applyState 写入片段与运行状态', () => {
    const animation = useAnimationStore()
    animation.setClips([
      { id: 0, name: '待机', duration: 2, tracks: 3 },
      { id: 1, name: '行走', duration: 4, tracks: 5 },
    ])
    expect(animation.hasClips).toBe(true)
    expect(animation.clips).toHaveLength(2)

    animation.applyState({
      clipId: 1,
      clipName: '行走',
      playing: true,
      finished: false,
      speed: 1.5,
      loopMode: 'once',
      time: 2,
      duration: 4,
      normalized: 0.5,
    })

    expect(animation.clipId).toBe(1)
    expect(animation.clipName).toBe('行走')
    expect(animation.playing).toBe(true)
    expect(animation.speed).toBe(1.5)
    expect(animation.loopMode).toBe('once')
    expect(animation.normalized).toBe(0.5)
    expect(animation.timeText).toBe('2.00 / 4.00 秒')
    expect(animation.durationText).toBe('4.00 秒')
  })

  it('applyState 容忍缺字段与非法值（不产生 NaN）', () => {
    const animation = useAnimationStore()
    animation.applyState({ playing: true, time: Number.NaN, duration: undefined })
    expect(animation.time).toBe(0)
    expect(animation.duration).toBe(0)
    expect(animation.normalized).toBe(0)
    expect(animation.clipId).toBe(null)

    expect(() => animation.applyState(null)).not.toThrow()
    expect(() => animation.applyState(undefined)).not.toThrow()
  })

  it('setSpeed 夹取区间、setLoopMode 回退非法值', async () => {
    const animation = useAnimationStore()
    // Node 下没有 localStorage/SQLite：持久化会失败但必须被内部吞掉，不影响内存状态
    await animation.setSpeed(99)
    expect(animation.speed).toBe(SPEED_RANGE.max)
    await animation.setSpeed(0)
    expect(animation.speed).toBe(SPEED_RANGE.min)

    await animation.setLoopMode('pingpong')
    expect(animation.loopMode).toBe('pingpong')
    await animation.setLoopMode('nope')
    expect(animation.loopMode).toBe(DEFAULT_LOOP_MODE)
  })

  it('reset 清空片段与时间，但保留用户的倍速与循环偏好', async () => {
    const animation = useAnimationStore()
    animation.setClips([{ id: 0, name: 'A', duration: 1, tracks: 1 }])
    animation.applyState({ clipId: 0, playing: true, time: 1, duration: 1, normalized: 1 })
    await animation.setSpeed(2)
    await animation.setLoopMode('once')

    animation.reset()

    expect(animation.clips).toEqual([])
    expect(animation.hasClips).toBe(false)
    expect(animation.playing).toBe(false)
    expect(animation.time).toBe(0)
    expect(animation.duration).toBe(0)
    expect(animation.clipId).toBe(null)
    // 偏好保留：换模型后仍是用户选过的倍速与循环模式
    expect(animation.speed).toBe(2)
    expect(animation.loopMode).toBe('once')
    expect(animation.loaded).toBe(false)
  })

  it('load 在无持久化后端时记录错误但不抛错', async () => {
    const animation = useAnimationStore()
    await animation.load()
    expect(animation.loaded).toBe(true)
    // Node 环境没有 localStorage，读取失败会被捕获成 loadError
    expect(typeof animation.loadError).toBe('string')
  })
})
