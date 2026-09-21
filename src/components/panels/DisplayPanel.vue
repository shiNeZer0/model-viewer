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

      <el-form-item label="阴影">
        <el-switch
          :model-value="display.showShadow"
          @update:model-value="display.update('showShadow', $event)"
        />
        <span class="display-panel__hint">只由主光投影；静态场景下不重复计算</span>
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

    <el-divider content-position="left">后处理效果</el-divider>

    <p class="display-panel__footnote">
      「重」效果（环境光遮蔽 / 泛光 / 景深）在低性能模式下会被自动关闭。
    </p>

    <div v-for="channel in effectChannels" :key="channel.id" class="display-panel__channel">
      <div class="display-panel__channel-head">
        <el-switch
          :model-value="postfx.channelStates[channel.id].enabled"
          @update:model-value="postfx.setEnabled(channel.id, $event)"
        />
        <span class="display-panel__channel-title">{{ channel.label }}</span>
        <el-tag v-if="channel.heavy && settings.lowPerformance" size="small" type="warning">
          低性能模式已关闭
        </el-tag>
        <el-button link size="small" @click="postfx.resetChannelSettings(channel.id)">
          重置
        </el-button>
      </div>

      <el-form label-width="76px" label-position="left" size="small">
        <el-form-item v-for="(range, key) in channel.ranges" :key="key" :label="settingLabel(key)">
          <el-slider
            :model-value="postfx.channelStates[channel.id].settings[key]"
            :min="range.min"
            :max="range.max"
            :step="range.step"
            :format-tooltip="(value) => value.toFixed(2)"
            @input="postfx.setSetting(channel.id, key, $event, { persist: false })"
            @change="postfx.setSetting(channel.id, key, $event)"
          />
        </el-form-item>
      </el-form>
    </div>

    <el-button size="small" @click="resetDisplay">恢复默认显示设置</el-button>
  </div>
</template>

<script setup>
import { UP_AXIS_MODES } from '../../core/three/orientation.js'
import {
  DEFAULT_CHANNELS,
  EXPOSURE_RANGE,
  SATURATION_RANGE,
  TONE_MAPPINGS,
} from '../../core/three/postfx.js'
import { SHADE_MODES } from '../../core/three/shadeModes.js'
import { BACKGROUND_MODES } from '../../core/three/stage.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { usePostFxStore } from '../../stores/postfxStore.js'
import { useSettingsStore } from '../../stores/settingsStore.js'

const display = useDisplayStore()
const postfx = usePostFxStore()
const settings = useSettingsStore()

/**
 * 效果通道列表：**排除饱和度** —— 它在上面的「后处理与色调」区已有专门滑杆，
 * 且唯一事实源是 displayStore；列在这里会出现两个改同一件事的控件。
 */
const effectChannels = DEFAULT_CHANNELS.filter((item) => item.id !== 'saturation')

/** 参数键 → 中文标签（键名由各通道自己定义，集中映射一次） */
const SETTING_LABELS = {
  edgeStrength: '描边强度',
  edgeThickness: '描边粗细',
  edgeGlow: '描边辉光',
  radius: '遮蔽半径',
  intensity: '强度',
  strength: '强度',
  threshold: '亮度阈值',
  focusRatio: '对焦位置',
  aperture: '光圈',
  maxblur: '虚化程度',
  temperature: '色温',
  vignette: '暗角',
}

function settingLabel(key) {
  return SETTING_LABELS[key] ?? key
}

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

.display-panel__channel {
  padding: 8px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.display-panel__channel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.display-panel__channel-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}
</style>
