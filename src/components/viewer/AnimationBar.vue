<template>
  <!-- 动画控制条：悬浮在渲染区底部；只有模型含动画时才出现 -->
  <div v-if="animation.hasClips" class="animation-bar">
    <el-select
      :model-value="animation.clipId ?? ''"
      class="animation-bar__clip"
      size="small"
      @update:model-value="emit('select-clip', $event)"
    >
      <el-option v-for="clip in animation.clips" :key="clip.id" :label="clip.name" :value="clip.id">
        <span>{{ clip.name }}</span>
        <span class="animation-bar__hint">{{ formatDuration(clip.duration) }}</span>
      </el-option>
    </el-select>

    <el-button-group>
      <el-button
        size="small"
        :type="animation.playing ? 'primary' : ''"
        @click="emit(animation.playing ? 'pause' : 'play')"
      >
        {{ animation.playing ? '暂停' : '播放' }}
      </el-button>
      <el-button size="small" @click="emit('stop')">停止</el-button>
    </el-button-group>

    <el-slider
      class="animation-bar__timeline"
      :model-value="animation.normalized"
      :min="0"
      :max="1"
      :step="0.001"
      :show-tooltip="false"
      @input="emit('seek', $event, false)"
      @change="emit('seek', $event, true)"
    />

    <span class="animation-bar__time">{{ animation.timeText }}</span>

    <el-select
      :model-value="animation.speed"
      class="animation-bar__compact"
      size="small"
      @update:model-value="emit('speed', $event, true)"
    >
      <el-option v-for="value in ANIMATION_SPEEDS" :key="value" :label="`${value}×`" :value="value" />
    </el-select>

    <el-select
      :model-value="animation.loopMode"
      class="animation-bar__compact"
      size="small"
      @update:model-value="emit('loop-mode', $event)"
    >
      <el-option v-for="mode in LOOP_MODES" :key="mode.id" :label="mode.label" :value="mode.id" />
    </el-select>

    <el-tag v-if="animation.finished" size="small" type="info">已播完</el-tag>
  </div>
</template>

<script setup>
import { ANIMATION_SPEEDS, LOOP_MODES, formatClipDuration } from '../../core/three/animation.js'
import { useAnimationStore } from '../../stores/animationStore.js'

const emit = defineEmits(['play', 'pause', 'stop', 'seek', 'speed', 'loop-mode', 'select-clip'])

const animation = useAnimationStore()
const formatDuration = formatClipDuration
</script>

<style scoped>
.animation-bar {
  position: absolute;
  bottom: 10px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 24px);
  padding: 6px 10px;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(15, 17, 21, 0.78);
  backdrop-filter: blur(3px);
}

.animation-bar__clip {
  width: 150px;
}

.animation-bar__timeline {
  width: 200px;
  margin: 0 2px;
}

.animation-bar__time {
  min-width: 104px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.animation-bar__compact {
  width: 92px;
}

.animation-bar__hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
