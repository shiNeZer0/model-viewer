<template>
  <el-container class="viewer">
    <el-header class="viewer__header" height="52px">
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
        @update:auto-rotate="settings.setAutoRotate"
        @settings="router.push('/settings')"
      />
    </el-header>

    <el-container class="viewer__body">
      <el-main class="viewer__main">
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
            <EmptyDropHint v-else-if="!model.hasModel" @open="openViaDialog" />
          </ModelCanvas>
        </div>
      </el-main>

      <el-aside class="viewer__aside" width="340px">
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
        </el-tabs>
      </el-aside>
    </el-container>

    <el-footer class="viewer__footer" height="30px">
      <ViewerStatusBar
        :file-name="model.fileName"
        :format-label="formatLabel"
        :size-text="sizeText"
        :triangle-text="triangleText"
        :fps="fps"
        :gpu="rendererInfo.gpu"
        :webgl-version="rendererInfo.webglVersion"
        :runtime-label="capabilities.runtimeLabel"
        :frames="rendererInfo.renderedFrames ?? 0"
        :post-fx="rendererInfo.postFx !== false"
        :error-text="renderError ? `${renderError.message}（${renderError.hint}）` : ''"
      />
    </el-footer>
  </el-container>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import EmptyDropHint from '../components/layout/EmptyDropHint.vue'
import LoadingOverlay from '../components/layout/LoadingOverlay.vue'
import ViewerStatusBar from '../components/layout/ViewerStatusBar.vue'
import ViewerToolbar from '../components/layout/ViewerToolbar.vue'
import DisplayPanel from '../components/panels/DisplayPanel.vue'
import ModelInfoPanel from '../components/panels/ModelInfoPanel.vue'
import ModelTreePanel from '../components/panels/ModelTreePanel.vue'
import ModelCanvas from '../components/viewer/ModelCanvas.vue'
import { useHotkeys } from '../composables/useHotkeys.js'
import { useModelOpen } from '../composables/useModelOpen.js'
import { resolveFormatById } from '../constants/formats.js'
import { DEFAULT_VIEW_PRESET, VIEW_PRESETS } from '../core/three/viewPresets.js'
import { capabilities } from '../platform/index.js'
import { useDisplayStore } from '../stores/displayStore.js'
import { useModelStore } from '../stores/modelStore.js'
import { useSettingsStore } from '../stores/settingsStore.js'
import { formatBytes, formatCount } from '../utils/format.js'

const router = useRouter()
const model = useModelStore()
const settings = useSettingsStore()
const display = useDisplayStore()

// 引擎是重对象：用 shallowRef 只做引用传递，避免被深度代理
const engineRef = shallowRef(null)
const stageRef = ref(null)
const rendererInfo = ref({ gpu: '未知', webglVersion: '—', renderedFrames: 0 })
const fps = ref(0)
const renderError = ref(null)
const activeTab = ref('info')
/** 当前视图预设（不持久化：它描述的是"这一眼"而不是偏好） */
const currentPreset = ref(DEFAULT_VIEW_PRESET)

const { openViaDialog, cancelLoading, fitView, registerDropTarget } = useModelOpen(engineRef)

let unlistenDrop = () => {}

const formatLabel = computed(() => resolveFormatById(model.formatId)?.label ?? '—')
const sizeText = computed(() => formatBytes(model.sizeBytes))
const triangleText = computed(() => formatCount(model.stats?.triangleCount ?? 0))
/** 层级标签页带上节点数，方便一眼看出模型复杂度 */
const treeTabLabel = computed(() =>
  model.hierarchyCount ? `层级 (${formatCount(model.hierarchyCount)})` : '层级',
)

onMounted(async () => {
  await Promise.all([settings.load(), display.load()])
  unlistenDrop = await registerDropTarget(stageRef.value)
})

onBeforeUnmount(() => {
  unlistenDrop?.()
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
  activeTab.value = 'tree'
}

function onSelectNode(nodeId) {
  model.setSelectedNode(nodeId)
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
  },
  { enabled: () => model.hasModel },
)

/* ------------------------------- 引擎回调 ------------------------------- */

function onEngineReady(engine) {
  engineRef.value = engine
  rendererInfo.value = engine.getRendererInfo()
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
.viewer {
  height: 100vh;
  background-color: var(--el-bg-color-page);
}

.viewer__header {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
}

.viewer__body {
  min-height: 0;
}

.viewer__main {
  position: relative;
  padding: 0;
  min-width: 0;
  background-color: #1b1e24;
}

.viewer__stage {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewer__aside {
  border-left: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
  overflow: hidden;
}

.viewer__tabs {
  height: 100%;
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
  overflow: hidden;
}

.viewer__footer {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-top: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
}
</style>
