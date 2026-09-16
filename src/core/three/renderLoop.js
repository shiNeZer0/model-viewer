/**
 * 渲染循环调度器（可注入、可单测）。
 *
 * 为什么单独抽出来：引擎里原来的写法是「构造函数末尾 bind(this.tick)，但构造函数中途
 * 就会通过 handleResize → noteActivity → start 提前排帧」，把未绑定的 tick 交给 rAF，
 * 结果 this 为 undefined 抛错；而异常发生在 tick 的第一行，"已排好的下一帧" 句柄却留在
 * 了非 null 状态，后续 start() 全部被这一句挡掉——渲染循环直接永久死亡，界面上只表现为
 * "画布全黑"，极难排查。
 *
 * 本模块用两个不变式把这类问题封死：
 * 1. **句柄先清空再执行回调**：回调里无论怎么抛错，都不会留下"看起来还在跑"的僵尸句柄；
 * 2. **回调不绑定 this**：调度器只持有闭包，不依赖调用者的绑定时机。
 */

/**
 * @param {object} options
 * @param {(callback: Function) => number} options.requestFrame 通常传 requestAnimationFrame
 * @param {(handle: number) => void} options.cancelFrame 通常传 cancelAnimationFrame
 * @param {() => void} options.onFrame 每帧回调（异常由调用方自行处理）
 */
export function createRenderLoop({ requestFrame, cancelFrame, onFrame }) {
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new Error('createRenderLoop 需要 requestFrame 与 cancelFrame')
  }
  if (typeof onFrame !== 'function') {
    throw new Error('createRenderLoop 需要 onFrame 回调')
  }

  let handle = null

  function start() {
    // 已在运行则忽略：重复排帧会让帧率翻倍
    if (handle !== null) return false
    handle = requestFrame(fire)
    return true
  }

  function fire() {
    // 关键：先清空句柄，再执行回调。这样即使 onFrame 抛错（异常会冒泡到调用者，
    // 例如浏览器的 rAF 环境），循环也不会卡在"永远 running 但再也不出帧"的状态。
    handle = null
    onFrame()
  }

  function stop() {
    if (handle === null) return false
    cancelFrame(handle)
    handle = null
    return true
  }

  return {
    start,
    stop,
    get running() {
      return handle !== null
    },
  }
}
