import { describe, expect, it, vi } from 'vitest'

import { isTypingTarget, resolveHotkey } from './useHotkeys.js'

const keyEvent = (key, extra = {}) => ({ key, target: null, ...extra })

describe('isTypingTarget', () => {
  it('输入类元素与可编辑区域返回 true', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
    expect(isTypingTarget({ isContentEditable: true })).toBe(true)
  })

  it('普通元素与空值返回 false', () => {
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })
})

describe('resolveHotkey', () => {
  it('按键命中处理器（大小写不敏感）', () => {
    const front = vi.fn()
    const handlers = { '1': front, f: vi.fn() }
    expect(resolveHotkey(handlers, keyEvent('1'))).toBe(front)
  })

  it('大写字母也能命中（CapsLock / Shift 场景）', () => {
    const fit = vi.fn()
    expect(resolveHotkey({ f: fit }, keyEvent('F'))).toBe(fit)
  })

  it('未登记的按键返回 null', () => {
    expect(resolveHotkey({ f: vi.fn() }, keyEvent('q'))).toBe(null)
    expect(resolveHotkey(null, keyEvent('f'))).toBe(null)
    expect(resolveHotkey({ f: vi.fn() }, null)).toBe(null)
  })

  it('带修饰键时不触发（不抢占系统快捷键）', () => {
    const fit = vi.fn()
    expect(resolveHotkey({ f: fit }, keyEvent('f', { ctrlKey: true }))).toBe(null)
    expect(resolveHotkey({ f: fit }, keyEvent('f', { metaKey: true }))).toBe(null)
    expect(resolveHotkey({ f: fit }, keyEvent('f', { altKey: true }))).toBe(null)
  })

  it('焦点在输入框时不触发', () => {
    const fit = vi.fn()
    expect(resolveHotkey({ f: fit }, keyEvent('f', { target: { tagName: 'INPUT' } }))).toBe(null)
  })
})
