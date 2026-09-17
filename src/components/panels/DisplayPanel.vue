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

      <el-form-item label="坐标轴">
        <el-switch
          :model-value="display.showAxes"
          @update:model-value="display.update('showAxes', $event)"
        />
      </el-form-item>

      <el-form-item label="地面网格">
        <el-switch
          :model-value="display.showGrid"
          @update:model-value="display.update('showGrid', $event)"
        />
        <span class="display-panel__hint">网格尺寸会随模型大小自动缩放</span>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">模型放置与轴向</el-divider>

    <el-form label-width="88px" label-position="left" size="small">
      <el-form-item label="模型轴向">
        <el-select
          :model-value="display.upAxis"
          style="width: 100%"
          @update:model-value="display.update('upAxis', $event)"
        >
          <el-option
            v-for="mode in UP_AXIS_MODES"
            :key="mode.id"
            :label="mode.label"
            :value="mode.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="居中到原点">
        <el-switch
          :model-value="display.centerModel"
          @update:model-value="display.update('centerModel', $event)"
        />
        <span class="display-panel__hint">把模型 X/Z 移到世界原点</span>
      </el-form-item>

      <el-form-item label="底部贴地">
        <el-switch
          :model-value="display.alignToGround"
          @update:model-value="display.update('alignToGround', $event)"
        />
        <span class="display-panel__hint">把模型最低点落到 y=0 地面</span>
      </el-form-item>
    </el-form>

    <p class="display-panel__footnote">
      摆放只是显示用的归一化：仅移动模型在场景中的位置，不会修改模型文件里的原始坐标。
      关掉开关即可查看模型自带的真实坐标。
      「模型轴向」用于修正文件自身的朝上轴（3MF 规范为 Z-up，FBX 视导出器而定）：
      切换后会重新计算包围盒与相机，尺寸、贴地与视图都按新姿态给出。
    </p>

    <el-divider content-position="left">后处理与色调</el-divider>

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
import { UP_AXIS_MODES } from '../../core/three/orientation.js'
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

.display-panel__footnote {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
