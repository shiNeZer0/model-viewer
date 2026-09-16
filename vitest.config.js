import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只覆盖无 DOM 依赖的纯函数模块（统计、单位换算、格式判定、光照预设等）
    environment: 'node',
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
  },
})
