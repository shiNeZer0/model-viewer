<template>
  <div class="status-bar">
    <span class="status-bar__item">{{ fileName || '未打开模型' }}</span>
    <el-divider direction="vertical" />
    <span class="status-bar__item">{{ formatLabel }}</span>
    <el-divider direction="vertical" />
    <span class="status-bar__item">{{ sizeText }}</span>
    <el-divider direction="vertical" />
    <span class="status-bar__item">三角面 {{ triangleText }}</span>

    <div class="status-bar__spacer" />

    <el-tag v-if="runtimeLabel" size="small" type="info" effect="plain">{{ runtimeLabel }}</el-tag>
    <span class="status-bar__item">{{ fps }} FPS</span>
    <el-divider direction="vertical" />
    <el-tooltip :content="gpu" placement="top">
      <span class="status-bar__item status-bar__item--muted">{{ webglVersion }} · {{ gpuShort }}</span>
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  fileName: { type: String, default: '' },
  formatLabel: { type: String, default: '—' },
  sizeText: { type: String, default: '—' },
  triangleText: { type: String, default: '0' },
  fps: { type: Number, default: 0 },
  gpu: { type: String, default: '未知' },
  webglVersion: { type: String, default: '—' },
  /** 运行环境标签：桌面版 / Web 预览 */
  runtimeLabel: { type: String, default: '' },
})

/** GPU 全名很长（含驱动版本），状态栏只显示前 48 个字符，完整内容放 tooltip */
const gpuShort = computed(() =>
  props.gpu.length > 48 ? `${props.gpu.slice(0, 48)}…` : props.gpu,
)
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.status-bar__spacer {
  flex: 1;
}

.status-bar__item--muted {
  color: var(--el-text-color-secondary);
}
</style>
