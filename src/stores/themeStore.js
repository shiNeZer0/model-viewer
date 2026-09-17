/**
 * 明暗主题状态。
 *
 * 独立成 store（而不是塞进 settingsStore）的理由：它需要一个「把设置落到 DOM」
 * 的副作用 + 系统主题监听的生命周期，职责与纯偏好读写不同，单独放着更清楚。
 * 设置仍写入同一张 viewer_settings（键 `appearance.theme`）。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  DEFAULT_THEME_MODE,
  applyTheme,
  createSystemThemeWatcher,
  resolveTheme,
  resolveThemeMode,
  systemPrefersDark,
} from '../core/theme.js'
import { readAllSettings, writeSetting } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

export const THEME_SETTING_KEY = 'appearance.theme'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(DEFAULT_THEME_MODE)
  /** 系统当前是否深色（仅在 mode === 'system' 时影响结果） */
  const systemDark = ref(systemPrefersDark())
  /** 实际生效的主题（'dark' | 'light'） */
  const applied = ref('dark')
  const loaded = ref(false)
  const loadError = ref('')

  let stopWatching = null

  const resolved = computed(() => resolveTheme(mode.value, systemDark.value))
  const isDark = computed(() => applied.value === 'dark')

  /** 把 resolved 落到 DOM 并记录 */
  function apply() {
    applied.value = resolved.value
    applyTheme(applied.value)
    return applied.value
  }

  /** 应用启动时调用一次：读设置 → 应用 → 按需订阅系统主题变化 */
  async function init() {
    try {
      const saved = await readAllSettings()
      if (typeof saved[THEME_SETTING_KEY] === 'string') {
        mode.value = resolveThemeMode(saved[THEME_SETTING_KEY])
      }
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[theme] 读取主题设置失败', error)
    } finally {
      loaded.value = true
    }

    systemDark.value = systemPrefersDark()
    stopWatching?.()
    stopWatching = createSystemThemeWatcher({
      onChange: (isDark) => {
        systemDark.value = isDark
        // 只有"跟随系统"时才需要立即重绘，其余模式不受系统变化影响
        if (mode.value === 'system') apply()
      },
    })

    return apply()
  }

  async function setMode(nextMode, { persist: shouldPersist = true } = {}) {
    mode.value = resolveThemeMode(nextMode)
    apply()
    if (!shouldPersist) return mode.value

    try {
      await writeSetting(THEME_SETTING_KEY, mode.value)
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[theme] 保存主题设置失败', error)
    }
    return mode.value
  }

  /** 组件卸载时解除系统监听（单页应用里通常只在测试中调用） */
  function dispose() {
    stopWatching?.()
    stopWatching = null
  }

  return {
    THEME_SETTING_KEY,
    mode,
    systemDark,
    applied,
    resolved,
    isDark,
    loaded,
    loadError,
    init,
    apply,
    setMode,
    dispose,
  }
})
