<template>
  <div class="tree-panel">
    <div class="tree-panel__toolbar">
      <el-button size="small" :disabled="!nodes.length" @click="emit('show-all')">全部显示</el-button>
      <el-button size="small" :disabled="!nodes.length" @click="emit('hide-all')">全部隐藏</el-button>
      <el-button size="small" :disabled="!nodes.length" @click="emit('reset-visibility')">
        重置
      </el-button>
    </div>

    <el-alert
      v-if="truncated"
      class="tree-panel__alert"
      type="warning"
      :closable="false"
      show-icon
      title="节点数过多，层级树已截断显示（只影响列表，模型本身完整）"
    />

    <el-tree
      v-if="nodes.length"
      class="tree-panel__tree"
      :data="nodes"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      :current-node-key="selectedId"
      :expand-on-click-node="false"
      default-expand-all
      highlight-current
      @node-click="onNodeClick"
    >
      <template #default="{ data }">
        <div class="tree-node">
          <span
            class="tree-node__label"
            :class="{ 'tree-node__label--hidden': !data.visible }"
            :title="data.label"
          >
            {{ data.label }}
          </span>
          <span class="tree-node__meta">
            {{ data.type }}<template v-if="data.triangles"> · {{ tri(data.triangles) }} 面</template>
          </span>
          <span class="tree-node__actions">
            <el-button size="small" text @click.stop="emit('focus', data.id)">聚焦</el-button>
            <el-switch
              size="small"
              :model-value="data.visible"
              @click.stop
              @update:model-value="emit('toggle-visibility', data.id, $event)"
            />
          </span>
        </div>
      </template>
    </el-tree>

    <el-empty v-else description="还没有加载模型" :image-size="60" />

    <p class="tree-panel__hint">
      「聚焦」把相机对准该节点；隐藏父节点会连同它的子树一起隐藏，模型自带的隐藏状态可用「重置」恢复。
    </p>
  </div>
</template>

<script setup>
import { formatCount } from '../../utils/format.js'

defineProps({
  nodes: { type: Array, default: () => [] },
  truncated: { type: Boolean, default: false },
  selectedId: { type: String, default: '' },
})

const emit = defineEmits([
  'focus',
  'select',
  'toggle-visibility',
  'show-all',
  'hide-all',
  'reset-visibility',
])

const tri = formatCount

function onNodeClick(data) {
  emit('select', data.id)
}
</script>

<style scoped>
.tree-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 12px;
  overflow: hidden;
}

.tree-panel__toolbar {
  display: flex;
  gap: 6px;
}

.tree-panel__alert {
  margin: 0;
}

.tree-panel__tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: transparent;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding-right: 4px;
  font-size: 12px;
}

.tree-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node__label--hidden {
  color: var(--el-text-color-disabled);
  text-decoration: line-through;
}

.tree-node__meta {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.tree-node__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.tree-panel__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
