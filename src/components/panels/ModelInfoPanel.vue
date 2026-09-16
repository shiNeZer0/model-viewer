<template>
  <div class="info-panel">
    <el-descriptions title="文件" :column="1" size="small" border>
      <el-descriptions-item label="文件名">
        {{ model.fileName || '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="格式">{{ formatLabel }}</el-descriptions-item>
      <el-descriptions-item label="大小">{{ sizeText }}</el-descriptions-item>
      <el-descriptions-item :label="sourceLabel">{{ model.filePath || '—' }}</el-descriptions-item>
    </el-descriptions>

    <el-descriptions title="模型统计" :column="2" size="small" border class="info-panel__section">
      <el-descriptions-item label="网格">{{ stats.meshCount }}</el-descriptions-item>
      <el-descriptions-item label="三角面">{{ triangleText }}</el-descriptions-item>
      <el-descriptions-item label="顶点">{{ vertexText }}</el-descriptions-item>
      <el-descriptions-item label="材质/贴图">
        {{ stats.materialCount }} / {{ stats.textureCount }}
      </el-descriptions-item>
      <el-descriptions-item label="点/线">
        {{ stats.pointCount }} / {{ stats.lineCount }}
      </el-descriptions-item>
      <el-descriptions-item label="骨骼蒙皮">{{ stats.hasSkin ? '有' : '无' }}</el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-for="warning in model.warnings"
      :key="warning"
      class="info-panel__alert"
      type="warning"
      :title="warning"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="model.status === 'error'"
      class="info-panel__alert"
      type="error"
      :title="model.errorMessage"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="model.missingResources.length"
      class="info-panel__alert"
      type="error"
      :closable="false"
      show-icon
      :title="`有 ${model.missingResources.length} 个外部资源加载失败`"
    >
      <ul class="info-panel__list">
        <li v-for="resource in model.missingResources" :key="resource">{{ resource }}</li>
      </ul>
    </el-alert>

    <p class="info-panel__note">
      层级树、边界框尺寸与单位换算在 M2 补齐；动画控制面板在 M4 补齐。
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { resolveFormatById } from '../../constants/formats.js'
import { emptyStats } from '../../core/three/stats.js'
import { isTauri } from '../../platform/index.js'
import { useModelStore } from '../../stores/modelStore.js'
import { formatBytes, formatCount } from '../../utils/format.js'

const model = useModelStore()

const stats = computed(() => model.stats ?? emptyStats())
// Web 端拿不到绝对路径，只有「文件名::大小」的合成标识，标签需相应调整
const sourceLabel = computed(() => (isTauri ? '路径' : '标识'))
const formatLabel = computed(() => {
  const format = resolveFormatById(model.formatId)
  return format ? `${format.label}（.${format.id}）` : '—'
})
const sizeText = computed(() => formatBytes(model.sizeBytes))
const triangleText = computed(() => formatCount(stats.value.triangleCount))
const vertexText = computed(() => formatCount(stats.value.vertexCount))
</script>

<style scoped>
.info-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.info-panel__section {
  margin-top: 4px;
}

.info-panel__alert {
  margin: 0;
}

.info-panel__list {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
  word-break: break-all;
}

.info-panel__note {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
