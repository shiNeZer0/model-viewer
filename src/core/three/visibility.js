/**
 * 节点可见性解析。
 *
 * 这是 M1 那类"用户意图被别的逻辑覆盖"问题的正面解法：把可见性收敛成**唯一一处**计算，
 * 输入是「用户手动开关」「模型自带的原始可见性」「当前着色模式是否要隐藏实体」三者，
 * 输出才是节点最终该有的 visible。
 *
 * 如果没有这一层，「仅线框」模式切回来时会把用户手动隐藏的网格一起显示出来
 * （因为模式切换是按"原始可见性"整体重置 visible 的）。
 */

/** 单节点的最终可见性（纯函数，便于覆盖各组合） */
export function resolveNodeVisibility({
  isMesh = false,
  userOverride,
  originalVisible,
  hideSolids = false,
} = {}) {
  const base = userOverride ?? originalVisible
  const visible = base === undefined ? true : Boolean(base)
  // 「仅线框」只隐藏实体网格；点云/线不受影响
  return isMesh && hideSolids ? false : visible
}

/** 记录模型自带的原始可见性（切换模型时各调一次） */
export function captureVisibility(root) {
  const originals = new Map()
  root?.traverse((node) => {
    originals.set(node, node.visible !== false)
  })
  return originals
}

/**
 * 把可见性解析结果落到对象树上。
 * @param {object} root 模型根节点
 * @param {{overrides?: Map, originals?: Map, hideSolids?: boolean}} options
 * @returns {number} 实际发生变化的节点数（用于日志/排障）
 */
export function applyVisibility(root, { overrides = new Map(), originals = new Map(), hideSolids = false } = {}) {
  let changed = 0
  root?.traverse((node) => {
    const isMesh = Boolean(node.isMesh || node.isSkinnedMesh)
    const next = resolveNodeVisibility({
      isMesh,
      userOverride: overrides.get(node),
      originalVisible: originals.get(node),
      hideSolids,
    })
    if (node.visible !== next) {
      node.visible = next
      changed += 1
    }
  })
  return changed
}
