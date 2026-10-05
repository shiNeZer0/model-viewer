import { describe, expect, it } from 'vitest'

import {
  BUILTIN_ENVIRONMENTS,
  BUILTIN_ENVIRONMENT_DIR,
  DEFAULT_BUILTIN_ENVIRONMENT_ID,
  builtinEnvironmentLabel,
  builtinEnvironmentUrl,
  resolveBuiltinEnvironment,
} from './builtinEnvironments.js'

describe('BUILTIN_ENVIRONMENTS 清单', () => {
  it('id 唯一、label 非空、文件名是 ASCII 且以 .hdr 结尾', () => {
    const ids = BUILTIN_ENVIRONMENTS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const item of BUILTIN_ENVIRONMENTS) {
      expect(item.label.length).toBeGreaterThan(0)
      // 文件名必须 ASCII：运行时经 URL 取，非 ASCII 路径在自定义协议/子路径部署下出过问题
      expect(item.file).toMatch(/^[a-z0-9-]+\.hdr$/)
    }

    const files = BUILTIN_ENVIRONMENTS.map((item) => item.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('默认 id 必须真的在清单里（否则首次切到「内置」会选中一个不存在的项）', () => {
    expect(resolveBuiltinEnvironment(DEFAULT_BUILTIN_ENVIRONMENT_ID)).toBeTruthy()
  })

  it('清单非空（空清单等于这个功能不存在）', () => {
    expect(BUILTIN_ENVIRONMENTS.length).toBeGreaterThan(0)
  })
})

describe('resolveBuiltinEnvironment', () => {
  it('按 id 取到清单项', () => {
    expect(resolveBuiltinEnvironment('mountain')?.file).toBe('mountain.hdr')
  })

  it('未知 id / 空值返回 null 而不是抛错（设置里可能残留旧 id）', () => {
    expect(resolveBuiltinEnvironment('nope')).toBe(null)
    expect(resolveBuiltinEnvironment('')).toBe(null)
    expect(resolveBuiltinEnvironment(undefined)).toBe(null)
  })
})

describe('builtinEnvironmentLabel', () => {
  it('返回中文显示名', () => {
    expect(builtinEnvironmentLabel('mountain')).toBe('山地')
  })

  it('找不到时回退到 id，避免界面出现空白', () => {
    expect(builtinEnvironmentLabel('nope')).toBe('nope')
    expect(builtinEnvironmentLabel(null)).toBe('')
  })
})

describe('builtinEnvironmentUrl', () => {
  it('拼出绝对 URL 且指向内置目录（相对路径在 Tauri / 子路径部署下会解析错）', () => {
    // jsdom 环境下 document.baseURI 可用；Node 下会回退到 http://localhost/
    const url = builtinEnvironmentUrl('stone-forest')
    expect(url).toMatch(/\/hdr\/stone-forest\.hdr$/)
    expect(url.startsWith('http')).toBe(true)
    expect(BUILTIN_ENVIRONMENT_DIR).toBe('hdr/')
  })

  it('未知 id 返回 null（调用方据此判定"没有可加载的贴图"）', () => {
    expect(builtinEnvironmentUrl('nope')).toBe(null)
    expect(builtinEnvironmentUrl(undefined)).toBe(null)
  })
})
