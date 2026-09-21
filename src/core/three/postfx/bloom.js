/**
 * 泛光通道（UnrealBloom）。
 *
 * **默认关**，这是刻意的：泛光会把亮部溢出到邻域，等于主动糊掉细节。对一个"忠实呈现模型"
 * 的查看器来说，它是展示向效果 —— 出图、演示时打开很好，日常检视模型时反而碍事。
 * （用户可在显示面板里随时打开。）
 *
 * 它工作在线性空间（OutputPass 之前），这对泛光是**正确**的：真实的光晕发生在高动态范围
 * 的亮度上，先做色调映射再泛光会得到偏暗、发灰的结果。
 */

import { Vector2 } from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export const BLOOM_DEFAULTS = {
  /** 强度（0 = 关闭） */
  strength: 0.35,
  /** 扩散半径 */
  radius: 0.4,
  /** 亮度阈值：只有比它更亮的部分才发光，调低会把整个模型都"点亮" */
  threshold: 0.9,
}

export const BLOOM_RANGES = {
  strength: { min: 0, max: 2, step: 0.05 },
  radius: { min: 0, max: 1, step: 0.05 },
  threshold: { min: 0, max: 1, step: 0.01 },
}

export const bloomChannel = {
  id: 'bloom',
  label: '泛光',
  order: 30,
  defaultEnabled: false,
  heavy: true,
  defaultSettings: { ...BLOOM_DEFAULTS },
  ranges: BLOOM_RANGES,

  create({ width, height }) {
    const pass = new UnrealBloomPass(
      new Vector2(width, height),
      BLOOM_DEFAULTS.strength,
      BLOOM_DEFAULTS.radius,
      BLOOM_DEFAULTS.threshold,
    )
    pass.name = 'mv-postfx-bloom'
    return pass
  },

  update(pass, settings) {
    pass.strength = settings.strength
    pass.radius = settings.radius
    pass.threshold = settings.threshold
  },

  isIdentity(settings) {
    return !(settings.strength > 0)
  },

  describe(pass, settings) {
    return { strength: settings.strength, threshold: settings.threshold }
  },

  dispose(pass) {
    pass.dispose?.()
  },
}
