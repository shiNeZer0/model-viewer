<template>
  <div class="tree-panel">
    <div class="tree-panel__toolbar">
      <!--
        工具栏用**纯图标 + tooltip**：侧栏只有 340px，四个「图标 + 文字」按钮会直接溢出。
        纯图标反而比原来的纯文字更省空间（"长模型名挤掉操作按钮"那条教训在这里同样适用）。
      -->
      <el-tooltip content="显示全部节点" placement="bottom">
        <el-button size="small" :disabled="!nodes.length" @click="emit('show-all')">
          <el-icon><IconVisibility /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="隐藏全部节点" placement="bottom">
        <el-button size="small" :disabled="!nodes.length" @click="emit('hide-all')">
          <el-icon><IconVisibilityOff /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="恢复模型自带的显示状态" placement="bottom">
        <el-button size="small" :disabled="!nodes.length" @click="emit('reset-visibility')">
          <el-icon><IconRestartAlt /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="清除选中高亮（也可以再次点击已选中的节点）" placement="bottom">
        <el-button size="small" :disabled="!selectedId" @click="clearSelection">
          <el-icon><IconDeselect /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <el-alert
      v-if="truncated"
      class="tree-panel__alert"
      type="warning"
      :closable="false"
      show-icon
      title="节点数过多，层级树已截断显示（只影响列表，模型本身完整）"
    />

    <!--
      空选中必须传 null 而不是空串：el-tree 的 setCurrentNodeKey 只在 key 为
      null/undefined 时才走清除分支，传 '' 会落到"找不到节点就什么都不做"，
      结果是描边没了、列表里那一行还亮着。
    -->
    <el-tree
      v-if="nodes.length"
      class="tree-panel__tree"
      :data="nodes"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      :current-node-key="selectedId || null"
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
            <el-tooltip content="聚焦到该节点" placement="left">
              <el-button size="small" text @click.stop="emit('focus', data.id)">
                <el-icon><IconCenterFocusStrong /></el-icon>
              </el-button>
            </el-tooltip>
            <!--
              可见性开关用图标而不是 el-switch：
              switch 在每行都占固定宽度，而这一列本来就要和长模型名抢空间（见下方 CSS 注释）；
              图标按钮与「聚焦」同一套样式，状态由图标形状区分（实心眼睛 / 划掉的眼睛），
              节点名另有删除线呼应。
            -->
            <el-tooltip
              :content="data.visible ? '隐藏该节点' : '显示该节点'"
              placement="left"
            >
              <el-button
                size="small"
                text
                :type="data.visible ? 'default' : 'info'"
                @click.stop="emit('toggle-visibility', data.id, !data.visible)"
              >
                <el-icon>
                  <IconVisibility v-if="data.visible" />
                  <IconVisibilityOff v-else />
                </el-icon>
              </el-button>
            </el-tooltip>
          </span>
        </div>
      </template>
    </el-tree>

    <el-empty v-else description="还没有加载模型" :image-size="60" />

    <p class="tree-panel__hint">
      「聚焦」把相机对准该节点；隐藏父节点会连同它的子树一起隐藏，模型自带的隐藏状态可用「重置」恢复。
      点击节点即高亮（视口里描一圈橙红边），再次点击同一个节点或按「清除高亮」可取消。
    </p>
  </div>
</template>

<script setup>
import { resolveNodeClick } from '../../core/selection.js'
import { formatCount } from '../../utils/format.js'
import IconCenterFocusStrong from '~icons/material-symbols/center-focus-strong'
import IconDeselect from '~icons/material-symbols/deselect'
import IconRestartAlt from '~icons/material-symbols/restart-alt'
import IconVisibility from '~icons/material-symbols/visibility'
import IconVisibilityOff from '~icons/material-symbols/visibility-off'

const props = defineProps({
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
  // 再次点击已选中的节点 = 取消高亮（与工具栏的「清除高亮」等价）
  emit('select', resolveNodeClick(props.selectedId, data.id))
}

/** 清除选中：复用 select 事件，空 id 即"没有选中" */
function clearSelection() {
  emit('select', '')
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
  /*
   * 关键：作为 el-tree 节点内容里的 flex 子项，必须 flex:1 + min-width:0 ——
   * 只写 width:100% 时会与前面的展开箭头抢空间，且子项默认的 min-width:auto 不允许收窄到内容宽度以下，
   * 于是长名字把整行撑宽（树容器 overflow:auto → 出现横向滚动），右边的「聚焦 / 显示隐藏」就被推到视野之外。
   */
  flex: 1;
  min-width: 0;
  padding-right: 4px;
  font-size: 12px;
}

.tree-node__label {
  /* 名字占满剩余空间、超出省略；min-width:0 是省略号能生效的前提 */
  flex: 1 1 auto;
  min-width: 0;
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
