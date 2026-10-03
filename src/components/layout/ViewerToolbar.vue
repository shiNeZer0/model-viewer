<template>
  <div class="viewer-toolbar">
    <el-button-group>
      <el-button type="primary" :loading="loading" @click="emit('open')">
        <el-icon><IconFolderOpen /></el-icon><span>打开模型</span>
      </el-button>
      <el-button :disabled="!hasModel" @click="emit('fit')">
        <el-icon><IconFitScreen /></el-icon><span>适配视图</span>
      </el-button>
      <el-button :disabled="!hasModel" @click="emit('reset')">
        <el-icon><IconRestartAlt /></el-icon><span>重置视图</span>
      </el-button>
    </el-button-group>

    <el-dropdown :disabled="!hasModel" @command="emit('view-preset', $event)">
      <el-button :disabled="!hasModel">
        <el-icon><IconViewInAr /></el-icon>
        <span>视图：{{ currentPresetLabel }}<span class="viewer-toolbar__caret">▾</span></span>
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
        <el-icon><IconPalette /></el-icon>
        <span>着色：{{ currentShadeLabel }}<span class="viewer-toolbar__caret">▾</span></span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="mode in SHADE_MODES" :key="mode.id" :command="mode.id">
            {{ mode.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown :disabled="!hasModel" @command="emit('screenshot', Number($event))">
      <el-button :disabled="!hasModel">
        <el-icon><IconPhotoCamera /></el-icon>
        <span>截图<span class="viewer-toolbar__caret">▾</span></span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="option in SCREENSHOT_SCALES"
            :key="option.id"
            :command="option.value"
          >
            {{ option.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <slot name="recent" />

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

    <el-button text @click="emit('settings')">
      <el-icon><IconSettings /></el-icon><span>设置</span>
    </el-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { SCREENSHOT_SCALES } from '../../core/screenshot.js'
import { SHADE_MODES, resolveShadeMode } from '../../core/three/shadeModes.js'
import { VIEW_PRESETS, resolveViewPreset } from '../../core/three/viewPresets.js'
import IconFitScreen from '~icons/material-symbols/fit-screen'
import IconFolderOpen from '~icons/material-symbols/folder-open'
import IconPalette from '~icons/material-symbols/palette'
import IconPhotoCamera from '~icons/material-symbols/photo-camera'
import IconRestartAlt from '~icons/material-symbols/restart-alt'
import IconSettings from '~icons/material-symbols/settings'
import IconViewInAr from '~icons/material-symbols/view-in-ar'

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
  'screenshot',
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
