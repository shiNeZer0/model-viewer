/**
 * 景深通道（Bokeh）。
 *
 * **默认关**，理由与泛光同源：虚化会主动模糊模型本身，是"摄影"效果而不是"检视"效果。
 *
 * 参数里唯一需要解释的是 `focusDistance`：BokehPass 的 `focus` 是**沿相机视线方向的世界
 * 单位距离**，而查看器里相机一直在动（轨道操作、视图切换、入场动画），所以它不能是固定值。
 * 引擎在相机变化时把"相机到模型中心的距离"写进来，`focusRatio` 再让用户决定"对焦点落在
 * 模型前面还是后面"（1 = 正好在模型中心）。
 */

import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'

export const DOF_DEFAULTS = {
  /** 对焦距离相对"相机到模型中心距离"的比例：1 = 对在模型中心 */
  focusRatio: 1,
  aperture: 0.02,
  maxblur: 0.008,
}

export const DOF_RANGES = {
  focusRatio: { min: 0.2, max: 2, step: 0.05 },
  aperture: { min: 0, max: 0.1, step: 0.002 },
  maxblur: { min: 0, max: 0.05, step: 0.001 },
}

export const dofChannel = {
  id: 'dof',
  label: '景深',
  order: 40,
  defaultEnabled: false,
  heavy: true,
  defaultSettings: {
    ...DOF_DEFAULTS,
    /** 引擎写入：当前相机到模型中心的距离（世界单位） */
    focusDistance: 1,
  },
  ranges: DOF_RANGES,

  create({ scene, camera }) {
    const pass = new BokehPass(scene, camera, {
      focus: DOF_DEFAULTS.focusRatio,
      aperture: DOF_DEFAULTS.aperture,
      maxblur: DOF_DEFAULTS.maxblur,
    })
    pass.name = 'mv-postfx-dof'
    return pass
  },

  update(pass, settings) {
    pass.uniforms.focus.value = Math.max(settings.focusDistance * settings.focusRatio, 1e-3)
    pass.uniforms.aperture.value = settings.aperture
    pass.uniforms.maxblur.value = settings.maxblur
  },

  isIdentity(settings) {
    return !(settings.aperture > 0 && settings.maxblur > 0)
  },

  describe(pass, settings) {
    return { focusRatio: settings.focusRatio, maxblur: settings.maxblur }
  },

  dispose(pass) {
    pass.dispose?.()
  },
}
