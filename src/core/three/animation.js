/**
 * 动画控制（M4）。
 *
 * 设计：把「片段选择 + 播放状态机 + 时间轴」收进一个 `AnimationController`，
 * 引擎只负责每帧喂 delta 并读取状态。好处是这套逻辑**能在 Node 下用真实
 * AnimationMixer + AnimationClip 完整单测**（three 的动画系统不依赖 WebGL），
 * 播放/暂停/停止/倍速/拖动时间轴/循环模式都能被确定性验证。
 *
 * 状态机约定：
 * - 选中片段后**停在 0 秒且暂停**（视图里先看到第一帧，而不是突然动起来）；
 * - `停止` = 时间归零并暂停（保持第一帧姿势），不是恢复绑定姿势；
 * - `播放一次` 播完后自动置为暂停+finished，便于 UI 显示"已播完"。
 */

import { AnimationMixer, LoopOnce, LoopPingPong, LoopRepeat } from 'three'

export const ANIMATION_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
export const SPEED_RANGE = { min: 0.1, max: 4, step: 0.05 }
export const DEFAULT_SPEED = 1

export const LOOP_MODES = [
  { id: 'repeat', label: '循环', value: LoopRepeat },
  { id: 'once', label: '播放一次', value: LoopOnce },
  { id: 'pingpong', label: '往返', value: LoopPingPong },
]

export const DEFAULT_LOOP_MODE = 'repeat'

/** 每帧 delta 上限：从空闲状态唤醒时 delta 可能很大，直接喂给 mixer 会跳帧 */
export const MAX_FRAME_DELTA = 0.1

export function normalizeSpeed(speed) {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED
  return Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, speed))
}

export function resolveLoopMode(loopModeId) {
  if (!loopModeId) return null
  return LOOP_MODES.find((mode) => mode.id === loopModeId) ?? null
}

export function normalizeLoopMode(loopModeId) {
  return resolveLoopMode(loopModeId)?.id ?? DEFAULT_LOOP_MODE
}

export function resolveLoopValue(loopModeId) {
  return resolveLoopMode(loopModeId)?.value ?? LoopRepeat
}

/** 片段描述（纯函数）：UI 列表直接用 */
export function describeClips(clips) {
  if (!Array.isArray(clips)) return []
  return clips.filter(Boolean).map((clip, index) => ({
    id: index,
    index,
    name: typeof clip.name === 'string' && clip.name.trim() ? clip.name.trim() : `片段 ${index + 1}`,
    duration: Number.isFinite(clip.duration) ? clip.duration : 0,
    tracks: Array.isArray(clip.tracks) ? clip.tracks.length : 0,
  }))
}

/** 时长文案：不足 1 分钟用秒，超过用 分:秒 */
export function formatClipDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${seconds.toFixed(2)} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes} 分 ${rest.toFixed(1)} 秒`
}

/** 时间 → 0~1 归一化（时长为 0 时返回 0，不产生 NaN） */
export function timeToNormalized(time, duration) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(1, Math.max(0, time / duration))
}

/** 0~1 归一化 → 时间 */
export function normalizedToTime(normalized, duration) {
  if (!Number.isFinite(normalized) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(duration, Math.max(0, normalized * duration))
}

export class AnimationController {
  /**
   * @param {object} root 模型根节点（AnimationMixer 的根）
   * @param {Array} clips 片段数组（GLTFLoader / FBXLoader 的 animations）
   */
  constructor(root, clips = []) {
    if (!root) throw new Error('AnimationController 需要模型根节点')
    this.root = root
    this.clips = Array.isArray(clips) ? clips.filter(Boolean) : []
    this.mixer = new AnimationMixer(root)
    this.actions = new Map()
    this.currentIndex = -1
    this.speed = DEFAULT_SPEED
    this.loopMode = DEFAULT_LOOP_MODE
    this.playing = false
    this.finished = false
  }

  get hasClips() {
    return this.clips.length > 0
  }

  get descriptions() {
    return describeClips(this.clips)
  }

  get currentClip() {
    return this.clips[this.currentIndex] ?? null
  }

  get currentAction() {
    const clip = this.currentClip
    return clip ? this.actions.get(clip) ?? null : null
  }

  get duration() {
    const duration = this.currentClip?.duration
    return Number.isFinite(duration) ? duration : 0
  }

  ensureAction(clip) {
    let action = this.actions.get(clip)
    if (!action) {
      action = this.mixer.clipAction(clip)
      this.actions.set(clip, action)
    }
    return action
  }

  /** 应用当前倍速与循环模式到某个 action 上（选中/改设置时都要重放一遍） */
  configureAction(action) {
    action.setLoop(resolveLoopValue(this.loopMode), Infinity)
    action.clampWhenFinished = this.loopMode === 'once'
    action.setEffectiveTimeScale(this.speed)
    action.setEffectiveWeight(1)
  }

  /**
   * 选中片段（索引或名称）。选中后停在 0 秒并暂停。
   * @returns {object|null} 被选中的 action；目标非法时返回 null 且不改变当前选中
   */
  selectClip(target) {
    if (!this.hasClips) return null
    const index =
      typeof target === 'number' ? target : this.clips.findIndex((clip) => clip.name === target)
    if (!Number.isInteger(index) || index < 0 || index >= this.clips.length) return null

    const nextClip = this.clips[index]
    const previousClip = this.currentClip
    if (previousClip && previousClip !== nextClip) {
      const previousAction = this.actions.get(previousClip)
      if (previousAction) {
        previousAction.stop()
        previousAction.paused = true
      }
    }

    this.currentIndex = index
    const action = this.ensureAction(nextClip)
    action.reset()
    this.configureAction(action)
    action.paused = true
    action.play()
    this.playing = false
    this.finished = false
    // 立即把第 0 帧姿势应用到模型上（否则模型停在上一段片段的姿势）
    this.mixer.update(0)
    return action
  }

  play() {
    if (!this.hasClips) return false
    if (this.currentIndex < 0 && !this.selectClip(0)) return false

    const action = this.currentAction
    if (!action) return false

    if (this.finished) {
      action.reset()
      this.configureAction(action)
      this.finished = false
    }
    action.enabled = true
    action.paused = false
    this.playing = true
    return true
  }

  pause() {
    const action = this.currentAction
    if (action) action.paused = true
    this.playing = false
    return true
  }

  toggle() {
    return this.playing ? this.pause() : this.play()
  }

  /** 停止 = 回到 0 秒并暂停（保持第一帧姿势，不是恢复绑定姿势） */
  stop() {
    const action = this.currentAction
    if (action) {
      action.stop()
      action.enabled = true
      action.paused = true
      action.time = 0
    }
    this.playing = false
    this.finished = false
    this.mixer.update(0)
    return true
  }

  setSpeed(speed) {
    this.speed = normalizeSpeed(speed)
    const action = this.currentAction
    if (action) action.setEffectiveTimeScale(this.speed)
    return this.speed
  }

  setLoopMode(loopModeId) {
    this.loopMode = normalizeLoopMode(loopModeId)
    const action = this.currentAction
    if (action) this.configureAction(action)
    return this.loopMode
  }

  /** 拖动时间轴：直接定位并刷新姿势 */
  seekNormalized(normalized) {
    const action = this.currentAction
    if (!action) return false
    action.time = normalizedToTime(normalized, this.duration)
    action.paused = true
    this.playing = false
    if (action.time < this.duration) this.finished = false
    this.mixer.update(0)
    return true
  }

  /**
   * 每帧推进。
   * @param {number} delta 秒（应由引擎夹取上限，见 MAX_FRAME_DELTA）
   */
  update(delta = 0) {
    if (this.hasClips) {
      this.mixer.update(Number.isFinite(delta) ? delta : 0)
      const action = this.currentAction
      if (this.playing && action && this.loopMode === 'once') {
        // 播放一次：three 在末尾会因 clampWhenFinished 把 action 置为 paused
        if (action.paused && action.time >= this.duration - 1e-6) {
          this.playing = false
          this.finished = true
        }
      }
    }
    return this.getState()
  }

  getState() {
    const clip = this.currentClip
    const action = this.currentAction
    const time = action ? action.time : 0
    return {
      hasClips: this.hasClips,
      clipId: clip ? this.currentIndex : null,
      clipName: clip?.name ?? '',
      playing: this.playing,
      finished: this.finished,
      speed: this.speed,
      loopMode: this.loopMode,
      time,
      duration: this.duration,
      normalized: timeToNormalized(time, this.duration),
    }
  }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.actions.clear()
    this.currentIndex = -1
    this.playing = false
  }
}
