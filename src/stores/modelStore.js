/**
 * 当前模型的状态。
 *
 * 只有「可序列化的描述信息」进响应式；three 的 Object3D 用 shallowRef 持有，
 * 避免被 Vue 深度代理（会导致 three 内部比较失效并显著拖慢渲染）。
 */

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'

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

  /* ------------------------- M2：层级树与包围盒 ------------------------- */
  /** 层级数据（纯数据树，直接给 el-tree） */
  const hierarchy = ref([])
  const hierarchyCount = ref(0)
  const hierarchyTruncated = ref(false)
  const bounds = ref(null)
  const selectedNodeId = ref('')

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

  /* ------------------------- M2：层级与包围盒 ------------------------- */

  function setHierarchy(nodes, { count = 0, truncated = false } = {}) {
    hierarchy.value = Array.isArray(nodes) ? nodes : []
    hierarchyCount.value = count
    hierarchyTruncated.value = truncated
  }

  function setBounds(nextBounds) {
    // 包围盒里是 three 的 Box3/Vector3：整块标记为 raw，避免被 Vue 深度代理
    bounds.value = nextBounds ? markRaw(nextBounds) : null
  }

  function setSelectedNode(nodeId) {
    selectedNodeId.value = nodeId ?? ''
  }

  /**
   * 就地更新某个节点的可见性（不替换数组，避免 el-tree 丢失展开状态）。
   * 权威状态在引擎侧，这里只做 UI 回显。
   */
  function patchNodeVisibility(nodeId, visible) {
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          node.visible = visible
          return true
        }
        if (walk(node.children ?? [])) return true
      }
      return false
    }
    return walk(hierarchy.value)
  }

  /** 批量设置可见性回显（全部显示/隐藏） */
  function setAllVisibility(visible) {
    const walk = (nodes) => {
      for (const node of nodes) {
        node.visible = visible
        walk(node.children ?? [])
      }
    }
    walk(hierarchy.value)
  }

  /** 用引擎返回的权威可见性回填（重置覆盖后） */
  function applyVisibilityFlags(flags) {
    if (!flags?.get) return
    const walk = (nodes) => {
      for (const node of nodes) {
        node.visible = flags.get(node.id) ?? node.visible
        walk(node.children ?? [])
      }
    }
    walk(hierarchy.value)
  }

  function clearInspection() {
    hierarchy.value = []
    hierarchyCount.value = 0
    hierarchyTruncated.value = false
    bounds.value = null
    selectedNodeId.value = ''
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
    clearInspection()
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
    hierarchy,
    hierarchyCount,
    hierarchyTruncated,
    bounds,
    selectedNodeId,
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
    setHierarchy,
    setBounds,
    setSelectedNode,
    patchNodeVisibility,
    setAllVisibility,
    applyVisibilityFlags,
    clearInspection,
    reset,
  }
})
