<template>
  <div class="display-panel">
    <el-alert
      v-for="note in display.notes"
      :key="note"
      class="display-panel__note"
      type="warning"
      :title="note"
      :closable="false"
      show-icon
    />

    <el-form label-width="88px" label-position="left" size="small">
      <el-form-item label="着色模式">
        <el-select
          :model-value="display.shadingMode"
          style="width: 100%"
          @update:model-value="display.update('shadingMode', $event)"
        >
          <el-option v-for="mode in SHADE_MODES" :key="mode.id" :label="mode.label" :value="mode.id">
            <span>{{ mode.label }}</span>
            <span class="display-panel__hint">{{ mode.hint }}</span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item label="背景">
        <el-radio-group
          :model-value="display.background"
          @update:model-value="display.update('background', $event)"
        >
          <el-radio-button v-for="mode in BACKGROUND_MODES" :key="mode.id" :value="mode.id">
            {{ mode.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="display.background === 'solid'" label="背景色">
        <el-color-picker
          :model-value="display.backgroundColor"
          @update:model-value="display.update('backgroundColor', $event)"
        />
      </el-form-item>

      <template v-if="display.background === 'gradient'">
        <el-form-item label="渐变上方">
          <el-color-picker
            :model-value="display.gradientTop"
            @update:model-value="display.update('gradientTop', $event)"
          />
        </el-form-item>
        <el-form-item label="渐变下方">
          <el-color-picker
            :model-value="display.gradientBottom"
            @update:model-value="display.update('gradientBottom', $event)"
          />
        </el-form-item>
      </template>

      <el-form-item label="辅助显示">
        <el-checkbox
          :model-value="display.showAxes"
          @update:model-value="display.update('showAxes', $event)"
        >
          坐标轴
        </el-checkbox>
        <el-checkbox
          :model-value="display.showGrid"
          @update:model-value="display.update('showGrid', $event)"
        >
          地面网格
        </el-checkbox>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">光照与色调（M3 会扩展为完整光照系统）</el-divider>

    <el-form label-width="88px" label-position="left" size="small">
      <el-form-item label="后处理">
        <el-switch
          :model-value="display.postFxEnabled"
          @update:model-value="display.update('postFxEnabled', $event)"
        />
        <span class="display-panel__hint">关闭后走直渲路径（无饱和度调节，抗锯齿由 MSAA 提供）</span>
      </el-form-item>

      <el-form-item label="色调映射">
        <el-select
          :model-value="display.toneMapping"
          :disabled="!display.postFxEnabled"
          style="width: 100%"
          @update:model-value="display.update('toneMapping', $event)"
        >
          <el-option
            v-for="item in TONE_MAPPINGS"
            :key="item.id"
            :label="item.label"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="亮度">
        <el-slider
          :model-value="display.exposure"
          :min="EXPOSURE_RANGE.min"
          :max="EXPOSURE_RANGE.max"
          :step="EXPOSURE_RANGE.step"
          :format-tooltip="(value) => value.toFixed(2)"
          @input="display.update('exposure', $event, { persist: false })"
          @change="display.update('exposure', $event)"
        />
      </el-form-item>

      <el-form-item label="饱和度">
        <el-slider
          :model-value="display.saturation"
          :min="SATURATION_RANGE.min"
          :max="SATURATION_RANGE.max"
          :step="SATURATION_RANGE.step"
          :disabled="!display.postFxEnabled"
          :format-tooltip="(value) => value.toFixed(2)"
          @input="display.update('saturation', $event, { persist: false })"
          @change="display.update('saturation', $event)"
        />
      </el-form-item>
    </el-form>

    <el-button size="small" @click="resetDisplay">恢复默认显示设置</el-button>
  </div>
</template>

<script setup>
import {
  EXPOSURE_RANGE,
  SATURATION_RANGE,
  TONE_MAPPINGS,
} from '../../core/three/postfx.js'
import { SHADE_MODES } from '../../core/three/shadeModes.js'
import { BACKGROUND_MODES } from '../../core/three/stage.js'
import { useDisplayStore } from '../../stores/displayStore.js'

const display = useDisplayStore()

/** 恢复默认并落库（逐个写回，避免只改内存） */
async function resetDisplay() {
  display.resetToDefaults()
  for (const name of Object.keys(display.SETTING_KEYS)) {
    await display.update(name, display.toEngineSettings[name])
  }
}
</script>

<style scoped>
.display-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.display-panel__note {
  margin: 0;
}

.display-panel__hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
