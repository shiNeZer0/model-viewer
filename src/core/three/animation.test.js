import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import {
  ANIMATION_SPEEDS,
  AnimationController,
  DEFAULT_LOOP_MODE,
  DEFAULT_SPEED,
  MAX_FRAME_DELTA,
  SPEED_RANGE,
  describeClips,
  formatClipDuration,
  normalizeLoopMode,
  normalizeSpeed,
  normalizedToTime,
  resolveLoopValue,
  timeToNormalized,
} from './animation.js'

/**
 * 造一个真实动画：x 在 2 秒内 0 → 10 → 0。
 * 用 VectorKeyframeTrack('.position') 绑定到 mixer 根节点自身，便于断言数值。
 */
function buildAnimatedModel() {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
  const track = new VectorKeyframeTrack('.position', [0, 1, 2], [0, 0, 0, 10, 0, 0, 0, 0, 0])
  const clip = new AnimationClip('位移测试', 2, [track])
  return { root, clip }
}

function buildController() {
  const { root, clip } = buildAnimatedModel()
  return { root, clip, controller: new AnimationController(root, [clip]) }
}

describe('纯函数', () => {
  it('normalizeSpeed 夹取区间并处理非法值', () => {
    expect(normalizeSpeed(2)).toBe(2)
    expect(normalizeSpeed(0)).toBe(SPEED_RANGE.min)
    expect(normalizeSpeed(99)).toBe(SPEED_RANGE.max)
    expect(normalizeSpeed(Number.NaN)).toBe(DEFAULT_SPEED)
    expect(normalizeSpeed(undefined)).toBe(DEFAULT_SPEED)
    expect(ANIMATION_SPEEDS).toContain(0.25)
    expect(ANIMATION_SPEEDS).toContain(2)
  })

  it('循环模式解析与回退', () => {
    expect(normalizeLoopMode('once')).toBe('once')
    expect(normalizeLoopMode('pingpong')).toBe('pingpong')
    expect(normalizeLoopMode('nope')).toBe(DEFAULT_LOOP_MODE)
    expect(resolveLoopValue('once')).toBe(2200)
    expect(resolveLoopValue('nope')).toBe(2201) // LoopRepeat
  })

  it('describeClips 给出 id/名称/时长/轨道数，无名片段有占位名', () => {
    const { clip } = buildAnimatedModel()
    const unnamed = new AnimationClip('', 1.5, [])
    const described = describeClips([clip, unnamed])
    expect(described).toHaveLength(2)
    expect(described[0]).toMatchObject({ id: 0, index: 0, name: '位移测试', duration: 2, tracks: 1 })
    expect(described[1].name).toBe('片段 2')
    expect(described[1].tracks).toBe(0)
    expect(describeClips(null)).toEqual([])
  })

  it('formatClipDuration 秒 / 分秒两种形态，非法值给占位符', () => {
    expect(formatClipDuration(2.5)).toBe('2.50 秒')
    expect(formatClipDuration(62.34)).toBe('1 分 2.3 秒')
    expect(formatClipDuration(Number.NaN)).toBe('—')
    expect(formatClipDuration(-1)).toBe('—')
  })

  it('时间与归一化互转，时长为 0 时不产生 NaN', () => {
    expect(timeToNormalized(1, 2)).toBe(0.5)
    expect(timeToNormalized(3, 2)).toBe(1)
    expect(timeToNormalized(-1, 2)).toBe(0)
    expect(timeToNormalized(1, 0)).toBe(0)
    expect(normalizedToTime(0.5, 2)).toBe(1)
    expect(normalizedToTime(2, 2)).toBe(2)
    expect(normalizedToTime(Number.NaN, 2)).toBe(0)
  })

  it('MAX_FRAME_DELTA 是合理上限（防空闲唤醒后跳帧）', () => {
    expect(MAX_FRAME_DELTA).toBeGreaterThan(0)
    expect(MAX_FRAME_DELTA).toBeLessThanOrEqual(0.2)
  })
})

describe('AnimationController', () => {
  it('构造需要根节点', () => {
    expect(() => new AnimationController(null)).toThrow()
  })

  it('选中片段后停在 0 秒且暂停，并立即应用第 0 帧姿势', () => {
    const { controller, root } = buildController()
    const action = controller.selectClip(0)

    expect(action).toBeTruthy()
    const state = controller.getState()
    expect(state.playing).toBe(false)
    expect(state.time).toBe(0)
    expect(state.duration).toBe(2)
    expect(state.clipName).toBe('位移测试')
    // 第 0 帧 x = 0
    expect(root.position.x).toBeCloseTo(0, 5)
  })

  it('播放推进时间轴，姿势随时间变化', () => {
    const { controller, root } = buildController()
    controller.selectClip(0)
    expect(controller.play()).toBe(true)

    controller.update(0.5)
    expect(controller.getState().time).toBeCloseTo(0.5, 5)
    // 0→10 用 1 秒：t=0.5 时 x≈5
    expect(root.position.x).toBeCloseTo(5, 5)

    controller.update(0.5)
    expect(controller.getState().time).toBeCloseTo(1, 5)
    expect(root.position.x).toBeCloseTo(10, 5)

    expect(controller.getState().normalized).toBeCloseTo(0.5, 5)
  })

  it('倍速生效（2× 时同样的 delta 前进两倍时间）', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.setSpeed(2)
    controller.play()

    controller.update(0.25)
    expect(controller.getState().time).toBeCloseTo(0.5, 5)
  })

  it('暂停后时间不再前进', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.update(0.5)
    controller.pause()

    const before = controller.getState().time
    controller.update(1)
    expect(controller.getState().time).toBeCloseTo(before, 5)
    expect(controller.getState().playing).toBe(false)
  })

  it('停止回到 0 秒并暂停', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.update(1)
    controller.stop()

    const state = controller.getState()
    expect(state.time).toBe(0)
    expect(state.playing).toBe(false)
    expect(state.finished).toBe(false)
  })

  it('停止后仍能再次播放，且停止时回到第 0 帧姿势（用户报障场景）', () => {
    const { controller, root } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.update(0.6)
    // 播到一半：x ≈ 6
    expect(root.position.x).toBeCloseTo(6, 4)

    controller.stop()
    expect(controller.getState().time).toBe(0)
    expect(controller.getState().playing).toBe(false)
    /*
     * three 的 action.stop() 会停用该 action（_deactivateAction），
     * 若不再重新激活，姿势既不会回到第 0 帧、后续播放也不会被更新。
     */
    expect(root.position.x).toBeCloseTo(0, 5)

    expect(controller.play()).toBe(true)
    controller.update(0.5)
    const resumed = controller.getState()
    expect(resumed.playing).toBe(true)
    expect(resumed.time).toBeCloseTo(0.5, 4)
    expect(root.position.x).toBeCloseTo(5, 4)
  })

  it('停止 → 暂停 → 播放 的组合都保持可播放', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.update(0.3)
    controller.stop()
    controller.pause()
    expect(controller.play()).toBe(true)
    controller.update(0.4)
    expect(controller.getState().time).toBeCloseTo(0.4, 4)
  })

  it('拖动时间轴：定位到指定进度并暂停，姿势随之更新', () => {
    const { controller, root } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.update(0.2)

    expect(controller.seekNormalized(0.75)).toBe(true)
    const state = controller.getState()
    expect(state.time).toBeCloseTo(1.5, 5)
    expect(state.playing).toBe(false)
    // t=1.5 在 10→0 的下降段，x≈5
    expect(root.position.x).toBeCloseTo(5, 5)

    // 越界值被夹取
    controller.seekNormalized(5)
    expect(controller.getState().time).toBeCloseTo(2, 5)
    controller.seekNormalized(-1)
    expect(controller.getState().time).toBeCloseTo(0, 5)
  })

  it('「播放一次」播完自动置为暂停 + finished，再播放会从头开始', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.setLoopMode('once')
    controller.play()

    controller.update(2.5)
    const state = controller.getState()
    expect(state.playing).toBe(false)
    expect(state.finished).toBe(true)
    expect(state.time).toBeCloseTo(2, 4)

    expect(controller.play()).toBe(true)
    expect(controller.getState().finished).toBe(false)
    expect(controller.getState().playing).toBe(true)
  })

  it('循环模式切换会写回 action', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    expect(controller.setLoopMode('pingpong')).toBe('pingpong')
    expect(controller.currentAction.loop).toBe(resolveLoopValue('pingpong'))
    expect(controller.currentAction.clampWhenFinished).toBe(false)

    controller.setLoopMode('once')
    expect(controller.currentAction.clampWhenFinished).toBe(true)

    // 非法值回退到默认
    expect(controller.setLoopMode('nope')).toBe(DEFAULT_LOOP_MODE)
  })

  it('按名称选片段；非法目标不改变当前选中', () => {
    const { controller } = buildController()
    controller.selectClip('位移测试')
    expect(controller.getState().clipId).toBe(0)

    expect(controller.selectClip('不存在')).toBe(null)
    expect(controller.selectClip(9)).toBe(null)
    expect(controller.getState().clipId).toBe(0)
  })

  it('多片段切换：切走前一段会被停住', () => {
    const { root, clip } = buildAnimatedModel()
    const second = new AnimationClip('第二段', 1, [
      new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 5, 5, 5]),
    ])
    const controller = new AnimationController(root, [clip, second])

    controller.selectClip(0)
    controller.play()
    controller.update(0.5)
    const firstAction = controller.currentAction

    controller.selectClip(1)
    expect(firstAction.paused).toBe(true)
    expect(controller.getState().clipName).toBe('第二段')
    expect(controller.descriptions).toHaveLength(2)
  })

  it('无动画片段时所有操作安全返回，不抛错', () => {
    const root = new Group()
    const controller = new AnimationController(root, [])
    expect(controller.hasClips).toBe(false)
    expect(controller.selectClip(0)).toBe(null)
    expect(controller.play()).toBe(false)
    expect(controller.pause()).toBe(true)
    expect(controller.stop()).toBe(true)
    expect(controller.seekNormalized(0.5)).toBe(false)
    expect(controller.getState()).toMatchObject({ hasClips: false, duration: 0, time: 0 })
    expect(() => controller.update(0.1)).not.toThrow()
    expect(() => controller.dispose()).not.toThrow()
  })

  it('dispose 清空 action 缓存且不抛错', () => {
    const { controller } = buildController()
    controller.selectClip(0)
    controller.play()
    controller.dispose()
    expect(controller.actions.size).toBe(0)
    expect(controller.currentIndex).toBe(-1)
  })
})

describe('播放中切换片段（回归用例）', () => {
  /** 第二段：x 在 1 秒内 0 → 5 */
  function buildTwoClips() {
    const { root, clip } = buildAnimatedModel()
    const second = new AnimationClip('第二段', 1, [
      new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 5, 5, 5]),
    ])
    return { root, clip, second, controller: new AnimationController(root, [clip, second]) }
  }

  it('切换片段后仍能再次播放（用户报障场景）', () => {
    const { controller } = buildTwoClips()

    controller.selectClip(0)
    controller.play()
    controller.update(0.5)
    expect(controller.getState().time).toBeCloseTo(0.5, 4)
    expect(controller.getState().playing).toBe(true)

    controller.selectClip(1)
    const afterSwitch = controller.getState()
    expect(afterSwitch.playing).toBe(false)
    expect(afterSwitch.time).toBe(0)
    expect(afterSwitch.clipName).toBe('第二段')

    // 关键：切换后必须能重新播放并继续推进时间轴
    expect(controller.play()).toBe(true)
    controller.update(0.5)
    const resumed = controller.getState()
    expect(resumed.playing).toBe(true)
    expect(resumed.time).toBeCloseTo(0.5, 4)
  })

  it('切换后旧片段不再参与姿势混合（否则两段各占 50% 权重，动起来会失真）', () => {
    const { root, controller } = buildTwoClips()

    controller.selectClip(0)
    controller.play()
    controller.update(0.8)

    controller.selectClip(1)
    controller.play()
    controller.update(0.5)

    // 第二段 t=0.5 时 x 应为 2.5；若旧片段（x=0）仍以权重 1 参与混合，会得到约 1.25
    expect(root.position.x).toBeCloseTo(2.5, 3)
  })

  it('切回原片段同样能播放', () => {
    const { controller } = buildTwoClips()
    controller.selectClip(1)
    controller.play()
    controller.update(0.2)

    controller.selectClip(0)
    controller.play()
    controller.update(0.5)
    expect(controller.getState().playing).toBe(true)
    expect(controller.getState().time).toBeCloseTo(0.5, 4)
    expect(controller.getState().clipName).toBe('位移测试')
  })
})
