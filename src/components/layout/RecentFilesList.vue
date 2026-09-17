<template>
  <div class="recent-files" :class="{ 'recent-files--compact': compact }">
    <div v-if="entries.length" class="recent-files__header">
      <span class="recent-files__title">最近打开</span>
      <el-button text size="small" @click="emit('clear')">清空</el-button>
    </div>

    <p v-if="entries.length && !canReopen" class="recent-files__note">
      Web 预览无法按路径重开，历史记录仅供参考，请重新选择文件。
    </p>

    <p v-if="!entries.length" class="recent-files__empty">还没有打开过模型文件</p>

    <ul v-else class="recent-files__list">
      <li v-for="entry in visibleEntries" :key="entry.path" class="recent-files__item">
        <button
          type="button"
          class="recent-files__open"
          :disabled="!canReopen"
          :title="canReopen ? `重新打开：${entry.path}` : entry.path"
          @click="emit('open', entry.path)"
        >
          <span class="recent-files__name">{{ entry.fileName }}</span>
          <span class="recent-files__meta">
            <el-tag v-if="entry.formatId" size="small" type="info" effect="plain">
              {{ entry.formatId }}
            </el-tag>
            <span>{{ formatBytes(entry.sizeBytes) }}</span>
            <span>{{ describeRecentTime(entry.lastOpenedAtMs) }}</span>
            <span v-if="entry.openCount > 1">打开 {{ entry.openCount }} 次</span>
          </span>
        </button>

        <el-tooltip content="从列表移除" placement="left">
          <el-button
            class="recent-files__remove"
            text
            size="small"
            @click="emit('remove', entry.path)"
          >
            ✕
          </el-button>
        </el-tooltip>
      </li>
    </ul>

    <p v-if="entries.length > limit" class="recent-files__more">
      仅显示最近 {{ limit }} 条，共 {{ entries.length }} 条
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { describeRecentTime } from '../../core/recentFiles.js'
import { formatBytes } from '../../utils/format.js'

const props = defineProps({
  /** core/recentFiles.js 归一化后的记录（不要直接传后端原始行） */
  entries: { type: Array, default: () => [] },
  /** 运行时是否支持按路径重开（桌面 true / Web false，取自 capabilities.reopenByPath） */
  canReopen: { type: Boolean, default: false },
  /** 紧凑排版：用在工具栏弹层里 */
  compact: { type: Boolean, default: false },
  /** 最多显示条数（记录里可能存到 20 条，弹层里没必要全列） */
  limit: { type: Number, default: 6 },
})

const emit = defineEmits(['open', 'remove', 'clear'])

const visibleEntries = computed(() => props.entries.slice(0, props.limit))
</script>

<style scoped>
.recent-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 420px;
  color: var(--el-text-color-primary);
}

.recent-files__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.recent-files__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.recent-files__note,
.recent-files__empty,
.recent-files__more {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.recent-files__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
}

.recent-files__item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 4px;
}

.recent-files__item:hover {
  background-color: var(--el-fill-color-light);
}

.recent-files__open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}

.recent-files__open:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.recent-files__open:not(:disabled):hover .recent-files__name {
  color: var(--el-color-primary);
}

.recent-files__name {
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-files__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.recent-files__more {
  text-align: center;
}

/* 移除按钮默认淡出，避免列表显得嘈杂；鼠标移到条目上再显现 */
.recent-files__remove {
  opacity: 0;
  transition: opacity 0.15s;
}

.recent-files__item:hover .recent-files__remove,
.recent-files__remove:focus-visible {
  opacity: 1;
}

.recent-files--compact .recent-files__list {
  max-height: 220px;
}

.recent-files--compact .recent-files__open {
  padding: 4px 6px;
}
</style>
