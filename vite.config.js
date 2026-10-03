import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    /*
     * 图标在**编译期**编译成 Vue 组件，只打包真正 import 的那几个 SVG。
     * 刻意不用 Iconify 的运行时 API：桌面版必须离线可用，而把整个
     * Material Symbols 图标集（数千个）塞进安装包是不可接受的。
     */
    Icons({ compiler: 'vue3' }),
  ],
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
