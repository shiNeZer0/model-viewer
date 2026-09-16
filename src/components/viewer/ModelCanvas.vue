<template>
  <div ref="containerRef" class="model-canvas">
    <slot />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useViewerEngine } from '../../composables/useViewerEngine.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useSettingsStore } from '../../stores/settingsStore.js'

const emit = defineEmits(['ready', 'context-lost', 'fps'])

const containerRef = ref(null)
const settings = useSettingsStore()
const display = useDisplayStore()
const { engine, mount, unmount } = useViewerEngine()

/** 引擎消费的设置快照；任何显示设置变化都会让这个 computed 失效 */
const engineSettings = computed(() => display.toEngineSettings)

/** 把显示设置推给引擎，并把引擎的提示（如「模型过大已跳过线框」）回写到 store */
function applyDisplaySettings() {
  const current = engine.value
  if (!current) return
  const warnings = current.applyDisplaySettings(engineSettings.value)
  display.setNotes(warnings)
}

onMounted(() => {
  const created = mount(containerRef.value, {
    maxPixelRatio: settings.maxPixelRatio,
    idleMs: display.idleMs,
    onFps: (fps) => emit('fps', fps),
    onContextLost: () => emit('context-lost'),
  })
  created.setAutoRotate(settings.autoRotate, settings.autoRotateSpeed)
  const warnings = created.applyDisplaySettings(engineSettings.value)
  display.setNotes(warnings)
  emit('ready', created)
})

onBeforeUnmount(() => unmount())

// 显示设置变化 → 引擎
watch(engineSettings, applyDisplaySettings)

watch(
  () => [settings.autoRotate, settings.autoRotateSpeed],
  ([enabled, speed]) => engine.value?.setAutoRotate(enabled, speed),
)

watch(
  () => settings.maxPixelRatio,
  (value) => engine.value?.setMaxPixelRatio(value),
)
</script>

<style scoped>
.model-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 引擎里 setSize(w, h, false) 不写内联尺寸，画布铺满完全交给 CSS */
:deep(.mv-canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

/* 透明背景模式：画布真的透明（渲染器开了 alpha），棋盘格由容器提供 */
.model-canvas.mv-transparent-stage {
  background-color: #22262d;
  background-image:
    linear-gradient(45deg, #333941 25%, transparent 25%, transparent 75%, #333941 75%),
    linear-gradient(45deg, #333941 25%, transparent 25%, transparent 75%, #333941 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    10px 10px;
}

/* 坐标轴标签（CSS2D 层） */
.model-canvas :deep(.mv-axis-label) {
  pointer-events: none;
}
</style>
