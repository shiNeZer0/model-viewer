/**
 * 当前模型的状态。
 *
 * 只有「可序列化的描述信息」进响应式；three 的 Object3D 用 shallowRef 持有，
 * 避免被 Vue 深度代理（会导致 three 内部比较失效并显著拖慢渲染）。
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

const STATUS = {
  empty: 'empty',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
}

export const useModelStore = defineStore('model', () => {
  const filePath = ref('')
  const fileName = ref('')
  const formatId = ref('')
  const sizeBytes = ref(0)

  /** empty | loading | ready | error */
  const status = ref(STATUS.empty)
  const errorMessage = ref('')
  /** 非致命提示（如扩展名与真实格式不一致） */
  const warnings = ref([])
  /** 加载失败的外部资源（.bin / .mtl / 贴图） */
  const missingResources = ref([])
  const progress = ref({ loaded: 0, total: 0 })
  const stats = ref(null)

  const root = shallowRef(null)

  const isReady = computed(() => status.value === STATUS.ready)
  const isLoading = computed(() => status.value === STATUS.loading)
  const hasModel = computed(() => root.value !== null)
  const progressPercent = computed(() => {
    const { loaded, total } = progress.value
    if (!total || total <= 0) return 0
    return Math.min(100, Math.round((loaded / total) * 100))
  })

  function beginLoading({ path, fileName: name, formatId: id }) {
    filePath.value = path
    fileName.value = name
    formatId.value = id
    status.value = STATUS.loading
    errorMessage.value = ''
    warnings.value = []
    missingResources.value = []
    progress.value = { loaded: 0, total: 0 }
    stats.value = null
  }

  function setProgress({ loaded = 0, total = 0 } = {}) {
    // total 为 0 表示服务端未提供长度：保留 indeterminate 状态
    progress.value = { loaded, total }
  }

  function setSizeBytes(value) {
    if (typeof value === 'number' && value >= 0) sizeBytes.value = value
  }

  function addWarning(message) {
    if (message && !warnings.value.includes(message)) warnings.value.push(message)
  }

  function addMissingResource(url) {
    if (url && !missingResources.value.includes(url)) missingResources.value.push(url)
  }

  function setReady({ root: modelRoot, stats: modelStats }) {
    root.value = modelRoot ?? null
    stats.value = modelStats ?? null
    status.value = STATUS.ready
    progress.value = { loaded: 0, total: 0 }
  }

  function setError(message) {
    errorMessage.value = message
    status.value = STATUS.error
    progress.value = { loaded: 0, total: 0 }
  }

  /** 取消或清空当前模型（保留统计清零，避免面板显示上一个模型的数据） */
  function reset() {
    filePath.value = ''
    fileName.value = ''
    formatId.value = ''
    sizeBytes.value = 0
    status.value = STATUS.empty
    errorMessage.value = ''
    warnings.value = []
    missingResources.value = []
    progress.value = { loaded: 0, total: 0 }
    stats.value = null
    root.value = null
  }

  return {
    STATUS,
    filePath,
    fileName,
    formatId,
    sizeBytes,
    status,
    errorMessage,
    warnings,
    missingResources,
    progress,
    stats,
    root,
    isReady,
    isLoading,
    hasModel,
    progressPercent,
    beginLoading,
    setProgress,
    setSizeBytes,
    addWarning,
    addMissingResource,
    setReady,
    setError,
    reset,
  }
})
