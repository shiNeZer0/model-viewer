/**
 * 「最近打开的文件」列表。
 *
 * 分工：存储后端只管读写原始记录（两端字段名还不一样），归一化/排序/相对时间交给
 * `core/recentFiles.js` 的纯函数，store 只负责「加载 → 归一化 → 暴露 + 乐观更新」。
 *
 * 与项目其他 store 同一原则：读写失败不能影响查看模型 —— 异常一律吞掉并记录到 loadError，
 * 界面上最多是列表不更新，而不是弹错或白屏。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { MAX_RECENT_FILES, normalizeRecentList, withoutRecentEntry } from '../core/recentFiles.js'
import { capabilities } from '../platform/index.js'
import { clearRecentFiles, listRecentFiles, removeRecentFile } from '../platform/storage/index.js'
import { describeError } from '../utils/error-messages.js'

export const useRecentStore = defineStore('recent', () => {
  /** @type {import('vue').Ref<Array<{path: string, fileName: string, formatId: string, sizeBytes: number|null, lastOpenedAtMs: number, openCount: number}>>} */
  const entries = ref([])
  const loaded = ref(false)
  const loadError = ref('')

  /** Web 预览（浏览器）拿不到绝对路径，列表只能当"曾打开过"的记录看，不能点开 */
  const canReopen = computed(() => capabilities.reopenByPath)

  async function load() {
    try {
      const rows = await listRecentFiles(MAX_RECENT_FILES)
      entries.value = normalizeRecentList(rows, { limit: MAX_RECENT_FILES })
      loadError.value = ''
    } catch (error) {
      loadError.value = describeError(error)
      console.warn('[recent] 读取最近文件失败', error)
    } finally {
      loaded.value = true
    }
  }

  /**
   * 打开成功后调用：重新读一遍列表，让新记录立刻出现、被重开的条目移到最前。
   * 只在已经加载过时刷新，避免空状态页未渲染时也白白查一次库。
   */
  async function refresh() {
    if (!loaded.value) return
    await load()
  }

  /** 移除单条（路径已失效时用户自己删掉）；先改界面再落库，失败回滚 */
  async function remove(filePath) {
    const previous = entries.value
    entries.value = withoutRecentEntry(previous, filePath)
    try {
      await removeRecentFile(filePath)
      loadError.value = ''
    } catch (error) {
      entries.value = previous
      loadError.value = describeError(error)
      console.warn('[recent] 删除最近文件记录失败', error)
    }
  }

  async function clear() {
    const previous = entries.value
    entries.value = []
    try {
      await clearRecentFiles()
      loadError.value = ''
    } catch (error) {
      entries.value = previous
      loadError.value = describeError(error)
      console.warn('[recent] 清空最近文件失败', error)
    }
  }

  return { MAX_RECENT_FILES, entries, loaded, loadError, canReopen, load, refresh, remove, clear }
})
