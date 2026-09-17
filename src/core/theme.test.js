import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_THEME_MODE,
  SYSTEM_DARK_QUERY,
  THEME_MODES,
  applyTheme,
  createSystemThemeWatcher,
  resolveTheme,
  resolveThemeMode,
  systemPrefersDark,
} from './theme.js'

/** 极简 document 替身：只覆盖 applyTheme 用到的 classList/style */
function createFakeDocument() {
  const classes = new Set()
  return {
    classes,
    documentElement: {
      classList: {
        toggle(name, force) {
          if (force) classes.add(name)
          else classes.delete(name)
        },
        contains: (name) => classes.has(name),
      },
      style: {},
    },
  }
}

/** 极简 matchMedia 替身 */
function createFakeMatchMedia(matches) {
  const listeners = new Set()
  return {
    listeners,
    target: {
      matchMedia: (query) => ({
        matches,
        media: query,
        addEventListener: (_type, handler) => listeners.add(handler),
        removeEventListener: (_type, handler) => listeners.delete(handler),
      }),
    },
  }
}

describe('THEME_MODES', () => {
  it('三个模式 id 唯一且可解析', () => {
    const ids = THEME_MODES.map((mode) => mode.id)
    expect(ids).toEqual(['dark', 'light', 'system'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolveThemeMode('light')).toBe('light')
    expect(resolveThemeMode('nope')).toBe(DEFAULT_THEME_MODE)
    expect(resolveThemeMode(undefined)).toBe(DEFAULT_THEME_MODE)
    expect(DEFAULT_THEME_MODE).toBe('dark')
  })
})

describe('resolveTheme', () => {
  it('固定模式与系统偏好', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('非法模式回退到默认（暗色），系统模式在无偏好信息时按亮色处理', () => {
    expect(resolveTheme('bogus', true)).toBe('dark')
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('切换 dark 类并同步 color-scheme', () => {
    const doc = createFakeDocument()
    expect(applyTheme('dark', doc)).toBe(true)
    expect(doc.classes.has('dark')).toBe(true)
    expect(doc.documentElement.style.colorScheme).toBe('dark')

    expect(applyTheme('light', doc)).toBe(true)
    expect(doc.classes.has('dark')).toBe(false)
    expect(doc.documentElement.style.colorScheme).toBe('light')
  })

  it('反复切换幂等，不会残留两套类名', () => {
    const doc = createFakeDocument()
    applyTheme('dark', doc)
    applyTheme('dark', doc)
    expect([...doc.classes]).toEqual(['dark'])
    applyTheme('light', doc)
    applyTheme('light', doc)
    expect([...doc.classes]).toEqual([])
  })

  it('无 document 时安全返回 false（SSR/测试环境）', () => {
    expect(applyTheme('dark', null)).toBe(false)
    expect(applyTheme('dark', {})).toBe(false)
  })
})

describe('systemPrefersDark / createSystemThemeWatcher', () => {
  it('读取系统偏好；不支持时按 false', () => {
    expect(systemPrefersDark(createFakeMatchMedia(true).target)).toBe(true)
    expect(systemPrefersDark(createFakeMatchMedia(false).target)).toBe(false)
    expect(systemPrefersDark({})).toBe(false)
    expect(SYSTEM_DARK_QUERY).toBe('(prefers-color-scheme: dark)')
  })

  it('订阅系统主题变化，返回值可取消订阅', () => {
    const fake = createFakeMatchMedia(false)
    const onChange = vi.fn()
    const stop = createSystemThemeWatcher({ onChange, target: fake.target })

    expect(fake.listeners.size).toBe(1)
    for (const handler of fake.listeners) handler({ matches: true })
    expect(onChange).toHaveBeenCalledWith(true)

    stop()
    expect(fake.listeners.size).toBe(0)
  })

  it('环境不支持 matchMedia 时返回空函数且不抛错', () => {
    const stop = createSystemThemeWatcher({ onChange: vi.fn(), target: {} })
    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
  })
})
