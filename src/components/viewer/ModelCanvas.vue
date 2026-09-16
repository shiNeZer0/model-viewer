<template>
  <div ref="containerRef" class="model-canvas">
    <slot />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useViewerEngine } from '../../composables/useViewerEngine.js'
import { useSettingsStore } from '../../stores/settingsStore.js'

const emit = defineEmits(['ready', 'context-lost', 'fps'])

const containerRef = ref(null)
const settings = useSettingsStore()
const { engine, mount, unmount } = useViewerEngine()

onMounted(() => {
  const created = mount(containerRef.value, {
    maxPixelRatio: settings.maxPixelRatio,
    onFps: (fps) => emit('fps', fps),
    onContextLost: () => emit('context-lost'),
  })
  created.setAutoRotate(settings.autoRotate, settings.autoRotateSpeed)
  emit('ready', created)
})

onBeforeUnmount(() => unmount())

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
</style>
