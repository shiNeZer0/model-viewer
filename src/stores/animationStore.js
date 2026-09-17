/**
 * 动画播放状态（M4）。
 *
 * 分工：真实的 AnimationMixer 与 action 在引擎侧（`core/three/animation.js`），
 * 这里只保存 UI 需要的**纯数据**（片段列表、当前片段、播放中、时间轴、倍速、循环模式），
 * 由引擎每帧回调 `applyState` 同步过来。用户操作走 Viewer.vue → 引擎 → 回写本 store，
 * 保持"three 对象绝不进响应式"的既有约束。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  DEFAULT_LOOP_MODE,
  DEFAULT_SPEED,
  formatClipDuration,
  normalizeLoopMode,
  normalizeSpeed,
  timeToNormalized,
} from '../core/three/animation.js'
import { readAllSettings, writeSetting } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

const SETTING_KEYS = {
  speed: 'animation.speed',
  loopMode: 'animation.loopMode',
}

export const useAnimationStore = defineStore('animation', () => {
  /** 片段描述数组（来自 AnimationController.descriptions） */
  const clips = ref([])
  const clipId = ref(null)
  const clipName = ref('')
  const playing = ref(false)
  const finished = ref(false)
  const speed = ref(DEFAULT_SPEED)
  const loopMode = ref(DEFAULT_LOOP_MODE)
  const time = ref(0)
  const duration = ref(0)

  const loaded = ref(false)
  const loadError = ref('')

  const hasClips = computed(() => clips.value.length > 0)
  const normalized = computed(() => timeToNormalized(time.value, duration.value))
  const durationText = computed(() => formatClipDuration(duration.value))
  /** 时间轴刻度文案：`当前 / 总长` */
  const timeText = computed(
    () => `${time.value.toFixed(2)} / ${duration.value.toFixed(2)} 秒`,
  )

  async function load() {
    try {
      const saved = await readAllSettings()
      if (Number.isFinite(saved[SETTING_KEYS.speed])) {
        speed.value = normalizeSpeed(saved[SETTING_KEYS.speed])
      }
      if (typeof saved[SETTING_KEYS.loopMode] === 'string') {
        loopMode.value = normalizeLoopMode(saved[SETTING_KEYS.loopMode])
      }
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[animation] 读取动画设置失败', error)
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
      console.warn(`[animation] 保存 ${key} 失败`, error)
    }
  }

  /** 模型加载后写入片段列表 */
  function setClips(list) {
    clips.value = Array.isArray(list) ? list : []
  }

  /** 引擎每帧/每次操作后回写运行状态（唯一的状态同步入口） */
  function applyState(state) {
    if (!state) return
    clipId.value = state.clipId ?? null
    clipName.value = state.clipName ?? ''
    playing.value = Boolean(state.playing)
    finished.value = Boolean(state.finished)
    time.value = Number.isFinite(state.time) ? state.time : 0
    duration.value = Number.isFinite(state.duration) ? state.duration : 0
    if (Number.isFinite(state.speed)) speed.value = state.speed
    if (state.loopMode) loopMode.value = normalizeLoopMode(state.loopMode)
  }

  async function setSpeed(value, { persist: shouldPersist = true } = {}) {
    speed.value = normalizeSpeed(value)
    if (shouldPersist) await persist('speed', speed.value)
    return speed.value
  }

  async function setLoopMode(value, { persist: shouldPersist = true } = {}) {
    loopMode.value = normalizeLoopMode(value)
    if (shouldPersist) await persist('loopMode', loopMode.value)
    return loopMode.value
  }

  /** 换模型/清空时调用：片段与运行状态都归零，但保留用户的倍速与循环偏好 */
  function reset() {
    clips.value = []
    clipId.value = null
    clipName.value = ''
    playing.value = false
    finished.value = false
    time.value = 0
    duration.value = 0
  }

  return {
    SETTING_KEYS,
    clips,
    clipId,
    clipName,
    playing,
    finished,
    speed,
    loopMode,
    time,
    duration,
    loaded,
    loadError,
    hasClips,
    normalized,
    durationText,
    timeText,
    load,
    setClips,
    applyState,
    setSpeed,
    setLoopMode,
    reset,
  }
})
