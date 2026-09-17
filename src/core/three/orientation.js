/**
 * 模型轴向修正（Z-up ↔ Y-up）。
 *
 * 为什么需要：三维格式对"哪个轴朝上"没有统一约定——glTF 用 Y-up，而 3MF 规范是 Z-up，
 * FBX 则取决于导出器（3ds Max 系常是 Z-up，Maya 系常是 Y-up）。不修正的话，
 * 3MF 模型会"躺着"，跟随其后的包围盒尺寸、地面网格与相机适配全都跟着错。
 *
 * 与 ModelPlacement 相同的模式：**记住原始姿态，每次从原始值重新计算**，
 * 因此反复切换设置不会累积旋转。
 */

import { Euler, Quaternion, Vector3 } from 'three'

export const UP_AXIS_MODES = [
  { id: 'auto', label: '自动（3MF 按 Z-up 处理）' },
  { id: 'keep', label: '保持原样' },
  { id: 'z-up', label: '按 Z-up 处理（绕 X 轴 -90°）' },
]

export const DEFAULT_UP_AXIS = 'auto'

/** Z-up → Y-up：绕世界 X 轴 -90° */
export const Z_UP_ROTATION = [-Math.PI / 2, 0, 0]

export function resolveUpAxisMode(modeId) {
  if (!modeId) return null
  return UP_AXIS_MODES.find((mode) => mode.id === modeId) ?? null
}

/**
 * 是否需要把模型从 Z-up 转成 Y-up（纯函数）。
 * @param {{upAxis?: string, formatId?: string}} options
 */
export function shouldConvertUpAxis({ upAxis = DEFAULT_UP_AXIS, formatId = '' } = {}) {
  const mode = resolveUpAxisMode(upAxis)?.id ?? DEFAULT_UP_AXIS
  if (mode === 'keep') return false
  if (mode === 'z-up') return true
  // auto：只有 3MF 规范明确声明 Z-up；FBX 视导出器而定，交给用户切换
  return String(formatId).toLowerCase() === '3mf'
}

/** 轴向修正四元数（默认 Z-up → Y-up）；分量非法时按 0 处理，绝不产生 NaN 姿态 */
export function createUpAxisQuaternion(rotation = Z_UP_ROTATION) {
  const [rawX, rawY, rawZ] = Array.isArray(rotation) ? rotation : []
  const x = Number.isFinite(rawX) ? rawX : 0
  const y = Number.isFinite(rawY) ? rawY : 0
  const z = Number.isFinite(rawZ) ? rawZ : 0
  return new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'))
}

export class ModelOrientation {
  /**
   * @param {object} object 已加入场景根的模型根节点（父级为单位变换）
   */
  constructor(object) {
    if (!object) throw new Error('ModelOrientation 需要一个对象')
    this.object = object
    /** 模型自带的原始姿态 */
    this.originalQuaternion = object.quaternion.clone()
  }

  get isPristine() {
    return this.object.quaternion.equals(this.originalQuaternion)
  }

  /**
   * 按设置应用轴向修正。
   * 用**预乘**（世界空间）而不是局部旋转：这样"把模型翻过来"的语义与用户在视图里看到的一致。
   * @returns {boolean} 是否实际做了转换
   */
  apply({ upAxis = DEFAULT_UP_AXIS, formatId = '' } = {}) {
    this.object.quaternion.copy(this.originalQuaternion)

    const converted = shouldConvertUpAxis({ upAxis, formatId })
    if (converted) {
      this.object.quaternion.premultiply(createUpAxisQuaternion())
    }
    this.object.updateMatrixWorld(true)
    return converted
  }

  /** 恢复模型自带姿态 */
  restore() {
    this.object.quaternion.copy(this.originalQuaternion)
    this.object.updateMatrixWorld(true)
  }
}

/** 便于测试与调试：把向量按某模式转换后的方向算出来 */
export function convertDirection(direction, { upAxis = DEFAULT_UP_AXIS, formatId = '' } = {}) {
  const vector = new Vector3(...direction)
  if (shouldConvertUpAxis({ upAxis, formatId })) {
    vector.applyQuaternion(createUpAxisQuaternion())
  }
  return vector
}
