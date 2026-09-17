<template>
  <el-card shadow="never" class="light-editor">
    <template #header>
      <div class="light-editor__header">
        <span class="light-editor__title">{{ role.label }}</span>
        <el-switch
          :model-value="light.enabled"
          size="small"
          @update:model-value="patch({ enabled: $event })"
        />
      </div>
    </template>

    <p class="light-editor__hint">{{ role.description }}</p>

    <el-form label-width="46px" label-position="left" size="small" :disabled="!light.enabled">
      <el-form-item label="强度">
        <el-slider
          :model-value="light.intensity"
          :min="LIGHT_LIMITS.intensity.min"
          :max="LIGHT_LIMITS.intensity.max"
          :step="LIGHT_LIMITS.intensity.step"
          :format-tooltip="(value) => value.toFixed(2)"
          @input="patch({ intensity: $event }, false)"
          @change="patch({ intensity: $event })"
        />
      </el-form-item>

      <el-form-item label="颜色">
        <el-color-picker
          :model-value="light.color"
          size="small"
          @update:model-value="patch({ color: $event })"
        />
      </el-form-item>

      <el-form-item label="方位">
        <el-slider
          :model-value="light.azimuth"
          :min="LIGHT_LIMITS.azimuth.min"
          :max="LIGHT_LIMITS.azimuth.max"
          :step="LIGHT_LIMITS.azimuth.step"
          :format-tooltip="(value) => `${value}°`"
          @input="patch({ azimuth: $event }, false)"
          @change="patch({ azimuth: $event })"
        />
      </el-form-item>

      <el-form-item label="仰角">
        <el-slider
          :model-value="light.elevation"
          :min="LIGHT_LIMITS.elevation.min"
          :max="LIGHT_LIMITS.elevation.max"
          :step="LIGHT_LIMITS.elevation.step"
          :format-tooltip="(value) => `${value}°`"
          @input="patch({ elevation: $event }, false)"
          @change="patch({ elevation: $event })"
        />
      </el-form-item>

      <el-form-item label="半径">
        <el-slider
          :model-value="light.radius"
          :min="LIGHT_LIMITS.radius.min"
          :max="LIGHT_LIMITS.radius.max"
          :step="LIGHT_LIMITS.radius.step"
          :format-tooltip="(value) => value.toFixed(1)"
          @input="patch({ radius: $event }, false)"
          @change="patch({ radius: $event })"
        />
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup>
import { LIGHT_LIMITS } from '../../core/three/lighting.js'

const props = defineProps({
  light: { type: Object, required: true },
  role: { type: Object, required: true },
})

const emit = defineEmits(['change'])

/** 拖动过程不落库（persist=false），松手时再持久化，避免高频写盘 */
function patch(next, persist = true) {
  emit('change', { role: props.light.role, patch: next, persist })
}
</script>

<style scoped>
.light-editor {
  margin-bottom: 8px;
}

.light-editor :deep(.el-card__header) {
  padding: 8px 10px;
}

.light-editor :deep(.el-card__body) {
  padding: 10px;
}

.light-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.light-editor__title {
  font-size: 13px;
  font-weight: 600;
}

.light-editor__hint {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
