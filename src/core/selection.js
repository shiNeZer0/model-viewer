/**
 * 选中状态的纯逻辑（可单测）。
 *
 * 单独成模块的原因：这条规则同时被"点击节点"和"清除高亮按钮"两处依赖，
 * 而它又是一个容易写反的判定（再次点击已选中项 = 取消）。
 */

/**
 * 点击层级节点后应当选中的 id。
 *
 * **再次点击已选中的节点表示取消选中**（返回空串）—— 这是"清除高亮"最顺手的入口，
 * 与工具栏的「清除高亮」按钮等价。
 *
 * @param {string} currentId 当前选中的节点 id（空串表示没有选中）
 * @param {string} clickedId 本次点击的节点 id
 * @returns {string} 新的选中 id；空串表示清除选中
 */
export function resolveNodeClick(currentId, clickedId) {
  if (!clickedId) return ''
  return currentId === clickedId ? '' : clickedId
}
