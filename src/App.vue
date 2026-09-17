<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'

import { useThemeStore } from './stores/themeStore.js'

/*
 * 主题必须在应用挂载时就落地：index.html 里的 <html class="dark"> 只是首屏默认值，
 * 用户可能选过"亮色"或"跟随系统"，这里读回设置并同步 DOM 与系统监听。
 */
const theme = useThemeStore()

onMounted(() => {
  void theme.init()
})
</script>
