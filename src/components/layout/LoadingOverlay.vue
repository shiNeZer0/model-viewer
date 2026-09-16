<template>
  <div class="loading-overlay">
    <div class="loading-overlay__card">
      <p class="loading-overlay__title">正在加载 {{ fileName || '模型' }}</p>
      <el-progress
        :percentage="percent"
        :indeterminate="percent === 0"
        :duration="1.4"
        :stroke-width="6"
        :show-text="false"
      />
      <p class="loading-overlay__detail">{{ detail }}</p>
      <el-button size="small" @click="emit('cancel')">取消加载</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  fileName: { type: String, default: '' },
  percent: { type: Number, default: 0 },
})

const emit = defineEmits(['cancel'])

const detail = computed(() =>
  props.percent > 0 ? `已完成 ${props.percent}%` : '正在准备解码器与解析文件…',
)
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 17, 21, 0.72);
}

.loading-overlay__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  width: 280px;
  padding: 20px;
  border-radius: 8px;
  background-color: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
}

.loading-overlay__title {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  word-break: break-all;
  text-align: center;
}

.loading-overlay__detail {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
