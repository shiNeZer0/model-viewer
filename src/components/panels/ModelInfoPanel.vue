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

    <el-divider content-position="left">尺寸与单位</el-divider>

    <el-form label-width="76px" label-position="left" size="small">
      <el-form-item label="边界框">
        <el-switch
          :model-value="display.showBoundingBox"
          @update:model-value="display.update('showBoundingBox', $event)"
        />
        <span class="info-panel__hint">在视图里显示包围盒与长宽高标注（快捷键 B）</span>
      </el-form-item>

      <el-form-item label="模型单位">
        <el-select
          :model-value="display.sourceUnit"
          style="width: 100%"
          @update:model-value="display.update('sourceUnit', $event)"
        >
          <el-option v-for="unit in LENGTH_UNITS" :key="unit.id" :label="unit.label" :value="unit.id" />
        </el-select>
      </el-form-item>

      <el-form-item label="显示单位">
        <el-select
          :model-value="display.displayUnit"
          :disabled="display.sourceUnit === 'raw'"
          style="width: 100%"
          @update:model-value="display.update('displayUnit', $event)"
        >
          <el-option
            v-for="unitId in DISPLAY_UNIT_IDS"
            :key="unitId"
            :label="unitId === 'auto' ? '自动（按数值挑）' : unitId"
            :value="unitId"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <p v-if="display.sourceUnit === 'raw'" class="info-panel__hint info-panel__hint--block">
      三维格式大多不带单位信息，默认按文件里的原始数值显示。知道模型单位时（例如 STL 通常是毫米）
      可在上面声明，尺寸会换算成易读单位。
    </p>

    <el-descriptions v-if="dimensions.length" :column="1" size="small" border>
      <el-descriptions-item v-for="dimension in dimensions" :key="dimension.axis" :label="dimension.name">
        {{ dimension.text }}
      </el-descriptions-item>
      <el-descriptions-item label="最小角">
        <span class="info-panel__mono">{{ corner.min }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="最大角">
        <span class="info-panel__mono">{{ corner.max }}</span>
      </el-descriptions-item>
    </el-descriptions>
    <p v-else class="info-panel__hint info-panel__hint--block">
      加载模型后在这里显示外部尺寸；勾选「边界框」可在 3D 视图中看到标注。
    </p>

    <p class="info-panel__note">动画控制面板在 M4 补齐。</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { resolveFormatById } from '../../constants/formats.js'
import { describeCorner, describeDimensions } from '../../core/three/boundingBox.js'
import { emptyStats } from '../../core/three/stats.js'
import { DISPLAY_UNIT_IDS, LENGTH_UNITS } from '../../core/three/units.js'
import { isTauri } from '../../platform/index.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useModelStore } from '../../stores/modelStore.js'
import { formatBytes, formatCount } from '../../utils/format.js'

const model = useModelStore()
const display = useDisplayStore()

const stats = computed(() => model.stats ?? emptyStats())
// Web 端拿不到绝对路径，只有「文件名::大小」的合成标识，标签需相应调整
const sourceLabel = computed(() => (isTauri ? '路径' : '标识'))

const unitOptions = computed(() => ({
  sourceUnit: display.sourceUnit,
  displayUnit: display.displayUnit,
}))
const dimensions = computed(() =>
  model.bounds?.box ? describeDimensions(model.bounds.box, unitOptions.value) : [],
)
const corner = computed(() =>
  model.bounds?.box
    ? describeCorner(model.bounds.box, unitOptions.value)
    : { min: '—', max: '—' },
)
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

.info-panel__hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.info-panel__hint--block {
  margin: 0;
  line-height: 1.6;
}

.info-panel__mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
</style>
