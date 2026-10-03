<template>
  <!--
    只用 keep-alive 缓存查看器，不缓存设置页（纯表单，重新挂载没有代价）。
    查看器一旦卸载就会 dispose 渲染引擎、丢掉当前模型 —— 用户只是去改个设置，
    回来模型就没了（这是个已修的 BUG）。
  -->
  <router-view v-slot="{ Component }">
    <keep-alive :include="['Viewer']">
      <component :is="Component" />
    </keep-alive>
  </router-view>
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
