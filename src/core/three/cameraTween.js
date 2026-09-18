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

/**
 * 模型入场动画（加载完成后的"推入"）参数。
 * 比视图切换（320ms）慢一些才有"涌进来"的感觉；起点只由终点位姿推导，与上一个相机在哪无关。
 */
export const ENTRANCE_TWEEN_MS = 650
export const ENTRANCE_START_FACTOR = 1.9
export const ENTRANCE_LIFT_FACTOR = 0.12
/**
 * 推远倍数的合法区间。下限取 1（"不推远、只抬高"是合法组合，且与"原地不动"的退化情形相接），
 * 上限 4：再远模型就小得看不清了。
 */
export const ENTRANCE_FACTOR_RANGE = { min: 1, max: 4 }

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

/**
 * 由「终点位姿」推导模型入场时的起点位姿（纯函数）。
 *
 * 起点 = 终点沿同一条视线方向推远 factor 倍，再抬高一截（lift × 距离）：
 * 于是入场是"从更高更远处滑进来"，而不是原地放大。
 * **起点只依赖终点**：不取决于上一个相机停在哪，所以每次加载的表现一致，也能完整单测。
 *
 * @param {{position: number[], target: number[]}} pose 适配后的终点位姿
 * @param {{factor?: number, lift?: number}} [options]
 * @returns {{position: number[], target: number[]}|null} 位姿非法/无方向时返回 null（调用方退化为瞬时）
 */
export function computeEntranceStartPose(
  pose,
  { factor = ENTRANCE_START_FACTOR, lift = ENTRANCE_LIFT_FACTOR } = {},
) {
  const destination = normalizePose(pose)
  if (!destination) return null

  const safeFactor = Number.isFinite(factor)
    ? Math.min(ENTRANCE_FACTOR_RANGE.max, Math.max(ENTRANCE_FACTOR_RANGE.min, factor))
    : ENTRANCE_START_FACTOR
  const safeLift = Number.isFinite(lift) ? Math.max(0, lift) : ENTRANCE_LIFT_FACTOR

  // 不推远也不抬高时直接返回终点：保证与 CameraTween「起终点相同→不动画」的判定一致，
  // 也避免 tx + (px - tx) 这种浮点回环产生 1ULP 误差
  if (safeFactor === 1 && safeLift === 0) {
    return { position: [...destination.position], target: [...destination.target] }
  }

  const [px, py, pz] = destination.position
  const [tx, ty, tz] = destination.target
  const offset = [px - tx, py - ty, pz - tz]
  const distance = Math.hypot(offset[0], offset[1], offset[2])
  // 相机与目标重合时没有"视线方向"可推，交给调用方瞬时应用
  if (!(distance > 0)) return null

  return {
    position: [
      tx + offset[0] * safeFactor,
      ty + offset[1] * safeFactor + distance * safeLift,
      tz + offset[2] * safeFactor,
    ],
    target: [tx, ty, tz],
  }
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

  /*
   * 两端直接取原值，不走 lerp：
   * `a + (b - a) * 1` 在 IEEE754 下可能差 1ULP，而"终点与适配位姿**完全一致**"是本功能的硬要求
   * （否则连续切视角会留下极小但可累积的漂移，几何体也会有一丝错位）。
   */
  if (progress >= 1) {
    return { position: [...to.position], target: [...to.target], progress: 1, done: true }
  }
  if (progress <= 0) {
    return { position: [...from.position], target: [...from.target], progress: 0, done: false }
  }

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
