<template>
  <div class="empty-hint">
    <el-empty :description="description">
      <template #image>
        <div class="empty-hint__glyph">3D</div>
      </template>
      <el-button type="primary" @click="emit('open')">打开模型</el-button>
    </el-empty>

    <div class="empty-hint__formats">
      <span class="empty-hint__label">已支持</span>
      <el-tag v-for="format in loadableFormats" :key="format.id" size="small" type="success">
        {{ format.id }}
      </el-tag>
      <!-- 只有在注册表里真的存在"暂无 loader"的格式时才提示，避免写死里程碑编号后过期 -->
      <template v-if="pendingFormats.length">
        <span class="empty-hint__label">计划中</span>
        <el-tag v-for="format in pendingFormats" :key="format.id" size="small" type="info">
          {{ format.id }}
        </el-tag>
      </template>
    </div>

    <!-- 最近打开：没有模型时是最顺手的入口，直接复用最近文件列表 -->
    <RecentFilesList
      v-if="recentEntries.length"
      :entries="recentEntries"
      :can-reopen="canReopenRecent"
      :limit="4"
      class="empty-hint__recent"
      @open="emit('open-recent', $event)"
      @remove="emit('remove-recent', $event)"
      @clear="emit('clear-recent')"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { MODEL_FORMATS } from '../../constants/formats.js'
import { capabilities, isTauri } from '../../platform/index.js'
import RecentFilesList from './RecentFilesList.vue'

defineProps({
  /** 最近文件记录（core/recentFiles.js 归一化后），由视图注入 */
  recentEntries: { type: Array, default: () => [] },
  /** 运行时是否支持按路径重开 */
  canReopenRecent: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'open-recent', 'remove-recent', 'clear-recent'])

// 明确区分「已实现」与「计划中」，避免用户拖入不支持的格式后以为程序坏了
const loadableFormats = computed(() => MODEL_FORMATS.filter((format) => format.loadable))
const pendingFormats = computed(() => MODEL_FORMATS.filter((format) => !format.loadable))

const description = computed(() =>
  isTauri
    ? '把三维模型文件拖到这里，或点击下方按钮选择（支持从资源管理器直接拖入）'
    : `${capabilities.runtimeLabel}：把模型文件拖到这里，或点击下方按钮选择（浏览器只能读取你主动选择的文件）`,
)
</script>

<style scoped>
.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16px;
  overflow: hidden;
  pointer-events: none;
}

.empty-hint :deep(.el-empty),
.empty-hint :deep(.el-button),
.empty-hint__formats,
.empty-hint__recent {
  pointer-events: auto;
}

.empty-hint__glyph {
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  color: var(--el-color-primary);
}

.empty-hint__formats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 420px;
}

.empty-hint__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 高度不够时（小窗口）优先保证列表可滚，不要把整块内容顶出视口 */
.empty-hint__recent {
  margin-top: 8px;
  min-height: 0;
}

.empty-hint__recent :deep(.recent-files__list) {
  max-height: 150px;
}
</style>
