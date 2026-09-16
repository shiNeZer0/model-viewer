/**
 * 显示设置（着色模式 / 背景 / 辅助显示 / 后处理 / 空闲策略）。
 *
 * 与 settingsStore 的分工：settingsStore 放「观看行为」类设置（转盘、像素比、授权模式），
 * 这里放「画面呈现」类设置。两者都持久化到 viewer_settings（桌面 SQLite / Web localStorage）。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { DEFAULT_IDLE_MS } from '../core/three/idlePolicy.js'
import { DEFAULT_SATURATION, normalizePostFxSettings } from '../core/three/postfx.js'
import { DEFAULT_SHADE_MODE, resolveShadeMode } from '../core/three/shadeModes.js'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_GRADIENT_BOTTOM,
  DEFAULT_GRADIENT_TOP,
  resolveBackgroundMode,
} from '../core/three/stage.js'
import { readAllSettings, writeSetting } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

const SETTING_KEYS = {
  shadingMode: 'display.shadingMode',
  background: 'display.background',
  backgroundColor: 'display.backgroundColor',
  gradientTop: 'display.gradientTop',
  gradientBottom: 'display.gradientBottom',
  showGrid: 'display.showGrid',
  showAxes: 'display.showAxes',
  toneMapping: 'display.toneMapping',
  exposure: 'display.exposure',
  saturation: 'display.saturation',
  postFxEnabled: 'display.postFxEnabled',
  idleMs: 'perf.idleMs',
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function asColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
}

export const useDisplayStore = defineStore('display', () => {
  const shadingMode = ref(DEFAULT_SHADE_MODE)
  const background = ref(DEFAULT_BACKGROUND_MODE)
  const backgroundColor = ref(DEFAULT_BACKGROUND_COLOR)
  const gradientTop = ref(DEFAULT_GRADIENT_TOP)
  const gradientBottom = ref(DEFAULT_GRADIENT_BOTTOM)
  const showGrid = ref(false)
  const showAxes = ref(true)

  const toneMapping = ref(normalizePostFxSettings().toneMapping)
  const exposure = ref(1)
  const saturation = ref(DEFAULT_SATURATION)
  const postFxEnabled = ref(true)

  const idleMs = ref(DEFAULT_IDLE_MS)

  /** 引擎应用设置后回传的提示（例如「模型过大已跳过线框」） */
  const notes = ref([])
  const loaded = ref(false)
  const loadError = ref('')

  /** 引擎消费的完整设置快照 */
  const toEngineSettings = computed(() => ({
    shadingMode: shadingMode.value,
    background: background.value,
    backgroundColor: backgroundColor.value,
    gradientTop: gradientTop.value,
    gradientBottom: gradientBottom.value,
    showGrid: showGrid.value,
    showAxes: showAxes.value,
    toneMapping: toneMapping.value,
    exposure: exposure.value,
    saturation: saturation.value,
    postFxEnabled: postFxEnabled.value,
    idleMs: idleMs.value,
  }))

  async function load() {
    try {
      const saved = await readAllSettings()

      if (resolveShadeMode(saved[SETTING_KEYS.shadingMode])) {
        shadingMode.value = saved[SETTING_KEYS.shadingMode]
      }
      if (resolveBackgroundMode(saved[SETTING_KEYS.background])) {
        background.value = saved[SETTING_KEYS.background]
      }
      backgroundColor.value = asColor(saved[SETTING_KEYS.backgroundColor], DEFAULT_BACKGROUND_COLOR)
      gradientTop.value = asColor(saved[SETTING_KEYS.gradientTop], DEFAULT_GRADIENT_TOP)
      gradientBottom.value = asColor(saved[SETTING_KEYS.gradientBottom], DEFAULT_GRADIENT_BOTTOM)

      if (typeof saved[SETTING_KEYS.showGrid] === 'boolean') {
        showGrid.value = saved[SETTING_KEYS.showGrid]
      }
      if (typeof saved[SETTING_KEYS.showAxes] === 'boolean') {
        showAxes.value = saved[SETTING_KEYS.showAxes]
      }

      const postFx = normalizePostFxSettings({
        toneMapping: saved[SETTING_KEYS.toneMapping],
        exposure: saved[SETTING_KEYS.exposure],
        saturation: saved[SETTING_KEYS.saturation],
        enabled: saved[SETTING_KEYS.postFxEnabled],
      })
      toneMapping.value = postFx.toneMapping
      exposure.value = postFx.exposure
      saturation.value = postFx.saturation
      postFxEnabled.value = postFx.enabled

      const savedIdleMs = saved[SETTING_KEYS.idleMs]
      if (Number.isFinite(savedIdleMs) && savedIdleMs >= 0) idleMs.value = savedIdleMs

      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[display] 读取显示设置失败', error)
    } finally {
      loaded.value = true
    }
  }

  async function persist(name, value) {
    const key = SETTING_KEYS[name]
    if (!key) return
    try {
      await writeSetting(key, value)
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn(`[display] 保存 ${key} 失败`, error)
    }
  }

  /**
   * 统一的设置入口：默认持久化。
   * 滑杆拖动中的实时预览用 { persist: false }，松手时再落库，避免高频写盘。
   */
  async function update(name, value, { persist: shouldPersist = true } = {}) {
    switch (name) {
      case 'shadingMode':
        if (!resolveShadeMode(value)) return
        shadingMode.value = value
        break
      case 'background':
        if (!resolveBackgroundMode(value)) return
        background.value = value
        break
      case 'backgroundColor':
        backgroundColor.value = asColor(value, DEFAULT_BACKGROUND_COLOR)
        break
      case 'gradientTop':
        gradientTop.value = asColor(value, DEFAULT_GRADIENT_TOP)
        break
      case 'gradientBottom':
        gradientBottom.value = asColor(value, DEFAULT_GRADIENT_BOTTOM)
        break
      case 'showGrid':
        showGrid.value = Boolean(value)
        break
      case 'showAxes':
        showAxes.value = Boolean(value)
        break
      case 'toneMapping':
        toneMapping.value = normalizePostFxSettings({ toneMapping: value }).toneMapping
        break
      case 'exposure':
        exposure.value = normalizePostFxSettings({ exposure: value }).exposure
        break
      case 'saturation':
        saturation.value = normalizePostFxSettings({ saturation: value }).saturation
        break
      case 'postFxEnabled':
        postFxEnabled.value = Boolean(value)
        break
      case 'idleMs':
        idleMs.value = Number.isFinite(value) && value >= 0 ? value : DEFAULT_IDLE_MS
        break
      default:
        return
    }
    if (shouldPersist) await persist(name, toEngineSettings.value[name])
  }

  function setNotes(list) {
    notes.value = Array.isArray(list) ? [...new Set(list.filter(Boolean))] : []
  }

  /** 恢复出厂显示设置（不写库，由调用方决定是否持久化） */
  function resetToDefaults() {
    shadingMode.value = DEFAULT_SHADE_MODE
    background.value = DEFAULT_BACKGROUND_MODE
    backgroundColor.value = DEFAULT_BACKGROUND_COLOR
    gradientTop.value = DEFAULT_GRADIENT_TOP
    gradientBottom.value = DEFAULT_GRADIENT_BOTTOM
    showGrid.value = false
    showAxes.value = true
    toneMapping.value = normalizePostFxSettings().toneMapping
    exposure.value = 1
    saturation.value = DEFAULT_SATURATION
    postFxEnabled.value = true
    idleMs.value = DEFAULT_IDLE_MS
  }

  return {
    SETTING_KEYS,
    shadingMode,
    background,
    backgroundColor,
    gradientTop,
    gradientBottom,
    showGrid,
    showAxes,
    toneMapping,
    exposure,
    saturation,
    postFxEnabled,
    idleMs,
    notes,
    loaded,
    loadError,
    toEngineSettings,
    load,
    update,
    setNotes,
    resetToDefaults,
  }
})
