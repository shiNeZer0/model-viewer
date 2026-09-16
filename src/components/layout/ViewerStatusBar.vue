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

    <!-- 渲染异常优先展示：画面出问题时这是唯一能直接看到的原因 -->
    <span v-if="errorText" class="status-bar__item status-bar__item--error">
      ⚠ {{ errorText }}
    </span>

    <el-tag v-if="runtimeLabel" size="small" type="info" effect="plain">{{ runtimeLabel }}</el-tag>
    <span class="status-bar__item">{{ fps }} FPS</span>
    <el-divider direction="vertical" />
    <el-tooltip content="累计成功渲染帧数；长期为 0 说明渲染循环没有出图" placement="top">
      <span class="status-bar__item status-bar__item--muted">帧 {{ frames }}</span>
    </el-tooltip>
    <el-divider direction="vertical" />
    <el-tooltip :content="`${gpu}${postFx === false ? '（已关闭后处理）' : ''}`" placement="top">
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
  /** 累计渲染帧数（排障指标） */
  frames: { type: Number, default: 0 },
  /** 后处理是否开启 */
  postFx: { type: Boolean, default: true },
  /** 渲染异常文案；非空时高亮显示 */
  errorText: { type: String, default: '' },
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

.status-bar__item--error {
  max-width: 46%;
  overflow: hidden;
  color: var(--el-color-danger);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
