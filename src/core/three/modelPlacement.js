/**
 * 模型摆放归一化：把模型移到世界中心、底部对齐地面。
 *
 * 为什么需要它：导出的模型常带有任意的原点/偏移（CAD、OBJ、扫描件尤其常见），
 * 直接加载会出现「模型偏在世界一角」「转盘绕着一个空点转」「网格穿过模型」等现象。
 *
 * 关键约束：**必须可重复应用且不漂移**。用户会在面板上反复开关"居中/贴地"、也会连续
 * 切换模型，因此每次都从**原始变换**出发重新计算，而不是在当前位置上累加增量。
 */

import { Box3, Vector3 } from 'three'

/**
 * 计算把包围盒摆正所需的世界空间平移量（纯函数）。
 * @param {Box3} box 当前世界包围盒
 * @param {{center?: boolean, ground?: boolean}} options
 *        center=true → X/Z 居中到世界原点（ground=false 时 Y 也居中）
 *        ground=true → 底部对齐 y=0
 * @returns {Vector3}
 */
export function computePlacementOffset(box, { center = true, ground = true } = {}) {
  if (!box || box.isEmpty?.()) return new Vector3(0, 0, 0)

  const centerPoint = box.getCenter(new Vector3())
  const offsetX = center ? -centerPoint.x : 0
  const offsetZ = center ? -centerPoint.z : 0
  // 贴地优先：底部落到 y=0；不贴地时按"居中"决定 Y
  const offsetY = ground ? -box.min.y : center ? -centerPoint.y : 0

  return new Vector3(offsetX, offsetY, offsetZ)
}

/**
 * 单个模型的摆放控制器。
 *
 * 使用者只需持有一个实例并调用 apply()，它内部会先把位置恢复成原始值再测量，
 * 因此「反复开关」「连续切换设置」都不会累积偏移。
 */
export class ModelPlacement {
  /**
   * @param {object} object 已加入场景根的对象（其父节点变换必须是单位变换）
   */
  constructor(object) {
    if (!object) throw new Error('ModelPlacement 需要一个对象')
    this.object = object
    /** 原始局部位置：关闭归一化时用它完整还原 */
    this.originalPosition = object.position.clone()
  }

  /** 当前是否处于"原样"状态（供 UI / 排障使用） */
  get isPristine() {
    return this.object.position.equals(this.originalPosition)
  }

  /**
   * 按设置重新摆放。
   * @returns {Box3|null} 摆放后的世界包围盒；对象为空时返回 null
   */
  apply({ center = true, ground = true } = {}) {
    // 1) 回到原始变换再测量，保证幂等
    this.object.position.copy(this.originalPosition)
    this.object.updateWorldMatrix(true, true)

    const rawBox = new Box3().setFromObject(this.object)
    if (rawBox.isEmpty()) return null

    // 2) 一次性平移到位（父节点是单位变换，世界空间偏移可直接加到局部位置上）
    const offset = computePlacementOffset(rawBox, { center, ground })
    this.object.position.add(offset)
    this.object.updateWorldMatrix(true, true)

    return new Box3().setFromObject(this.object)
  }

  /** 恢复原始变换（保留原始坐标，供需要查看真实数值的场景） */
  restore() {
    this.object.position.copy(this.originalPosition)
    this.object.updateWorldMatrix(true, true)
    return new Box3().setFromObject(this.object)
  }
}
