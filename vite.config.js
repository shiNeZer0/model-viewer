import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Tauri 会在同一个终端打印 cargo 编译信息，清屏会把这些日志冲掉
  clearScreen: false,
  server: {
    // tauri.conf.json 的 devUrl 固定为 5173，端口漂移会让 Tauri 连不上开发服务器
    port: 5173,
    strictPort: true,
    watch: {
      // src-tauri 的改动由 cargo 自己监听，vite 无需重复扫描（避免无谓的重启）
      ignored: ['**/src-tauri/**'],
    },
  },
})
