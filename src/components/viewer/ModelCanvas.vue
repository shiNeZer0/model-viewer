<template>
  <div ref="containerRef" class="model-canvas">
    <slot />
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useViewerEngine } from '../../composables/useViewerEngine.js'
import { useAnimationStore } from '../../stores/animationStore.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useLightingStore } from '../../stores/lightingStore.js'
import { useModelStore } from '../../stores/modelStore.js'
import { usePostFxStore } from '../../stores/postfxStore.js'
import { useSettingsStore } from '../../stores/settingsStore.js'

const emit = defineEmits(['ready', 'context-lost', 'fps', 'render-error'])

const containerRef = ref(null)
const settings = useSettingsStore()
const display = useDisplayStore()
const postfx = usePostFxStore()
const model = useModelStore()
const lighting = useLightingStore()
const animation = useAnimationStore()
const { engine, mount, unmount } = useViewerEngine()

/** 引擎消费的设置快照；任何显示设置变化都会让这个 computed 失效 */
const engineSettings = computed(() => display.toEngineSettings)
/** 光照快照（三点光源 + 环境贴图） */
const lightingSettings = computed(() => lighting.toEngineSettings)

/** 把引擎侧的检查数据（层级树 + 包围盒 + 动画片段）同步成纯数据交给 store */
function syncInspection() {
  const current = engine.value
  if (!current || !model.hasModel) {
    model.clearInspection()
    animation.reset()
    return
  }
  const hierarchy = current.getHierarchy()
  model.setHierarchy(hierarchy.nodes, {
    count: hierarchy.count,
    truncated: hierarchy.truncated,
  })
  model.setBounds(current.getModelBounds())
  // 动画：片段列表 + 运行状态（无动画时面板显示空态）
  animation.setClips(current.getAnimationClips())
  animation.applyState(current.getAnimationState())
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

/**
 * 把通道开关与参数推给引擎（唯一事实源是 postfxStore）。
 * 引擎会自行处理低性能模式对「重」通道的压制，所以这里无脑照推即可。
 */
function applyPostFxChannels() {
  const current = engine.value
  if (!current) return
  for (const [id, state] of Object.entries(postfx.channelStates)) {
    current.setPostFxChannel(id, { enabled: state.enabled, settings: state.settings })
  }
}

onMounted(() => {
  try {
    const created = mount(containerRef.value, {
      maxPixelRatio: settings.maxPixelRatio,
      // 低性能模式必须在建引擎时就知道：antialias 是构造参数，运行时改不了
      lowPerformance: settings.lowPerformance,
      idleMs: display.idleMs,
      onFps: (fps) => emit('fps', fps),
      onContextLost: () => emit('context-lost'),
      // 渲染异常若不冒到 UI，现象就是「画布全黑但界面正常」，必须显式上报
      onRenderError: (info) => emit('render-error', info),
      // 动画每帧状态回写（时间轴/播放状态）
      onAnimationTick: (state) => animation.applyState(state),
    })
    created.setAutoRotate(settings.autoRotate, settings.autoRotateSpeed)
    // 动画偏好先写进引擎，模型加载时自动套用
    created.setAnimationSpeed(animation.speed)
    created.setAnimationLoopMode(animation.loopMode)
    const warnings = created.applyDisplaySettings(engineSettings.value)
    display.setNotes(warnings)
    // 光照在显示设置之后应用：这样"环境贴图当背景"能拿到刚生成好的纹理
    created.applyLighting(lightingSettings.value)
    // 后处理通道要在引擎就绪后立刻推一次，否则打开的通道要等用户动一下设置才生效
    applyPostFxChannels()
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

/** 把光照状态推给引擎（光源位置/颜色/强度 + 环境贴图） */
function applyLightingSettings() {
  const current = engine.value
  if (!current) return

  const settings = lightingSettings.value
  // 导入的 HDR/EXR 要先读文件并登记，才能被 applyLighting 生成 PMREM；
  // 读取过程是异步的，成功后会由引擎自己重新套用光照（失败则退化为程序化环境）。
  if (current.needsImportedEnvironment(settings.environment)) {
    void current.loadImportedEnvironment(settings.environment).then((result) => {
      if (!result.ok) {
        ElMessage.warning(`环境贴图读取失败（${result.error}），已改用程序化环境`)
      }
    })
    return
  }

  current.applyLighting(settings)
}

// 显示设置变化 → 引擎
watch(engineSettings, applyDisplaySettings)

// 光照变化 → 引擎（环境贴图只在来源/颜色变化时重新生成）
watch(lightingSettings, applyLightingSettings)

/*
 * 动画偏好（倍速/循环）由 store 单向推给引擎：
 * 这样"用户改设置"与"设置刚从数据库读回来"两条路径都会同步，
 * 引擎会把偏好记下来，模型加载时自动套用到新的 AnimationController 上。
 */
watch(
  () => [animation.speed, animation.loopMode],
  ([speed, loopMode]) => {
    const current = engine.value
    if (!current) return
    current.setAnimationSpeed(speed)
    current.setAnimationLoopMode(loopMode)
  },
)

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

// 低性能模式：像素比与 MSAA 立即生效（antialias 要等下次建引擎，见 ViewerEngine.setLowPerformance）
watch(
  () => settings.lowPerformance,
  (value) => {
    engine.value?.setLowPerformance(value)
    // 档位变化会压制/恢复「重」通道，按 UI 的意图重新推一遍
    applyPostFxChannels()
  },
)

// 通道开关与参数 → 引擎（deep：通道参数是嵌套对象）
watch(() => postfx.channelStates, applyPostFxChannels, { deep: true })
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
