import { describe, expect, it, vi } from 'vitest'

import { createRenderLoop } from './renderLoop.js'

/** 可控的 rAF 替身：手动 flush 才执行回调，便于断言排帧次数 */
function createFakeScheduler() {
  let nextHandle = 1
  const callbacks = new Map()
  const cancelled = []

  return {
    requestFrame: vi.fn((callback) => {
      const handle = nextHandle
      nextHandle += 1
      callbacks.set(handle, callback)
      return handle
    }),
    cancelFrame: vi.fn((handle) => {
      cancelled.push(handle)
      callbacks.delete(handle)
    }),
    /** 执行所有已排队的帧 */
    flush() {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of pending) callback()
    },
    get pendingCount() {
      return callbacks.size
    },
    cancelled,
  }
}

describe('createRenderLoop', () => {
  it('start 排一帧，重复 start 不会重复排帧', () => {
    const scheduler = createFakeScheduler()
    const onFrame = vi.fn()
    const loop = createRenderLoop({ ...scheduler, onFrame })

    expect(loop.start()).toBe(true)
    expect(loop.start()).toBe(false)
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1)
    expect(loop.running).toBe(true)
  })

  it('执行一帧后需要再次 start 才会继续（由 onFrame 决定）', () => {
    const scheduler = createFakeScheduler()
    let frames = 0
    const loop = createRenderLoop({
      ...scheduler,
      onFrame: () => {
        frames += 1
        if (frames < 3) loop.start()
      },
    })

    loop.start()
    scheduler.flush()
    expect(frames).toBe(1)
    expect(loop.running).toBe(true) // onFrame 里重新排了帧

    scheduler.flush()
    expect(frames).toBe(2)
    scheduler.flush()
    expect(frames).toBe(3)
    // 第三次回调不再重新排帧 → 循环自然停下
    expect(loop.running).toBe(false)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('stop 取消待执行帧并允许重新 start', () => {
    const scheduler = createFakeScheduler()
    const onFrame = vi.fn()
    const loop = createRenderLoop({ ...scheduler, onFrame })

    loop.start()
    expect(loop.stop()).toBe(true)
    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1)
    expect(loop.running).toBe(false)
    expect(loop.stop()).toBe(false) // 已停时 stop 是幂等的

    scheduler.flush() // 被取消的帧不应执行
    expect(onFrame).not.toHaveBeenCalled()

    expect(loop.start()).toBe(true)
    expect(loop.running).toBe(true)
  })

  it('onFrame 抛错不会留下僵尸句柄：循环仍可重新启动', () => {
    const scheduler = createFakeScheduler()
    const onFrame = vi.fn(() => {
      throw new Error('boom')
    })
    const loop = createRenderLoop({ ...scheduler, onFrame })

    loop.start()
    expect(() => scheduler.flush()).toThrow('boom')
    // 这正是线上事故的关键：抛错后必须回到"未运行"状态，否则 start() 会被挡掉
    expect(loop.running).toBe(false)
    expect(loop.start()).toBe(true)
    expect(loop.running).toBe(true)
  })

  it('缺少必需参数时立即报错（fail fast）', () => {
    expect(() => createRenderLoop({ cancelFrame: vi.fn(), onFrame: vi.fn() })).toThrow()
    expect(() => createRenderLoop({ requestFrame: vi.fn(), onFrame: vi.fn() })).toThrow()
    expect(() => createRenderLoop({ requestFrame: vi.fn(), cancelFrame: vi.fn() })).toThrow()
  })
})
