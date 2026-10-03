<template>
  <div class="viewer">
    <!--
      悬浮工具栏：常驻顶部，不参与折叠。
      它和侧栏都是**浮在画布之上**的覆盖层 —— 3D 视口因此能铺满整个窗口。
    -->
    <header class="viewer__toolbar">
      <ViewerToolbar
        :has-model="model.hasModel"
        :loading="model.isLoading"
        :auto-rotate="settings.autoRotate"
        :view-preset="currentPreset"
        :shading-mode="display.shadingMode"
        @open="openViaDialog"
        @fit="onFitView"
        @reset="onResetView"
        @view-preset="onViewPreset"
        @shading-mode="display.update('shadingMode', $event)"
        @screenshot="onScreenshot"
        @update:auto-rotate="settings.setAutoRotate"
        @settings="router.push('/settings')"
      >
        <template #recent>
          <!-- 已打开模型时"最近"是主要入口：不能靠空状态页（那里只在没有模型时出现） -->
          <!-- el-popover 没有 show 事件（只有 before-enter / after-enter 等），刷新挂在 before-enter 上 -->
          <el-popover
            v-model:visible="recentMenuOpen"
            trigger="click"
            :width="320"
            placement="bottom-start"
            @before-enter="recent.refresh()"
          >
            <template #reference>
              <el-button>最近<span class="viewer__caret">▾</span></el-button>
            </template>
            <RecentFilesList
              compact
              :entries="recent.entries"
              :can-reopen="recent.canReopen"
              :limit="8"
              @open="onOpenRecent"
              @remove="recent.remove($event)"
              @clear="recent.clear()"
            />
          </el-popover>
        </template>
      </ViewerToolbar>
    </header>

    <!-- Web 端的 HTML5 拖放目标就是这个舞台区域；桌面端用原生拖放事件，会忽略它 -->
    <div ref="stageRef" class="viewer__stage">
      <ModelCanvas
        @ready="onEngineReady"
        @context-lost="onContextLost"
        @fps="onFps"
        @render-error="onRenderError"
      >
        <LoadingOverlay
          v-if="model.isLoading"
          :file-name="model.fileName"
          :percent="model.progressPercent"
          @cancel="cancelLoading"
        />
        <EmptyDropHint
          v-else-if="!model.hasModel"
          :recent-entries="recent.entries"
          :can-reopen-recent="recent.canReopen"
          @open="openViaDialog"
          @open-recent="onOpenRecent"
          @remove-recent="recent.remove($event)"
          @clear-recent="recent.clear()"
        />
      </ModelCanvas>

      <!-- 浮层：信息 HUD（左上，快捷键 I 开关） -->
      <InfoHud
        v-model:visible="showInfoHud"
        :fps="fps"
        :frames="rendererInfo.renderedFrames ?? 0"
        :webgl-version="rendererInfo.webglVersion"
        :post-fx="rendererInfo.postFx !== false"
        :error-text="renderError ? `${renderError.message}（${renderError.hint}）` : ''"
        @snapshot="onCopyPerfSnapshot"
      />

      <!-- 浮层：动画控制条（底部，仅含动画的模型出现） -->
      <AnimationBar
        @play="onPlayAnimation"
        @pause="onPauseAnimation"
        @stop="onStopAnimation"
        @seek="onSeekAnimation"
        @speed="onAnimationSpeed"
        @loop-mode="onAnimationLoopMode"
        @select-clip="onSelectAnimationClip"
      />
    </div>

    <!-- 悬浮侧栏：可折叠 -->
    <aside class="viewer__aside" :class="{ 'is-collapsed': asideCollapsed }">
      <el-tabs v-model="activeTab" class="viewer__tabs">
        <el-tab-pane label="模型信息" name="info">
          <ModelInfoPanel />
        </el-tab-pane>
        <el-tab-pane :label="treeTabLabel" name="tree">
          <ModelTreePanel
            :nodes="model.hierarchy"
            :truncated="model.hierarchyTruncated"
            :selected-id="model.selectedNodeId"
            @toggle-visibility="onToggleNodeVisibility"
            @focus="onFocusNode"
            @select="onSelectNode"
            @show-all="onShowAllNodes"
            @hide-all="onHideAllNodes"
            @reset-visibility="onResetNodeVisibility"
          />
        </el-tab-pane>
        <el-tab-pane label="显示" name="display">
          <DisplayPanel />
        </el-tab-pane>
        <el-tab-pane label="光照" name="lighting">
          <LightingPanel />
        </el-tab-pane>
      </el-tabs>
    </aside>

    <!--
      折叠按钮**独立于侧栏**：侧栏收起后它仍留在右边缘，
      否则一旦收起就再也没有入口能把它打开了。
    -->
    <button
      class="viewer__aside-toggle"
      :class="{ 'is-collapsed': asideCollapsed }"
      type="button"
      :title="asideCollapsed ? '展开面板' : '收起面板'"
      @click="asideCollapsed = !asideCollapsed"
    >
      {{ asideCollapsed ? '‹' : '›' }}
    </button>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import EmptyDropHint from '../components/layout/EmptyDropHint.vue'
import LoadingOverlay from '../components/layout/LoadingOverlay.vue'
import RecentFilesList from '../components/layout/RecentFilesList.vue'
import ViewerToolbar from '../components/layout/ViewerToolbar.vue'
import DisplayPanel from '../components/panels/DisplayPanel.vue'
import LightingPanel from '../components/panels/LightingPanel.vue'
import ModelInfoPanel from '../components/panels/ModelInfoPanel.vue'
import ModelTreePanel from '../components/panels/ModelTreePanel.vue'
import AnimationBar from '../components/viewer/AnimationBar.vue'
import InfoHud from '../components/viewer/InfoHud.vue'
import ModelCanvas from '../components/viewer/ModelCanvas.vue'
import { useHotkeys } from '../composables/useHotkeys.js'
import { useModelOpen } from '../composables/useModelOpen.js'
import { DEFAULT_SCREENSHOT_SCALE, buildScreenshotFileName } from '../core/screenshot.js'
import { DEFAULT_VIEW_PRESET, VIEW_PRESETS } from '../core/three/viewPresets.js'
import {
  capabilities,
  resolveStoredEnvironment,
  saveScreenshot,
  subscribeOpenRequest,
  takeStartupModelPath,
} from '../platform/index.js'
import { useAnimationStore } from '../stores/animationStore.js'
import { useDisplayStore } from '../stores/displayStore.js'
import { useLightingStore } from '../stores/lightingStore.js'
import { useModelStore } from '../stores/modelStore.js'
import { usePostFxStore } from '../stores/postfxStore.js'
import { useRecentStore } from '../stores/recentStore.js'
import { useSettingsStore } from '../stores/settingsStore.js'
import { formatCount } from '../utils/format.js'
import { describeError } from '../utils/error-messages.js'
import { formatPerfSnapshot } from '../utils/perf-snapshot.js'

/*
 * 显式声明组件名：App.vue 的 keep-alive 按名字匹配（`include`）。
 * Vue 也能从文件名推断，但写出来可避免将来重命名文件时"缓存静默失效"——
 * 那种失效的表现正是"点设置回来模型没了"，很难定位。
 */
defineOptions({ name: 'Viewer' })

const router = useRouter()
const model = useModelStore()
const settings = useSettingsStore()
const display = useDisplayStore()
const lighting = useLightingStore()
const animation = useAnimationStore()
const recent = useRecentStore()
const postfx = usePostFxStore()

// 引擎是重对象：用 shallowRef 只做引用传递，避免被深度代理
const engineRef = shallowRef(null)
const stageRef = ref(null)
const rendererInfo = ref({ gpu: '未知', webglVersion: '—', renderedFrames: 0 })
const fps = ref(0)
const renderError = ref(null)
const activeTab = ref('info')
/** 当前视图预设（不持久化：它描述的是"这一眼"而不是偏好） */
const currentPreset = ref(DEFAULT_VIEW_PRESET)
/** 信息 HUD 是否显示（会话级：快捷键 I 切换，HUD 自带折叠按钮） */
const showInfoHud = ref(true)
/**
 * 悬浮侧栏是否收起。
 * 默认**收起**：让画布先吃满窗口，需要时再展开（会话级，不持久化）。
 */
const asideCollapsed = ref(true)
/**
 * 本视图是否在前台。
 * keep-alive 下组件不会卸载，但**键盘监听仍挂在 window 上** —— 不在隐藏时关掉的话，
 * 在设置页按 `1`~`7`/`f`/`s` 会静默作用到看不见的画布上。
 */
const isActive = ref(true)
/** 「最近」弹层是否展开（点开某个历史文件后要主动收起） */
const recentMenuOpen = ref(false)

const { openViaDialog, openPath, cancelLoading, fitView, registerDropTarget } =
  useModelOpen(engineRef)

let unlistenDrop = () => {}
/** 订阅"第二个实例被拦下后转发过来的打开请求" */
let unlistenOpenRequest = () => {}

/** 层级标签页带上节点数，方便一眼看出模型复杂度 */
const treeTabLabel = computed(() =>
  model.hierarchyCount ? `层级 (${formatCount(model.hierarchyCount)})` : '层级',
)

/* --------------------------- 最近文件（M6-1） --------------------------- */

function onOpenRecent(path) {
  recentMenuOpen.value = false
  void openPath(path)
}

/* --------------------- 关联文件启动 / 单实例（M6-6） --------------------- */

/**
 * 引擎就绪后再处理"启动时带着文件"：双击关联文件打开时，模型必须在引擎存在之后才能上屏。
 * 若在 onMounted 里做，engineRef 还是 null，只会得到一句"渲染器尚未就绪"。
 */
async function consumeStartupOpen() {
  const path = await takeStartupModelPath()
  if (!path) return
  ElMessage.info(`正在打开：${path}`)
  await openPath(path, { source: 'startup' })
}

/* --------------------- 导入环境贴图的启动恢复（M6-5） --------------------- */

/**
 * 桌面端：重新授权已保存的导入环境贴图。
 * asset 协议的读取权限只在本次运行内有效，不重授权的话环境贴图会在启动后读取失败、
 * 静默退回程序化环境（界面却显示已导入）。重新授权后刷新 URL，由 ModelCanvas 的
 * 监听去真正加载。
 */
async function restoreImportedEnvironment() {
  const env = lighting.toEngineSettings.environment
  if (env.source !== 'imported' || !env.customHdrPath) return

  const resolved = await resolveStoredEnvironment(env)
  if (!resolved) return
  await lighting.updateEnvironment(
    {
      customHdrName: resolved.name,
      customHdrUrl: resolved.url,
      customHdrExtension: resolved.extension,
    },
    { persist: false },
  )
}

/* --------------------------- 截图导出（M6-4） --------------------------- */

/**
 * 截图：先同步取像素（必须在同一任务里渲染+读取），再交给平台层保存。
 * 顺序不能反——先弹另存为对话框的话，等用户选完路径时绘制缓冲区可能已经被清空了。
 */
async function onScreenshot(scale = DEFAULT_SCREENSHOT_SCALE) {
  const engine = engineRef.value
  if (!engine) {
    ElMessage.warning('渲染器尚未就绪，请稍后重试')
    return
  }

  const dataUrl = engine.captureImage({ scale })
  if (!dataUrl) {
    ElMessage.error('截图失败：渲染器没有返回图像数据')
    return
  }

  try {
    const fileName = buildScreenshotFileName({ fileName: model.fileName, scale })
    const result = await saveScreenshot({ dataUrl, fileName })
    if (result.cancelled) return
    ElMessage.success(`截图已保存：${result.path}`)
  } catch (error) {
    ElMessage.error(describeError(error))
  }
}

onMounted(async () => {
  await Promise.all([
    settings.load(),
    display.load(),
    lighting.load(),
    animation.load(),
    recent.load(),
    postfx.load(),
  ])
  unlistenDrop = await registerDropTarget(stageRef.value)
})

onBeforeUnmount(() => {
  unlistenDrop?.()
  unlistenOpenRequest?.()
})

/*
 * keep-alive：跳到设置页时本视图只是 deactivated —— 引擎仍然活着，所以模型不会丢。
 * 但画布已被移出文档，必须暂停引擎（否则它会按 0×0 的尺寸重算资源），
 * 并关掉快捷键（它们监听在 window 上，与视图是否可见无关）。
 */
onDeactivated(() => {
  isActive.value = false
  engineRef.value?.suspend()
})

onActivated(() => {
  isActive.value = true
  engineRef.value?.resume()
})

/* ------------------------------- 视图操作 ------------------------------- */

function onFitView() {
  fitView()
}

function onResetView() {
  engineRef.value?.resetView()
  currentPreset.value = DEFAULT_VIEW_PRESET
}

function onViewPreset(presetId) {
  if (!engineRef.value?.setViewPreset(presetId)) return
  currentPreset.value = presetId
}

/* --------------------------- 层级树（M2） --------------------------- */

function onToggleNodeVisibility(nodeId, visible) {
  if (!engineRef.value?.setNodeVisible(nodeId, visible)) return
  model.patchNodeVisibility(nodeId, visible)
}

function onFocusNode(nodeId) {
  engineRef.value?.focusNode(nodeId)
  model.setSelectedNode(nodeId)
  // 聚焦同时也要在视口里描出来，否则"选中了哪个"只能靠层级树里那一行高亮
  engineRef.value?.setSelectedNode(nodeId)
  activeTab.value = 'tree'
}

function onSelectNode(nodeId) {
  model.setSelectedNode(nodeId)
  // 选中是"层级树 ↔ 视口"的双向反馈，缺了视口这一半就只是个列表高亮
  engineRef.value?.setSelectedNode(nodeId)
}

function onShowAllNodes() {
  engineRef.value?.setAllNodesVisible(true)
  model.setAllVisibility(true)
}

function onHideAllNodes() {
  engineRef.value?.setAllNodesVisible(false)
  model.setAllVisibility(false)
}

/** 清空用户覆盖，回到模型自带的可见性（引擎返回权威结果用于回显） */
function onResetNodeVisibility() {
  const flags = engineRef.value?.resetNodeVisibility()
  if (flags) model.applyVisibilityFlags(flags)
}

/* --------------------------- 动画（M4） --------------------------- */

/** 动画操作统一走「引擎执行 → 立即回写 store」，保证 UI 与实际状态一致 */
function applyAnimationResult(stateOrNull) {
  if (stateOrNull) animation.applyState(stateOrNull)
}

function onSelectAnimationClip(clipId) {
  applyAnimationResult(engineRef.value?.selectAnimationClip(clipId))
}

function onPlayAnimation() {
  applyAnimationResult(engineRef.value?.playAnimation())
}

function onPauseAnimation() {
  applyAnimationResult(engineRef.value?.pauseAnimation())
}

function onStopAnimation() {
  applyAnimationResult(engineRef.value?.stopAnimation())
}

function onSeekAnimation(normalized, persist = true) {
  applyAnimationResult(engineRef.value?.seekAnimation(normalized))
  // 拖动过程不落库：时间位置是临时观察点，不是用户偏好
  void persist
}

/** 倍速与循环模式：只改 store，由 ModelCanvas 的 watch 单向推给引擎 */
function onAnimationSpeed(value, persist = true) {
  animation.setSpeed(value, { persist })
}

function onAnimationLoopMode(value) {
  animation.setLoopMode(value)
}

/* ------------------------------- 快捷键 ------------------------------- */

/** 1-7 对应 7 个标准视图（顺序与 VIEW_PRESETS 一致） */
const presetHotkeys = Object.fromEntries(
  VIEW_PRESETS.map((preset, index) => [String(index + 1), () => onViewPreset(preset.id)]),
)

/** W 在「实体 → 实体+线框 → 仅线框」之间循环，方便快速检查网格 */
const WIREFRAME_CYCLE = ['shaded', 'shadedWire', 'wire']

useHotkeys(
  {
    ...presetHotkeys,
    f: onFitView,
    r: onResetView,
    t: () => settings.setAutoRotate(!settings.autoRotate),
    w: () => {
      const index = WIREFRAME_CYCLE.indexOf(display.shadingMode)
      const next = WIREFRAME_CYCLE[(index + 1) % WIREFRAME_CYCLE.length]
      display.update('shadingMode', next)
    },
    b: () => display.update('showBoundingBox', !display.showBoundingBox),
    s: () => onScreenshot(DEFAULT_SCREENSHOT_SCALE),
    i: () => {
      showInfoHud.value = !showInfoHud.value
    },
  },
  // 被 keep-alive 隐藏时不要响应：否则在设置页按键会静默作用到看不见的画布上
  { enabled: () => isActive.value },
)

/* --------------------------- 性能快照（M6-7 基准用） --------------------------- */

/**
 * 把当前渲染开销复制成一段可粘贴的文本。
 *
 * 为什么需要它：真机帧率只能人工采集，散落在 HUD/控制台里的数字既难对比也容易抄错。
 * 有了统一出口，"优化前后"才能逐行比对，而不是靠"感觉这次更流畅"。
 * 剪贴板失败时回退到控制台——信息必须一定拿得到。
 */
async function onCopyPerfSnapshot() {
  const engine = engineRef.value
  if (!engine) {
    ElMessage.warning('渲染器尚未就绪，请稍后重试')
    return
  }

  const text = formatPerfSnapshot(engine.getPerfSnapshot())
  if (!text) {
    ElMessage.warning('无法生成性能快照')
    return
  }

  console.info(text)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('性能快照已复制到剪贴板')
  } catch (error) {
    console.warn('[viewer] 剪贴板不可用，性能快照已打印到控制台', error)
    ElMessage.warning('剪贴板不可用，性能快照已打印到控制台')
  }
}

/* ------------------------------- 引擎回调 ------------------------------- */

function onEngineReady(engine) {
  engineRef.value = engine
  rendererInfo.value = engine.getRendererInfo()
  // 关联文件启动与二次打开都依赖引擎已就绪，因此挂在这里而不是 onMounted
  void consumeStartupOpen()
  // 已保存的导入环境贴图要重新授权，否则启动后会静默退回程序化环境
  void restoreImportedEnvironment()
  void subscribeOpenRequest((path) => openPath(path, { source: 'startup' })).then((unlisten) => {
    unlistenOpenRequest = unlisten
  })
}

function onFps(value) {
  fps.value = value
  // 顺带刷新渲染器指标（含累计帧数），供状态栏显示；每 0.5 秒一次，开销可忽略
  if (engineRef.value) rendererInfo.value = engineRef.value.getRendererInfo()
}

/**
 * 渲染异常：这类错误发生在 rAF 回调里，不会自己冒到界面上，
 * 因此必须显式提示，否则用户只会看到"模型不显示"。
 */
function onRenderError(info) {
  renderError.value = info
  ElMessage.error(`渲染异常：${info.message}｜${info.hint}`)
}

function onContextLost() {
  ElMessage.error('显卡渲染上下文丢失，请重新打开应用（或在设置中降低画质）')
}
</script>

<style scoped>
/*
 * 外壳：画布铺满整个视口，工具栏与侧栏都是浮在它上面的覆盖层。
 * 原先 header / aside 占据流内空间，画布被挤小；现在 3D 视口吃满窗口。
 *
 * 附带好处：折叠侧栏**不改变画布尺寸**，因此不会触发 renderer 尺寸重算
 * （那条路径会重建后处理的 render target，见 postfx.js 的 applySize）。
 */
.viewer {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  /* 视口底色兜底；3D 场景背景由「显示 → 背景」控制，与这里无关 */
  background-color: #1b1e24;
}

.viewer__stage {
  position: absolute;
  inset: 0;
}

/* ------------------------------- 悬浮工具栏 ------------------------------- */
.viewer__toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  height: var(--viewer-toolbar-height);
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  /* 与 InfoHud 共用一套浮层配色：跟随明暗主题，同时能透出底下的模型 */
  background: var(--viewer-overlay-bg);
  backdrop-filter: blur(6px);
}

/*
 * 工具栏内容（ViewerToolbar 的根元素）必须撑满。
 * 它现在是 flex item，宽度默认只由内容决定 —— 那样内部的 spacer 就分不到空间，
 * 「设置」按钮不会靠右（原布局里它是 block 容器的子元素，所以自动撑满）。
 */
.viewer__toolbar > * {
  flex: 1;
  min-width: 0;
}

/* ------------------------------- 悬浮侧栏 ------------------------------- */
.viewer__aside {
  position: absolute;
  top: calc(var(--viewer-toolbar-height) + 10px);
  right: 10px;
  bottom: 10px;
  z-index: 15;
  width: 340px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--viewer-overlay-bg);
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

/*
 * 收起：整块平移出视口（多出的 20px 覆盖 right:10px 的边距与阴影）。
 * 用 transform 而不是动画 width —— 宽度动画每帧都会触发布局，
 * 而旁边正有一个 WebGL 画布在渲染。
 */
.viewer__aside.is-collapsed {
  transform: translateX(calc(100% + 20px));
  opacity: 0;
  /* 收起后不该继续拦截画布上的鼠标操作 */
  pointer-events: none;
}

.viewer__aside-toggle {
  position: absolute;
  top: 50%;
  right: 10px;
  z-index: 16;
  width: 22px;
  height: 56px;
  padding: 0;
  /* 展开时贴在侧栏左边缘外侧；收起时回到右边缘（见 .is-collapsed） */
  transform: translateY(-50%) translateX(calc(-340px - 8px));
  transition: transform 0.25s ease;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--viewer-overlay-bg);
  backdrop-filter: blur(6px);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.viewer__aside-toggle:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.viewer__aside-toggle.is-collapsed {
  transform: translateY(-50%);
}

/* --------------------------- 侧栏内 tabs 的高度链 --------------------------- */
.viewer__tabs {
  flex: 1;
  /*
   * 关键：flex item 的 min-height 默认是 auto，内部滚动容器算不出可用高度，
   * 表现为"内容明明超出却滚不到"（面板自身的 overflow 永不触发）。
   */
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.viewer__tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 12px;
}

.viewer__tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  /* 兜底滚动：即使某个面板自身的高度链失效，内容区仍然能滚到最后一行 */
  overflow-y: auto;
}

/*
 * 关键修复：必须给 tab pane 一个确定高度。
 * 否则面板里的 height:100% 会退化成 auto，面板自身的 overflow-y:auto 永不触发，
 * 超出的内容会被 .el-tabs__content 裁掉且无法到达（光照页设置够不到就是这个原因）。
 */
.viewer__tabs :deep(.el-tab-pane) {
  height: 100%;
}

.viewer__caret {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
}
</style>
