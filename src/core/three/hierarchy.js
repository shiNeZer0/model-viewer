/**
 * 场景层级提取：把 three 的对象树转成**纯数据树**（可直接喂给 el-tree）。
 *
 * 为什么要转成纯数据：three 的 Object3D 不该进 Vue 响应式系统（会被深度代理、拖慢渲染），
 * 而 el-tree 需要可响应的节点数组。因此这里一次性抽出只读数据，
 * 真正的对象引用放在引擎侧的 `nodeById`（非响应式 Map）里，UI 通过 id 回调引擎操作。
 *
 * 超大模型保护：节点数超过 maxNodes 时停止遍历并置 truncated，避免 el-tree 渲染上万节点卡死。
 */

import { triangleCountOf } from './shadeModes.js'

export const MAX_HIERARCHY_NODES = 5000

export const NODE_TYPE = {
  skinnedMesh: '骨骼网格',
  mesh: '网格',
  points: '点云',
  line: '线',
  light: '灯光',
  camera: '相机',
  group: '组',
  object: '对象',
}

export function describeNodeType(node) {
  if (node?.isSkinnedMesh) return NODE_TYPE.skinnedMesh
  if (node?.isMesh) return NODE_TYPE.mesh
  if (node?.isPoints) return NODE_TYPE.points
  if (node?.isLine) return NODE_TYPE.line
  if (node?.isLight) return NODE_TYPE.light
  if (node?.isCamera) return NODE_TYPE.camera
  if (node?.isGroup) return NODE_TYPE.group
  return NODE_TYPE.object
}

/**
 * 构建层级数据。
 * @param {object} root 模型根节点
 * @param {{skipEmpty?: boolean, maxNodes?: number}} options
 *        skipEmpty=true 会跳过"既无几何也无子节点"的空 Leaf（导出器常产生大量空节点）
 * @returns {{nodes: Array, nodeById: Map<string, object>, count: number, truncated: boolean}}
 */
export function buildHierarchy(root, { skipEmpty = true, maxNodes = MAX_HIERARCHY_NODES } = {}) {
  const nodeById = new Map()
  if (!root) return { nodes: [], nodeById, count: 0, truncated: false }

  let count = 0
  let truncated = false

  const walk = (node) => {
    if (count >= maxNodes) {
      truncated = true
      return null
    }
    count += 1
    nodeById.set(node.uuid, node)

    const children = []
    for (const child of node.children ?? []) {
      const entry = walk(child)
      if (entry) children.push(entry)
    }

    const geometry = node.geometry
    const type = describeNodeType(node)
    const isMeshLike = Boolean(node.isMesh || node.isSkinnedMesh)
    const isEmptyLeaf = !geometry && children.length === 0 && node !== root

    if (skipEmpty && isEmptyLeaf) {
      count -= 1
      nodeById.delete(node.uuid)
      return null
    }

    return {
      id: node.uuid,
      label: node.name?.trim() || `${type} #${String(node.uuid).slice(0, 4)}`,
      type,
      isMesh: isMeshLike,
      hasGeometry: Boolean(geometry),
      visible: node.visible !== false,
      // 只有网格类才有三角面：点云/线即使带几何体也不计面数（与 stats.js 口径一致）
      triangles: geometry && isMeshLike ? triangleCountOf(geometry) : 0,
      vertices: geometry?.attributes?.position?.count ?? 0,
      children,
    }
  }

  const rootEntry = walk(root)
  return { nodes: rootEntry ? [rootEntry] : [], nodeById, count, truncated }
}

/** 深度优先展开成扁平数组（用于"全部显示/隐藏"等批量操作与测试断言） */
export function flattenHierarchy(nodes, result = []) {
  for (const node of nodes ?? []) {
    result.push(node)
    flattenHierarchy(node.children, result)
  }
  return result
}
