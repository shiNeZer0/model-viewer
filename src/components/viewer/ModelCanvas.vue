<template>
  <div ref="containerRef" class="model-canvas">
    <slot />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useViewerEngine } from '../../composables/useViewerEngine.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useModelStore } from '../../stores/modelStore.js'
import { useSettingsStore } from '../../stores/settingsStore.js'

const emit = defineEmits(['ready', 'context-lost', 'fps', 'render-error'])

const containerRef = ref(null)
const settings = useSettingsStore()
const display = useDisplayStore()
const model = useModelStore()
const { engine, mount, unmount } = useViewerEngine()

/** 引擎消费的设置快照；任何显示设置变化都会让这个 computed 失效 */
const engineSettings = computed(() => display.toEngineSettings)

/** 把引擎侧的检查数据（层级树 + 包围盒）同步成纯数据交给 store */
function syncInspection() {
  const current = engine.value
  if (!current || !model.hasModel) {
    model.clearInspection()
    return
  }
  const hierarchy = current.getHierarchy()
  model.setHierarchy(hierarchy.nodes, {
    count: hierarchy.count,
    truncated: hierarchy.truncated,
  })
  model.setBounds(current.getModelBounds())
}

/** 把显示设置推给引擎，并把引擎的提示（如「模型过大已跳过线框」）回写到 store */
function applyDisplaySettings() {
  const current = engine.value
  if (!current) return
  const warnings = current.applyDisplaySettings(engineSettings.value)
  display.setNotes(warnings)
  // 单位/摆放变化会影响包围盒数值，顺手刷新
  model.setBounds(current.getModelBounds())
}

onMounted(() => {
  try {
    const created = mount(containerRef.value, {
      maxPixelRatio: settings.maxPixelRatio,
      idleMs: display.idleMs,
      onFps: (fps) => emit('fps', fps),
      onContextLost: () => emit('context-lost'),
      // 渲染异常若不冒到 UI，现象就是「画布全黑但界面正常」，必须显式上报
      onRenderError: (info) => emit('render-error', info),
    })
    created.setAutoRotate(settings.autoRotate, settings.autoRotateSpeed)
    const warnings = created.applyDisplaySettings(engineSettings.value)
    display.setNotes(warnings)
    model.setBounds(created.getModelBounds())
    emit('ready', created)
  } catch (error) {
    // 引擎构造失败（例如 WebGL 不可用）同样不能让用户只看到一块黑画布
    console.error('[ModelCanvas] 渲染引擎初始化失败', error)
    emit('render-error', {
      message: error?.message ?? String(error),
      hint: '渲染引擎初始化失败，请检查浏览器/WebView2 的 WebGL 支持',
      level: 'init-failed',
    })
  }
})

onBeforeUnmount(() => unmount())

// 显示设置变化 → 引擎
watch(engineSettings, applyDisplaySettings)

// 模型换了 → 重新抽取层级与包围盒（root 在引擎 setModel 之后才写入 store）
watch(() => model.root, syncInspection)

// 模型换了 → 重新抽取层级与包围盒（root 在引擎 setModel 之后才写入 store）
watch(() => model.root, syncInspection)

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
