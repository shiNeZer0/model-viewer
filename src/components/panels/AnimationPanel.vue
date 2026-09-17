<template>
  <div class="animation-panel">
    <el-alert
      v-if="animation.loadError"
      class="animation-panel__alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`部分动画设置读写失败：${animation.loadError}`"
    />

    <template v-if="animation.hasClips">
      <el-form label-width="60px" label-position="left" size="small">
        <el-form-item label="动画片段">
          <el-select
            :model-value="animation.clipId ?? ''"
            style="width: 100%"
            @update:model-value="emit('select-clip', $event)"
          >
            <el-option
              v-for="clip in animation.clips"
              :key="clip.id"
              :label="clip.name"
              :value="clip.id"
            >
              <span>{{ clip.name }}</span>
              <span class="animation-panel__meta">{{ formatDuration(clip.duration) }}</span>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>

      <div class="animation-panel__transport">
        <el-button-group>
          <el-button
            :type="animation.playing ? 'primary' : ''"
            size="small"
            @click="emit(animation.playing ? 'pause' : 'play')"
          >
            {{ animation.playing ? '暂停' : '播放' }}
          </el-button>
          <el-button size="small" @click="emit('stop')">停止</el-button>
        </el-button-group>
        <el-tag v-if="animation.finished" size="small" type="info">已播完</el-tag>
        <el-tag v-else-if="animation.playing" size="small" type="success">播放中</el-tag>
      </div>

      <el-form label-width="60px" label-position="left" size="small">
        <el-form-item label="时间轴">
          <el-slider
            :model-value="animation.normalized"
            :min="0"
            :max="1"
            :step="0.001"
            :format-tooltip="() => animation.timeText"
            @input="emit('seek', $event, false)"
            @change="emit('seek', $event, true)"
          />
          <span class="animation-panel__time">{{ animation.timeText }}</span>
        </el-form-item>

        <el-form-item label="倍速">
          <el-slider
            :model-value="animation.speed"
            :min="SPEED_RANGE.min"
            :max="SPEED_RANGE.max"
            :step="SPEED_RANGE.step"
            :marks="speedMarks"
            :format-tooltip="(value) => `${value.toFixed(2)}×`"
            @input="emit('speed', $event, false)"
            @change="emit('speed', $event, true)"
          />
        </el-form-item>

        <el-form-item label="循环">
          <el-radio-group
            :model-value="animation.loopMode"
            @update:model-value="emit('loop-mode', $event)"
          >
            <el-radio-button v-for="mode in LOOP_MODES" :key="mode.id" :value="mode.id">
              {{ mode.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <p class="animation-panel__hint">
        选中片段后停在第 0 帧；「停止」回到起点。播放中画面会持续渲染，暂停后按设置里的空闲时间停止渲染。
      </p>
    </template>

    <el-empty v-else :image-size="60" description="当前模型没有动画">
      <p class="animation-panel__hint">
        GLB / GLTF / FBX 可以携带动画；STL、PLY、OBJ、3MF 等纯几何格式本身不含动画。
      </p>
    </el-empty>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { ANIMATION_SPEEDS, LOOP_MODES, SPEED_RANGE, formatClipDuration } from '../../core/three/animation.js'
import { useAnimationStore } from '../../stores/animationStore.js'

const emit = defineEmits(['play', 'pause', 'stop', 'seek', 'speed', 'loop-mode', 'select-clip'])

const animation = useAnimationStore()
const formatDuration = formatClipDuration

/** 倍速滑杆上标出常用档位 */
const speedMarks = computed(() =>
  Object.fromEntries(ANIMATION_SPEEDS.map((value) => [value, `${value}×`])),
)
</script>

<style scoped>
.animation-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  height: 100%;
  max-height: calc(100vh - 130px);
  overflow-y: auto;
}

/* 子项不收缩：与光照页同一约定，避免含 overflow:hidden 的子元素被挤扁后静默裁切 */
.animation-panel > * {
  flex-shrink: 0;
}

.animation-panel__alert {
  margin: 0;
}

.animation-panel__transport {
  display: flex;
  align-items: center;
  gap: 8px;
}

.animation-panel__meta {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.animation-panel__time {
  margin-left: 8px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.animation-panel__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
