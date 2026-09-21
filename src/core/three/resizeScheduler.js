/**
 * 尺寸变化调度器（可注入、可单测）。
 *
 * 为什么单独抽出来：拖窗口边框时 ResizeObserver 会连续上报，每个事件都一路走到
 * postFx.setSize，而 EffectComposer 的 render target 一旦尺寸变化就会 dispose 并
 * 重新分配 GPU 纹理（4K + 4×MSAA 下这一下很贵）。本模块把连续上报合并成
 * 「每帧最多一次」，拖动过程只按最终尺寸重建。
 *
 * 与 renderLoop.js 同一套取舍：句柄先清空再执行回调，这样即使 onResize 抛错，
 * 也不会留下「看起来还挂着、实际再也不会触发」的僵尸句柄。
 */

/**
 * @param {object} options
 * @param {(callback: Function) => number} options.requestFrame 通常传 requestAnimationFrame
 * @param {(handle: number) => void} options.cancelFrame 通常传 cancelAnimationFrame
 * @param {() => void} options.onResize 真正执行尺寸调整（异常由调用方自行处理）
 */
export function createResizeScheduler({ requestFrame, cancelFrame, onResize } = {}) {
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new Error('createResizeScheduler 需要 requestFrame 与 cancelFrame')
  }
  if (typeof onResize !== 'function') {
    throw new Error('createResizeScheduler 需要 onResize 回调')
  }

  let handle = null

  function schedule() {
    // 已有待处理的帧就直接合并掉：这正是去抖的全部含义
    if (handle !== null) return false
    handle = requestFrame(() => {
      handle = null
      onResize()
    })
    return true
  }

  /** 撤销待处理的帧（销毁路径上用；此时 onResize 会访问已释放的对象） */
  function cancel() {
    if (handle === null) return false
    cancelFrame(handle)
    handle = null
    return true
  }

  return {
    schedule,
    cancel,
    get pending() {
      return handle !== null
    },
  }
}
