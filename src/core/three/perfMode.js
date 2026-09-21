/**
 * 画质档位（纯逻辑，可单测）。
 *
 * 「低性能模式」面向软件渲染 / 集显 / 高 DPI 屏上的大模型（设计文档 §9 的目标里提到过，
 * 但此前一直没实现）。它只做两件**收益确定**的事：
 *   1. 渲染像素比上限降到 1 —— 在两倍屏上等于把像素数砍到 1/4，是收益最大的一项；
 *   2. 关掉 MSAA（后处理 render target 的采样数降为 0，直渲路径不申请 antialias）。
 *
 * 刻意**没做**「环境贴图降到 256」：默认的程序化渐变本就只有 128×64（参见
 * environment.js 的 GRADIENT_TEXTURE_SIZE），没有可降的空间；导入的 HDR 要做降采样
 * 还得额外加一条链路，收益完全取决于用户素材。宁可不假装做了，也不写一条测不出效果的代码。
 *
 * 默认关闭：它换掉的是默认观感，必须由用户显式选择。
 */

import { DEFAULT_POSTFX_SAMPLES } from './postfx.js'

/** 常规像素比上限（与引擎此前的硬编码默认值一致） */
export const DEFAULT_MAX_PIXEL_RATIO = 2
/** 低性能模式下的像素比上限 */
export const LOW_PERFORMANCE_PIXEL_RATIO = 1
/** 低性能模式下的 MSAA 采样数（0 = 关闭） */
export const LOW_PERFORMANCE_SAMPLES = 0

/**
 * 当前应使用的像素比上限。
 * @param {{lowPerformance?: boolean, maxPixelRatio?: number}} options
 * @returns {number} 低性能模式恒为 1；否则用户设置值，非法时回退到 2
 */
export function resolvePixelRatioLimit({ lowPerformance = false, maxPixelRatio } = {}) {
  if (lowPerformance) return LOW_PERFORMANCE_PIXEL_RATIO
  return Number.isFinite(maxPixelRatio) && maxPixelRatio > 0
    ? maxPixelRatio
    : DEFAULT_MAX_PIXEL_RATIO
}

/** 当前应使用的 MSAA 采样数 */
export function resolvePostFxSamples({ lowPerformance = false } = {}) {
  return lowPerformance ? LOW_PERFORMANCE_SAMPLES : DEFAULT_POSTFX_SAMPLES
}

/**
 * 是否需要申请默认帧缓冲的抗锯齿。
 * 它是 WebGLRenderer 的构造参数，运行时改不了，因此只能在创建引擎时决定
 * —— 也就是说切换档位后，这一项要到下次建引擎才完全生效（引擎会说明这点）。
 */
export function resolveAntialias({ lowPerformance = false } = {}) {
  return !lowPerformance
}
