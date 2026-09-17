/**
 * 相机平滑过渡（补间）逻辑 —— 纯函数 + 一个小状态机，可在 Node 下完整单测。
 *
 * 为什么不写在 ViewerEngine 里：补间必须能被"每帧推进 + 随时打断"，而打断源有三个
 * （用户拖动鼠标、连续切换视图、模型被替换）。把状态机独立出来才能在无 WebGL 的环境里
 * 覆盖"起点等于终点不动画""被打断后不残留""时长非法怎么办"这类边界。
 *
 * 本模块只处理 [x, y, z] 数组与毫秒数，不 import three。
 */

/** 默认时长：300ms 上下是"看得见在动、又不拖沓"的常用区间 */
export const DEFAULT_TWEEN_MS = 320
/** 允许的时长区间：太短等于瞬移，太长会让人觉得程序卡了 */
export const MIN_TWEEN_MS = 80
export const MAX_TWEEN_MS = 2000

/** 三次缓入缓出：起步与收尾都平滑，是相机移动最常用的缓动 */
export function easeInOutCubic(t) {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function clampDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return DEFAULT_TWEEN_MS
  return Math.min(MAX_TWEEN_MS, Math.max(MIN_TWEEN_MS, durationMs))
}

function normalizeVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null
  const [x, y, z] = value
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

/** 归一化一个相机位姿；缺字段或含 NaN 时返回 null（调用方据此退化为瞬时应用） */
export function normalizePose(pose) {
  if (!pose || typeof pose !== 'object') return null
  const position = normalizeVec3(pose.position)
  const target = normalizeVec3(pose.target)
  if (!position || !target) return null
  return { position, target }
}

function vec3Equal(a, b, epsilon = 1e-6) {
  return (
    Math.abs(a[0] - b[0]) < epsilon &&
    Math.abs(a[1] - b[1]) < epsilon &&
    Math.abs(a[2] - b[2]) < epsilon
  )
}

function posesEqual(a, b, epsilon = 1e-6) {
  return vec3Equal(a.position, b.position, epsilon) && vec3Equal(a.target, b.target, epsilon)
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * 求某一时刻的插值结果（纯函数）。
 * @returns {{position: number[], target: number[], progress: number, done: boolean}}
 */
export function sampleCameraTween({ from, to, elapsedMs = 0, durationMs = DEFAULT_TWEEN_MS }) {
  const duration = clampDuration(durationMs)
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0
  const progress = Math.min(1, elapsed / duration)
  const eased = easeInOutCubic(progress)

  return {
    position: lerp3(from.position, to.position, eased),
    target: lerp3(from.target, to.target, eased),
    progress,
    // 用 progress 判断而不是 eased：缓动在 progress=1 时才精确落到终点
    done: progress >= 1,
  }
}

export class CameraTween {
  constructor({ durationMs = DEFAULT_TWEEN_MS } = {}) {
    this.durationMs = clampDuration(durationMs)
    this.active = false
    this.from = null
    this.to = null
    this.elapsedMs = 0
  }

  /**
   * 开始一段补间。
   * 起点与终点相同（或任一数值非法）时返回 false 并且不进入动画状态 ——
   * 否则会变成"点了没反应，但要等 320ms 才恢复"的假动画。
   */
  start({ from, to }, { durationMs } = {}) {
    const start = normalizePose(from)
    const end = normalizePose(to)
    if (!start || !end || posesEqual(start, end)) {
      this.cancel()
      return false
    }

    this.from = start
    this.to = end
    this.elapsedMs = 0
    if (durationMs !== undefined) this.durationMs = clampDuration(durationMs)
    this.active = true
    return true
  }

  /** 每帧推进；未在动画中返回 null（调用方无需再判断 active） */
  update(deltaMs) {
    if (!this.active) return null

    this.elapsedMs += Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0
    const sample = sampleCameraTween({
      from: this.from,
      to: this.to,
      elapsedMs: this.elapsedMs,
      durationMs: this.durationMs,
    })
    if (sample.done) this.active = false
    return sample
  }

  /** 打断当前补间（停在当前位置，不跳变） */
  cancel() {
    this.active = false
    this.from = null
    this.to = null
    this.elapsedMs = 0
  }

  /** 直接取终点（尊重"减少动效"偏好时用），并结束动画 */
  finish() {
    const destination = this.to
    this.cancel()
    return destination
  }
}
