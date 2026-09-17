<template>
  <!-- 信息浮层：有模型时才出现；快捷键 I 或圆点按钮折叠/展开 -->
  <div v-if="model.hasModel" class="info-hud">
    <button
      v-if="!visible"
      class="info-hud__chip"
      type="button"
      title="显示模型信息（快捷键 I）"
      @click="emit('update:visible', true)"
    >
      i
    </button>

    <div v-else class="info-hud__panel">
      <div class="info-hud__head">
        <span class="info-hud__title">{{ model.fileName || '未打开模型' }}</span>
        <button
          class="info-hud__toggle"
          type="button"
          title="隐藏（快捷键 I）"
          @click="emit('update:visible', false)"
        >
          ×
        </button>
      </div>

      <dl class="info-hud__grid">
        <dt>格式</dt>
        <dd>{{ formatLabel }}</dd>
        <dt>大小</dt>
        <dd>{{ sizeText }}</dd>
        <dt>三角面</dt>
        <dd>{{ triangleText }}</dd>
        <dt>顶点</dt>
        <dd>{{ vertexText }}</dd>
        <dt>尺寸</dt>
        <dd>{{ dimensionText }}</dd>
        <dt>帧数</dt>
        <dd>{{ frames }}</dd>
        <dt>FPS</dt>
        <dd>{{ fps }}</dd>
        <dt>渲染</dt>
        <dd>{{ webglVersion }} · {{ postFx ? '后处理' : '直渲' }}</dd>
        <dt>运行</dt>
        <dd>{{ runtimeLabel }}</dd>
      </dl>

      <p v-if="errorText" class="info-hud__error">{{ errorText }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { resolveFormatById } from '../../constants/formats.js'
import { formatLength } from '../../core/three/units.js'
import { capabilities } from '../../platform/index.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useModelStore } from '../../stores/modelStore.js'
import { formatBytes, formatCount } from '../../utils/format.js'

const props = defineProps({
  visible: { type: Boolean, default: true },
  fps: { type: Number, default: 0 },
  frames: { type: Number, default: 0 },
  webglVersion: { type: String, default: '—' },
  postFx: { type: Boolean, default: true },
  errorText: { type: String, default: '' },
})
// 模板通过 props 名直接访问（visible / frames / fps …），无需在脚本里再引用
void props

const emit = defineEmits(['update:visible'])

const model = useModelStore()
const display = useDisplayStore()

const runtimeLabel = capabilities.runtimeLabel

const formatLabel = computed(() => resolveFormatById(model.formatId)?.label ?? '—')
const sizeText = computed(() => formatBytes(model.sizeBytes))
const triangleText = computed(() => formatCount(model.stats?.triangleCount ?? 0))
const vertexText = computed(() => formatCount(model.stats?.vertexCount ?? 0))

/** 尺寸按「模型信息」页声明的单位换算后显示，三个轴各自带单位 */
const dimensionText = computed(() => {
  const size = model.bounds?.size
  if (!size) return '—'
  const options = { sourceUnit: display.sourceUnit, displayUnit: display.displayUnit }
  return [size.x, size.y, size.z].map((value) => formatLength(value, options).text).join(' × ')
})
</script>

<style scoped>
.info-hud {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  font-size: 12px;
  pointer-events: none;
}

.info-hud__panel,
.info-hud__chip {
  pointer-events: auto;
}

.info-hud__panel {
  min-width: 196px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  /* 半透明浮层：按用户要求透明度 0.3（更透，方便直接看模型） */
  background: rgba(15, 17, 21, 0.3);
  color: var(--el-text-color-primary);
  backdrop-filter: blur(3px);
}

.info-hud__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.info-hud__title {
  flex: 1;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-hud__toggle {
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.info-hud__toggle:hover {
  color: var(--el-color-primary);
}

.info-hud__grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
}

.info-hud__grid dt {
  color: var(--el-text-color-secondary);
}

.info-hud__grid dd {
  margin: 0;
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-hud__error {
  margin: 6px 0 0;
  color: var(--el-color-danger);
}

.info-hud__chip {
  width: 22px;
  height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  background: rgba(15, 17, 21, 0.3);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-style: italic;
  line-height: 1;
}

.info-hud__chip:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

/* 亮色主题下换成浅色半透明底（用户指定的 0.3 透明度保持一致） */
html:not(.dark) .info-hud__panel,
html:not(.dark) .info-hud__chip {
  background: rgba(255, 255, 255, 0.34);
  border-color: rgba(255, 255, 255, 0.5);
}
</style>
