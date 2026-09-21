/**
 * 选中描边通道。
 *
 * 层级树早就能选中节点（`focusNode` 也会把相机推过去），但**视口里一直没有对应的视觉反馈** ——
 * 这个通道补上"选中"这个交互的最后一环。
 *
 * 与「仅线框」（shadeModes.js 自己生成的 LineSegments 覆盖层）是两回事：
 * 那是把整个模型画成线，这里是给**选中的那个节点**描一圈边，两者可以同时存在。
 *
 * 它引入了一个通道接口的新用法：pass 持有**外部写入的状态**（selectedObjects）。
 * 因此没有选中对象时由 `isIdentity` 声明"这一趟没有意义"，管线会直接跳过
 * （OutlinePass 每帧要渲染两遍，空跑并不便宜）。
 */

import { Vector2 } from 'three'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'

export const OUTLINE_DEFAULTS = {
  edgeStrength: 4,
  edgeGlow: 0,
  edgeThickness: 1.5,
  pulsePeriod: 0,
}

/** 与线框覆盖层同色系，保证"选中"与"线框"看起来是一套语言 */
export const OUTLINE_VISIBLE_COLOR = '#7fb2ff'
/** 被遮挡部分的描边（比可见部分暗，保留"在后面"的深度感） */
export const OUTLINE_HIDDEN_COLOR = '#2a3f66'

export const OUTLINE_RANGES = {
  edgeStrength: { min: 0, max: 10, step: 0.5 },
  edgeThickness: { min: 0.5, max: 5, step: 0.5 },
  edgeGlow: { min: 0, max: 1, step: 0.05 },
}

export const outlineChannel = {
  id: 'outline',
  label: '选中描边',
  order: 10,
  defaultEnabled: true,
  defaultSettings: {
    ...OUTLINE_DEFAULTS,
    visibleColor: OUTLINE_VISIBLE_COLOR,
    hiddenColor: OUTLINE_HIDDEN_COLOR,
  },
  ranges: OUTLINE_RANGES,

  create({ scene, camera, width, height }) {
    const pass = new OutlinePass(new Vector2(width, height), scene, camera)
    pass.name = 'mv-postfx-outline'
    // 选中对象由引擎在选中变化时写入（见 ViewerEngine.setSelectedNode）
    pass.selectedObjects = []
    return pass
  },

  update(pass, settings) {
    pass.edgeStrength = settings.edgeStrength
    pass.edgeGlow = settings.edgeGlow
    pass.edgeThickness = settings.edgeThickness
    pass.pulsePeriod = settings.pulsePeriod
    pass.visibleEdgeColor.set(settings.visibleColor)
    pass.hiddenEdgeColor.set(settings.hiddenColor)
  },

  /** 没有选中任何对象时不必跑（该 pass 每帧渲染两遍） */
  isIdentity(settings, pass) {
    return !pass || (pass.selectedObjects?.length ?? 0) === 0
  },

  describe(pass) {
    return { selected: pass?.selectedObjects?.length ?? 0 }
  },

  dispose(pass) {
    pass.dispose?.()
  },
}
