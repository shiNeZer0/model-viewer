<template>
  <el-container class="viewer">
    <el-header class="viewer__header" height="52px">
      <ViewerToolbar
        :has-model="model.hasModel"
        :loading="model.isLoading"
        :auto-rotate="settings.autoRotate"
        @open="openViaDialog"
        @fit="fitView"
        @update:auto-rotate="settings.setAutoRotate"
        @settings="router.push('/settings')"
      />
    </el-header>

    <el-container class="viewer__body">
      <el-main class="viewer__main">
        <!-- Web 端的 HTML5 拖放目标就是这个舞台区域；桌面端用原生拖放事件，会忽略它 -->
        <div ref="stageRef" class="viewer__stage">
          <ModelCanvas @ready="onEngineReady" @context-lost="onContextLost" @fps="onFps">
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

      <el-aside class="viewer__aside" width="330px">
        <ModelInfoPanel />
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
import ModelInfoPanel from '../components/panels/ModelInfoPanel.vue'
import ModelCanvas from '../components/viewer/ModelCanvas.vue'
import { useModelOpen } from '../composables/useModelOpen.js'
import { resolveFormatById } from '../constants/formats.js'
import { capabilities } from '../platform/index.js'
import { useModelStore } from '../stores/modelStore.js'
import { useSettingsStore } from '../stores/settingsStore.js'
import { formatBytes, formatCount } from '../utils/format.js'

const router = useRouter()
const model = useModelStore()
const settings = useSettingsStore()

// 引擎是重对象：用 shallowRef 只做引用传递，避免被深度代理
const engineRef = shallowRef(null)
const stageRef = ref(null)
const rendererInfo = ref({ gpu: '未知', webglVersion: '—' })
const fps = ref(0)

const { openViaDialog, cancelLoading, fitView, registerDropTarget } = useModelOpen(engineRef)

let unlistenDrop = () => {}

const formatLabel = computed(() => resolveFormatById(model.formatId)?.label ?? '—')
const sizeText = computed(() => formatBytes(model.sizeBytes))
const triangleText = computed(() => formatCount(model.stats?.triangleCount ?? 0))

onMounted(async () => {
  await settings.load()
  unlistenDrop = await registerDropTarget(stageRef.value)
})

onBeforeUnmount(() => {
  unlistenDrop?.()
})

function onEngineReady(engine) {
  engineRef.value = engine
  rendererInfo.value = engine.getRendererInfo()
}

function onFps(value) {
  fps.value = value
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

.viewer__footer {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-top: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
}
</style>
