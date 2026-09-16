<template>
  <div class="viewer-toolbar">
    <el-button-group>
      <el-button type="primary" :loading="loading" @click="emit('open')">打开模型</el-button>
      <el-button :disabled="!hasModel" @click="emit('fit')">适配视图</el-button>
      <el-button :disabled="!hasModel" @click="emit('reset')">重置视图</el-button>
    </el-button-group>

    <el-dropdown :disabled="!hasModel" @command="emit('view-preset', $event)">
      <el-button :disabled="!hasModel">
        视图：{{ currentPresetLabel }}<span class="viewer-toolbar__caret">▾</span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="preset in VIEW_PRESETS" :key="preset.id" :command="preset.id">
            {{ preset.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown @command="emit('shading-mode', $event)">
      <el-button>
        着色：{{ currentShadeLabel }}<span class="viewer-toolbar__caret">▾</span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="mode in SHADE_MODES" :key="mode.id" :command="mode.id">
            {{ mode.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <div class="viewer-toolbar__spacer" />

    <el-tooltip content="转盘模式：视角绕模型自动旋转（快捷键 T）" placement="bottom">
      <span class="viewer-toolbar__switch">
        <span class="viewer-toolbar__label">转盘</span>
        <el-switch
          :model-value="autoRotate"
          :disabled="!hasModel"
          @update:model-value="emit('update:autoRotate', $event)"
        />
      </span>
    </el-tooltip>

    <el-button text @click="emit('settings')">设置</el-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { SHADE_MODES, resolveShadeMode } from '../../core/three/shadeModes.js'
import { VIEW_PRESETS, resolveViewPreset } from '../../core/three/viewPresets.js'

const props = defineProps({
  hasModel: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  autoRotate: { type: Boolean, default: false },
  viewPreset: { type: String, default: '' },
  shadingMode: { type: String, default: '' },
})

const emit = defineEmits([
  'open',
  'fit',
  'reset',
  'update:autoRotate',
  'view-preset',
  'shading-mode',
  'settings',
])

const currentPresetLabel = computed(() => resolveViewPreset(props.viewPreset)?.label ?? '等轴测')
const currentShadeLabel = computed(() => resolveShadeMode(props.shadingMode)?.label ?? '实体')
</script>

<style scoped>
.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
}

.viewer-toolbar__spacer {
  flex: 1;
}

.viewer-toolbar__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.viewer-toolbar__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.viewer-toolbar__caret {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
}
</style>
