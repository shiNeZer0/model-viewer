/**
 * 后处理通道的开关与参数。
 *
 * 为什么单独一个 store：通道会随效果增加，全塞进 displayStore 会让那个文件无限膨胀；
 * 而且通道设置是**结构化**的（每个通道一组参数），用一个 JSON 键持久化比十几个扁平键清楚。
 *
 * 默认值只维护一份 —— 直接取自通道定义（`DEFAULT_CHANNELS`），不在 store 里重写一遍，
 * 否则加一个通道就要记得改两处。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { DEFAULT_CHANNELS } from '../core/three/postfx.js'
import { readAllSettings, writeSetting } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

const SETTING_KEY = 'postfx.channels'

/** 通道 id → { enabled, settings } */
function buildDefaults() {
  const state = {}
  for (const definition of DEFAULT_CHANNELS) {
    state[definition.id] = {
      enabled: definition.defaultEnabled !== false,
      settings: { ...(definition.defaultSettings ?? {}) },
    }
  }
  return state
}

/**
 * 可持久化的形状：只保留 `ranges` 里声明过的键。
 *
 * `ranges` 恰好就是"UI 可调项"，于是引擎写入的运行时字段（GTAO 的 sceneRadius、
 * 景深的 focusDistance）天然被排除 —— 它们描述的是**当前这个模型**，跨会话沿用没有意义。
 */
function toPersistable(states) {
  const clean = {}
  for (const definition of DEFAULT_CHANNELS) {
    const state = states?.[definition.id]
    if (!state || typeof state !== 'object') continue
    const settings = {}
    for (const key of Object.keys(definition.ranges ?? {})) {
      const value = state.settings?.[key]
      if (value !== undefined) settings[key] = value
    }
    clean[definition.id] = { enabled: state.enabled !== false, settings }
  }
  return clean
}

/** 把读回来的数据收敛到合法结构：缺项补默认、非法数值丢弃、未知通道忽略 */
export function normalizeStoredChannels(raw) {
  const defaults = buildDefaults()
  if (!raw || typeof raw !== 'object') return defaults

  const merged = {}
  for (const definition of DEFAULT_CHANNELS) {
    const fallback = defaults[definition.id]
    const stored = raw[definition.id]
    if (!stored || typeof stored !== 'object') {
      merged[definition.id] = fallback
      continue
    }

    const settings = { ...fallback.settings }
    for (const key of Object.keys(definition.ranges ?? {})) {
      const value = stored.settings?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) settings[key] = value
    }
    merged[definition.id] = {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
      settings,
    }
  }
  return merged
}

export const usePostFxStore = defineStore('postfx', () => {
  const channelStates = ref(buildDefaults())
  const loaded = ref(false)
  const loadError = ref('')

  async function load() {
    try {
      const saved = await readAllSettings()
      channelStates.value = normalizeStoredChannels(saved[SETTING_KEY])
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[postfx] 读取后处理设置失败', error)
    } finally {
      loaded.value = true
    }
  }

  async function persist() {
    try {
      await writeSetting(SETTING_KEY, toPersistable(channelStates.value))
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[postfx] 保存后处理设置失败', error)
    }
  }

  function setEnabled(id, enabled, { persist: shouldPersist = true } = {}) {
    const state = channelStates.value[id]
    if (!state) return
    state.enabled = Boolean(enabled)
    if (shouldPersist) void persist()
  }

  /** 拖动中的实时预览传 { persist: false }，松手时再落库（避免高频写盘） */
  function setSetting(id, key, value, { persist: shouldPersist = true } = {}) {
    const state = channelStates.value[id]
    if (!state) return
    state.settings = { ...state.settings, [key]: value }
    if (shouldPersist) void persist()
  }

  /** 把某个通道的**可调参数**恢复成默认（不动开关，也不碰引擎写入的运行时字段） */
  function resetChannelSettings(id) {
    const definition = DEFAULT_CHANNELS.find((item) => item.id === id)
    const state = channelStates.value[id]
    if (!definition || !state) return

    const settings = { ...state.settings }
    for (const key of Object.keys(definition.ranges ?? {})) {
      settings[key] = definition.defaultSettings?.[key]
    }
    state.settings = settings
    void persist()
  }

  return {
    channelStates,
    loaded,
    loadError,
    load,
    setEnabled,
    setSetting,
    resetChannelSettings,
  }
})
