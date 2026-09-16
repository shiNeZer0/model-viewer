/**
 * 用户设置（持久化到 SQLite 的 viewer_settings 表）。
 *
 * 原则：持久化失败不能影响查看模型这个主流程 —— 所有写操作都吞掉异常并记录，
 * 只把错误信息暴露到设置页，让用户可以自己判断。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { readAllSettings, writeSetting } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

/** 前端属性名 → 数据库键名 */
const SETTING_KEYS = {
  autoRotate: 'viewer.autoRotate',
  autoRotateSpeed: 'viewer.autoRotateSpeed',
  grantMode: 'security.grantMode',
  maxPixelRatio: 'perf.maxPixelRatio',
}

export const useSettingsStore = defineStore('settings', () => {
  const autoRotate = ref(false)
  const autoRotateSpeed = ref(2)
  /** file | parent | parent-recursive（后端校验，非法值会报错） */
  const grantMode = ref('parent-recursive')
  const maxPixelRatio = ref(2)

  const loaded = ref(false)
  const loadError = ref('')

  async function load() {
    try {
      const saved = await readAllSettings()
      if (typeof saved[SETTING_KEYS.autoRotate] === 'boolean') {
        autoRotate.value = saved[SETTING_KEYS.autoRotate]
      }
      if (typeof saved[SETTING_KEYS.autoRotateSpeed] === 'number') {
        autoRotateSpeed.value = saved[SETTING_KEYS.autoRotateSpeed]
      }
      if (typeof saved[SETTING_KEYS.grantMode] === 'string') {
        grantMode.value = saved[SETTING_KEYS.grantMode]
      }
      if (typeof saved[SETTING_KEYS.maxPixelRatio] === 'number') {
        maxPixelRatio.value = saved[SETTING_KEYS.maxPixelRatio]
      }
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[settings] 读取设置失败', error)
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
      console.warn(`[settings] 保存 ${key} 失败`, error)
    }
  }

  async function setAutoRotate(value) {
    autoRotate.value = Boolean(value)
    await persist('autoRotate', autoRotate.value)
  }

  async function setAutoRotateSpeed(value) {
    autoRotateSpeed.value = value
    await persist('autoRotateSpeed', value)
  }

  async function setGrantMode(value) {
    grantMode.value = value
    await persist('grantMode', value)
  }

  async function setMaxPixelRatio(value) {
    maxPixelRatio.value = value
    await persist('maxPixelRatio', value)
  }

  return {
    SETTING_KEYS,
    autoRotate,
    autoRotateSpeed,
    grantMode,
    maxPixelRatio,
    loaded,
    loadError,
    load,
    setAutoRotate,
    setAutoRotateSpeed,
    setGrantMode,
    setMaxPixelRatio,
  }
})
