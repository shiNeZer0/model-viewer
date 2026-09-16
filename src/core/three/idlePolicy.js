/**
 * 空闲停渲染策略（纯逻辑，可单测）。
 *
 * 查看器大部分时间画面是静止的，持续跑 requestAnimationFrame 会让桌面端白白占用 CPU/GPU。
 * 策略：有「持续工作」（转盘、动画播放）时始终渲染；否则交互结束后 idleMs 毫秒内继续渲染，
 * 之后彻底停掉 rAF，由输入事件重新唤醒（见 ViewerEngine.noteActivity）。
 */

export const DEFAULT_IDLE_MS = 5000

export function createIdlePolicy({ idleMs = DEFAULT_IDLE_MS } = {}) {
  const safeIdleMs = Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : DEFAULT_IDLE_MS
  let lastActivityMs = Number.NEGATIVE_INFINITY

  return {
    idleMs: safeIdleMs,

    /** 记录一次「需要继续渲染」的活动（鼠标操作、尺寸变化、设置变更等） */
    noteActivity(nowMs) {
      lastActivityMs = Number.isFinite(nowMs) ? nowMs : 0
    },

    /** 立即进入空闲（例如窗口失焦），下一次活动前不再渲染 */
    goIdle() {
      lastActivityMs = Number.NEGATIVE_INFINITY
    },

    setIdleMs(nextIdleMs) {
      if (Number.isFinite(nextIdleMs) && nextIdleMs >= 0) this.idleMs = nextIdleMs
    },

    /**
     * @param {number} nowMs
     * @param {{continuous?: boolean}} options continuous=true 表示转盘/动画等必须持续渲染
     */
    shouldRender(nowMs, { continuous = false } = {}) {
      if (continuous) return true
      const now = Number.isFinite(nowMs) ? nowMs : 0
      return now - lastActivityMs < this.idleMs
    },

    isIdle(nowMs, options) {
      return !this.shouldRender(nowMs, options)
    },
  }
}

/** 是否存在必须持续渲染的工作 */
export function hasContinuousWork({ autoRotate = false, animationPlaying = false } = {}) {
  return Boolean(autoRotate || animationPlaying)
}
