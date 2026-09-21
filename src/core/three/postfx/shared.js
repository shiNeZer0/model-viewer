/**
 * 后处理通道的共享工具（**叶子模块**：不 import 任何通道，用来打断循环依赖）。
 */

/** 默认 MSAA 采样数；低性能模式把它降到 0（见 perfMode.js） */
export const DEFAULT_POSTFX_SAMPLES = 4

/** 把数值夹到 `[min, max]`；非法值回退到 fallback（避免把 undefined/NaN 喂给着色器） */
export function clampRange(value, { min, max }, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
