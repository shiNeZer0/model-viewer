import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CHANNELS } from '../core/three/postfx.js'
import { normalizeStoredChannels, usePostFxStore } from './postfxStore.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('normalizeStoredChannels', () => {
  it('空输入给出每个通道的默认状态（默认值只来自通道定义）', () => {
    const state = normalizeStoredChannels(undefined)

    for (const definition of DEFAULT_CHANNELS) {
      expect(state[definition.id].enabled).toBe(definition.defaultEnabled !== false)
    }
    expect(state.gtao).toBeTruthy()
    expect(state.outline).toBeTruthy()
  })

  it('保留已存的开关与数值参数，缺的参数沿用默认值', () => {
    const state = normalizeStoredChannels({
      gtao: { enabled: false, settings: { radius: 0.8 } },
    })

    expect(state.gtao.enabled).toBe(false)
    expect(state.gtao.settings.radius).toBe(0.8)
    expect(state.gtao.settings.intensity).toBeGreaterThan(0)
  })

  it('丢弃非法数值与非可调键（脏数据不能喂给着色器）', () => {
    const state = normalizeStoredChannels({
      gtao: { enabled: 'yes', settings: { radius: 'big', sceneRadius: 999 } },
    })

    // enabled 非法 → 回默认（AO 默认开）
    expect(state.gtao.enabled).toBe(true)
    expect(typeof state.gtao.settings.radius).toBe('number')
    // sceneRadius 是引擎写入的运行时字段，不在 ranges 里，读不回来
    expect(state.gtao.settings.sceneRadius).toBe(1)
  })

  it('未知通道被忽略（不往管线里塞不存在的通道）', () => {
    const state = normalizeStoredChannels({ nope: { enabled: true, settings: {} } })
    expect(state.nope).toBeUndefined()
  })

  it('整体非法输入回落到默认，而不是抛错', () => {
    expect(normalizeStoredChannels('abc').gtao).toBeTruthy()
    expect(normalizeStoredChannels(null).gtao).toBeTruthy()
    expect(normalizeStoredChannels([]).gtao).toBeTruthy()
  })
})

describe('postfxStore', () => {
  it('setEnabled / setSetting 更新内存状态', () => {
    const postfx = usePostFxStore()

    postfx.setEnabled('bloom', true, { persist: false })
    expect(postfx.channelStates.bloom.enabled).toBe(true)

    postfx.setSetting('bloom', 'strength', 1.2, { persist: false })
    expect(postfx.channelStates.bloom.settings.strength).toBe(1.2)
  })

  it('resetChannelSettings 只恢复可调参数，不动开关与引擎写入的运行时字段', () => {
    const postfx = usePostFxStore()
    postfx.setEnabled('gtao', false, { persist: false })
    postfx.setSetting('gtao', 'radius', 1.2, { persist: false })
    postfx.setSetting('gtao', 'sceneRadius', 42, { persist: false })

    postfx.resetChannelSettings('gtao')

    const state = postfx.channelStates.gtao
    expect(state.enabled).toBe(false)
    expect(state.settings.radius).not.toBe(1.2)
    // sceneRadius 描述的是"当前这个模型"，重置参数时不该被清掉
    expect(state.settings.sceneRadius).toBe(42)
  })

  it('未注册的通道 id 是空操作（设置里可能残留旧通道的键）', () => {
    const postfx = usePostFxStore()

    expect(() => postfx.setEnabled('nope', true, { persist: false })).not.toThrow()
    expect(() => postfx.setSetting('nope', 'x', 1, { persist: false })).not.toThrow()
    expect(() => postfx.resetChannelSettings('nope')).not.toThrow()
  })
})
