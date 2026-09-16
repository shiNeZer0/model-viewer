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
      <span class="empty-hint__label">计划中（M5）</span>
      <el-tag v-for="format in pendingFormats" :key="format.id" size="small" type="info">
        {{ format.id }}
      </el-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { MODEL_FORMATS } from '../../constants/formats.js'
import { capabilities, isTauri } from '../../platform/index.js'

const emit = defineEmits(['open'])

// 明确区分「已实现」与「计划中」，避免用户拖入 FBX 后以为程序坏了
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
  pointer-events: none;
}

.empty-hint :deep(.el-empty),
.empty-hint :deep(.el-button),
.empty-hint__formats {
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
</style>
