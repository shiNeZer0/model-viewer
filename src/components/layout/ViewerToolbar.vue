<template>
  <div class="viewer-toolbar">
    <el-button-group>
      <el-button type="primary" :loading="loading" @click="emit('open')">打开模型</el-button>
      <el-button :disabled="!hasModel" @click="emit('fit')">适配视图</el-button>
    </el-button-group>

    <div class="viewer-toolbar__spacer" />

    <el-tooltip content="转盘模式：视角绕模型自动旋转" placement="bottom">
      <span class="viewer-toolbar__switch">
        <span class="viewer-toolbar__label">转盘</span>
        <el-switch
          :model-value="autoRotate"
          :disabled="!hasModel"
          @update:model-value="emit('update:autoRotate', $event)"
        />
      </span>
    </el-tooltip>

    <el-button text @click="emit('settings')">设置</el-button>
  </div>
</template>

<script setup>
defineProps({
  hasModel: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  autoRotate: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'fit', 'update:autoRotate', 'settings'])
</script>

<style scoped>
.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
}

.viewer-toolbar__spacer {
  flex: 1;
}

.viewer-toolbar__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.viewer-toolbar__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
</style>
