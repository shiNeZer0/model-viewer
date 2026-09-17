/**
 * 光照状态与自定义光照主题。
 *
 * 与 displayStore 的分工：
 * - displayStore 管「画面呈现」（着色、背景、色调、单位…）；
 * - 这里管「打光」（三点光源 + 环境贴图），并负责**主题**（= 光照 + 背景 + 色调的完整快照）。
 *
 * 预设与主题的区别：预设写死在代码里（随版本调优、不会被误删），主题存库（用户自己的）。
 * 应用主题时会把背景与色调一并写回 displayStore，这样"应用主题 = 复现当时看到的整体观感"。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

import {
  DEFAULT_PRESET_ID,
  resolvePreset,
  presetToState,
} from '../constants/presets/lightingPresets.js'
import {
  createDefaultLightingState,
  createThemePayload,
  normalizeLight,
  normalizeLightingState,
  parseThemePayload,
} from '../core/three/lighting.js'
import {
  deleteLightingTheme,
  listLightingThemes,
  readAllSettings,
  renameLightingTheme,
  upsertLightingTheme,
  writeSetting,
} from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'
import { useDisplayStore } from './displayStore.js'

const SETTING_KEYS = {
  state: 'lighting.state',
  activeThemeId: 'lighting.activeThemeId',
}

export const useLightingStore = defineStore('lighting', () => {
  const display = useDisplayStore()

  const lighting = reactive(createDefaultLightingState())
  const themes = ref([])
  const activeThemeId = ref(null)
  const loaded = ref(false)
  const loadError = ref('')

  /** 引擎消费的快照（纯数据，含三盏固定角色的光源） */
  const toEngineSettings = computed(() => ({
    presetId: lighting.presetId,
    ambient: { ...lighting.ambient },
    lights: lighting.lights.map((light) => ({ ...light })),
    environment: { ...lighting.environment },
  }))

  /** 当前是否与某个内置预设完全一致（UI 上高亮预设项） */
  const matchedPresetId = computed(() => {
    const preset = resolvePreset(lighting.presetId)
    return preset && activeThemeId.value === null ? preset.id : null
  })

  function replaceState(next) {
    const normalized = normalizeLightingState(next)
    lighting.presetId = normalized.presetId
    Object.assign(lighting.ambient, normalized.ambient)
    lighting.lights.splice(0, lighting.lights.length, ...normalized.lights)
    Object.assign(lighting.environment, normalized.environment)
  }

  async function persist(name, value) {
    const key = SETTING_KEYS[name]
    if (!key) return
    try {
      await writeSetting(key, value)
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn(`[lighting] 保存 ${key} 失败`, error)
    }
  }

  async function persistState() {
    await persist('state', toEngineSettings.value)
  }

  /** 把背景快照写回 displayStore（预设与主题共用） */
  async function applyBackgroundSnapshot(snapshot, { persist: shouldPersist = true } = {}) {
    if (!snapshot) return
    if (snapshot.mode) await display.update('background', snapshot.mode, { persist: shouldPersist })
    if (snapshot.color) {
      await display.update('backgroundColor', snapshot.color, { persist: shouldPersist })
    }
    if (snapshot.gradientTop) {
      await display.update('gradientTop', snapshot.gradientTop, { persist: shouldPersist })
    }
    if (snapshot.gradientBottom) {
      await display.update('gradientBottom', snapshot.gradientBottom, { persist: shouldPersist })
    }
  }

  /** 把色调快照写回 displayStore */
  async function applyRenderSnapshot(snapshot, { persist: shouldPersist = true } = {}) {
    if (!snapshot) return
    if (snapshot.toneMapping) {
      await display.update('toneMapping', snapshot.toneMapping, { persist: shouldPersist })
    }
    if (snapshot.exposure !== undefined) {
      await display.update('exposure', snapshot.exposure, { persist: shouldPersist })
    }
    if (snapshot.saturation !== undefined) {
      await display.update('saturation', snapshot.saturation, { persist: shouldPersist })
    }
    if (snapshot.postFxEnabled !== undefined) {
      await display.update('postFxEnabled', snapshot.postFxEnabled, { persist: shouldPersist })
    }
  }

  async function load() {
    try {
      const saved = await readAllSettings()

      const rawState = saved[SETTING_KEYS.state]
      if (rawState) {
        const parsed = parseThemePayload({ lighting: rawState }).payload
        if (parsed) replaceState(parsed.lighting)
      }

      const savedThemeId = saved[SETTING_KEYS.activeThemeId]
      activeThemeId.value = savedThemeId ?? null

      await refreshThemes()
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[lighting] 读取光照设置失败', error)
    } finally {
      loaded.value = true
    }
  }

  /* ------------------------------ 实时调节 ------------------------------ */

  async function updateAmbient(patch, { persist: shouldPersist = true } = {}) {
    Object.assign(
      lighting.ambient,
      normalizeLightingState({ ...toEngineSettings.value, ambient: { ...lighting.ambient, ...patch } })
        .ambient,
    )
    if (shouldPersist) await persistState()
  }

  async function updateLight(role, patch, { persist: shouldPersist = true } = {}) {
    const index = lighting.lights.findIndex((light) => light.role === role)
    if (index < 0) return
    lighting.lights[index] = normalizeLight({ ...lighting.lights[index], ...patch }, role)
    if (shouldPersist) await persistState()
  }

  async function updateEnvironment(patch, { persist: shouldPersist = true } = {}) {
    replaceState({
      ...toEngineSettings.value,
      environment: { ...lighting.environment, ...patch },
    })
    if (shouldPersist) await persistState()
  }

  /* ------------------------------ 预设与主题 ------------------------------ */

  /** 应用内置预设（同时套用它的背景与色调，保证整体观感一致） */
  async function applyPreset(presetId, { persist: shouldPersist = true } = {}) {
    const preset = resolvePreset(presetId)
    if (!preset) return
    replaceState(presetToState(preset))
    activeThemeId.value = null
    await applyBackgroundSnapshot(preset.background, { persist: shouldPersist })
    await applyRenderSnapshot(preset.render, { persist: shouldPersist })
    if (shouldPersist) {
      await persistState()
      await persist('activeThemeId', null)
    }
  }

  async function refreshThemes() {
    try {
      themes.value = await listLightingThemes()
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      themes.value = []
    }
    return themes.value
  }

  /** 保存当前观感为主题（同名覆盖） */
  async function saveTheme(name, { persist: shouldPersist = true } = {}) {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) throw new Error('主题名称不能为空')

    const payload = createThemePayload({
      lighting: toEngineSettings.value,
      background: display.backgroundSnapshot,
      render: display.renderSnapshot,
    })
    await upsertLightingTheme({ name: trimmed, payload })
    await refreshThemes()

    const saved = themes.value.find((theme) => theme.name === trimmed)
    if (saved && shouldPersist) {
      activeThemeId.value = saved.id
      await persist('activeThemeId', saved.id)
    }
    return saved ?? null
  }

  /** 应用主题：光照 + 背景 + 色调一并恢复 */
  async function applyTheme(themeId, { persist: shouldPersist = true } = {}) {
    const theme = themes.value.find((item) => String(item.id) === String(themeId))
    if (!theme) throw new Error('主题不存在')

    const result = parseThemePayload(theme.payload)
    if (!result.ok) throw new Error(result.error)

    replaceState(result.payload.lighting)
    await applyBackgroundSnapshot(result.payload.background, { persist: shouldPersist })
    await applyRenderSnapshot(result.payload.render, { persist: shouldPersist })

    activeThemeId.value = theme.id
    if (shouldPersist) {
      await persistState()
      await persist('activeThemeId', theme.id)
    }
    return result.payload
  }

  async function renameTheme(themeId, name) {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) throw new Error('主题名称不能为空')
    await renameLightingTheme(themeId, trimmed)
    await refreshThemes()
  }

  async function removeTheme(themeId) {
    await deleteLightingTheme(themeId)
    if (String(activeThemeId.value) === String(themeId)) {
      activeThemeId.value = null
      await persist('activeThemeId', null)
    }
    await refreshThemes()
  }

  function resetToDefault({ persist: shouldPersist = true } = {}) {
    return applyPreset(DEFAULT_PRESET_ID, { persist: shouldPersist })
  }

  return {
    SETTING_KEYS,
    lighting,
    themes,
    activeThemeId,
    matchedPresetId,
    loaded,
    loadError,
    toEngineSettings,
    load,
    updateAmbient,
    updateLight,
    updateEnvironment,
    applyPreset,
    saveTheme,
    applyTheme,
    renameTheme,
    removeTheme,
    refreshThemes,
    resetToDefault,
  }
})
