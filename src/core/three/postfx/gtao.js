/**
 * 环境光遮蔽（GTAO）通道。
 *
 * 它做的是"凹陷、接缝、夹角处变暗"——这是让形体从"一块糊在一起的几何体"变成
 * "能读出结构的模型"的最有效手段，对 CAD 零件、扫描件、装配体尤其明显。
 *
 * 三个必须知道的事实：
 * 1. **它是最贵的后处理之一**：需要额外的法线/深度预渲染，GTAO 本体 + 泊松降噪 + 合成，
 *    合计三趟以上全屏。因此标了 `heavy`：低性能模式会把它自动关掉。
 * 2. **radius 是世界空间的**，必须随模型尺度走。同一个 0.5 对 1cm 的零件和 100m 的建筑
 *    完全不是一回事 —— 所以设置里存的是"相对包围球半径的比例"，由引擎写入 `sceneRadius`
 *    换算成世界半径。
 * 3. **`samples` 改动会触发材质重编译**（它是 shader 的 define），因此不放进 UI 的
 *    可调范围，只在默认值上固定。
 */

import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'

export const GTAO_DEFAULTS = {
  /** 遮蔽半径，按模型包围球半径的比例计 */
  radius: 0.35,
  /** 合成强度（0 = 关闭） */
  intensity: 1,
  thickness: 1,
  scale: 1,
  samples: 16,
}

/** `samples` 刻意不在可调项里：改它会重编译 shader（见文件头说明） */
export const GTAO_RANGES = {
  radius: { min: 0.02, max: 1.5, step: 0.01 },
  intensity: { min: 0, max: 2, step: 0.05 },
}

export const gtaoChannel = {
  id: 'gtao',
  label: '环境光遮蔽',
  order: 20,
  defaultEnabled: true,
  /** 低性能模式下自动禁用（见 perfMode.js 与 PostFx.setHeavyChannelsEnabled） */
  heavy: true,
  defaultSettings: {
    ...GTAO_DEFAULTS,
    /** 当前模型的包围球半径，由引擎在模型变化时写入 */
    sceneRadius: 1,
  },
  ranges: GTAO_RANGES,

  create({ scene, camera, width, height }) {
    const pass = new GTAOPass(scene, camera, width, height)
    pass.name = 'mv-postfx-gtao'
    // Default = 把 AO 合成进画面（其它取值是调试用的可视化模式）
    pass.output = GTAOPass.OUTPUT.Default
    return pass
  },

  update(pass, settings) {
    pass.blendIntensity = settings.intensity
    pass.updateGtaoMaterial({
      radius: Math.max(settings.radius * settings.sceneRadius, 1e-4),
      thickness: settings.thickness,
      scale: settings.scale,
      samples: settings.samples,
    })
  },

  isIdentity(settings) {
    return !(settings.intensity > 0)
  },

  describe(pass, settings) {
    return {
      radius: settings.radius,
      intensity: settings.intensity,
      samples: settings.samples,
    }
  },

  dispose(pass) {
    pass.dispose?.()
  },
}
