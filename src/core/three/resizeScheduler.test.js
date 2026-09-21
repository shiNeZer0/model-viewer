import { describe, expect, it } from 'vitest'

import { createResizeScheduler } from './resizeScheduler.js'

/** 受控的帧时钟替身：手动决定"这一帧什么时候被触发" */
function createFrameClock() {
  let nextHandle = 1
  const pending = new Map()
  return {
    requestFrame(callback) {
      const handle = nextHandle
      nextHandle += 1
      pending.set(handle, callback)
      return handle
    },
    cancelFrame(handle) {
      pending.delete(handle)
    },
    /** 触发当前所有排队中的帧 */
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
    get size() {
      return pending.size
    },
  }
}

function setup() {
  const clock = createFrameClock()
  let resizeCount = 0
  const scheduler = createResizeScheduler({
    requestFrame: (callback) => clock.requestFrame(callback),
    cancelFrame: (handle) => clock.cancelFrame(handle),
    onResize: () => {
      resizeCount += 1
    },
  })
  return { clock, scheduler, count: () => resizeCount }
}

describe('createResizeScheduler', () => {
  it('连续上报只排一次帧（这是去抖的全部目的）', () => {
    const { clock, scheduler, count } = setup()
    expect(scheduler.schedule()).toBe(true)
    // 后续 9 次上报应被合并掉，不得再排帧
    for (let i = 0; i < 9; i += 1) expect(scheduler.schedule()).toBe(false)
    expect(clock.size).toBe(1)

    clock.flush()
    expect(count()).toBe(1)
    expect(scheduler.pending).toBe(false)
  })

  it('一帧之内只执行一次，下一帧可以再次调度', () => {
    const { clock, scheduler, count } = setup()
    scheduler.schedule()
    scheduler.schedule()
    clock.flush()
    expect(count()).toBe(1)

    // 新的一轮上报必须能再次排帧，否则拖动结束后尺寸就再也不更新了
    expect(scheduler.schedule()).toBe(true)
    clock.flush()
    expect(count()).toBe(2)
  })

  it('cancel 撤销待处理的帧，之后不再执行', () => {
    const { clock, scheduler, count } = setup()
    scheduler.schedule()
    expect(scheduler.pending).toBe(true)
    expect(scheduler.cancel()).toBe(true)
    expect(scheduler.pending).toBe(false)

    clock.flush()
    expect(count()).toBe(0)
    // 已撤销后再 cancel 是空操作
    expect(scheduler.cancel()).toBe(false)
  })

  it('onResize 抛错也不会留下僵尸句柄', () => {
    const clock = createFrameClock()
    const scheduler = createResizeScheduler({
      requestFrame: (callback) => clock.requestFrame(callback),
      cancelFrame: (handle) => clock.cancelFrame(handle),
      onResize: () => {
        throw new Error('boom')
      },
    })
    scheduler.schedule()
    expect(() => clock.flush()).toThrow('boom')
    // 句柄已先清空：调度器不会卡在"pending 但永不触发"的状态
    expect(scheduler.pending).toBe(false)
    expect(scheduler.schedule()).toBe(true)
  })

  it('缺少必要依赖时立即抛错（配置错误要快速失败）', () => {
    expect(() => createResizeScheduler()).toThrow('requestFrame')
    expect(() => createResizeScheduler({ requestFrame: () => 1 })).toThrow('requestFrame')
    expect(() =>
      createResizeScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    ).toThrow('onResize')
  })
})
