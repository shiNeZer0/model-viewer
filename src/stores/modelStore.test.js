import { createPinia, setActivePinia } from 'pinia'
import { Box3, Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'

import { useModelStore } from './modelStore.js'

/**
 * modelStore 此前没有单测，导致"用了 markRaw 却没 import"这类错误直接漏到用户侧。
 * 这组用例的目标就是让 store 的每一处状态变换都有断言兜着。
 */
beforeEach(() => {
  setActivePinia(createPinia())
})

describe('modelStore 基础状态', () => {
  it('beginLoading → setReady → setError → reset 的状态流转', () => {
    const model = useModelStore()
    model.beginLoading({ path: 'E:/a.glb', fileName: 'a.glb', formatId: 'glb' })
    expect(model.isLoading).toBe(true)
    expect(model.fileName).toBe('a.glb')
    expect(model.formatId).toBe('glb')

    model.setReady({ root: {}, stats: { triangleCount: 12 } })
    expect(model.isReady).toBe(true)
    expect(model.hasModel).toBe(true)
    expect(model.stats.triangleCount).toBe(12)

    model.setError('boom')
    expect(model.status).toBe('error')
    expect(model.errorMessage).toBe('boom')

    model.reset()
    expect(model.status).toBe('empty')
    expect(model.hasModel).toBe(false)
    expect(model.stats).toBe(null)
  })

  it('进度百分比：正常、total 为 0、越界都被夹住', () => {
    const model = useModelStore()
    model.setProgress({ loaded: 50, total: 200 })
    expect(model.progressPercent).toBe(25)

    model.setProgress({ loaded: 10, total: 0 })
    expect(model.progressPercent).toBe(0)

    model.setProgress({ loaded: 999, total: 100 })
    expect(model.progressPercent).toBe(100)

    model.setProgress({})
    expect(model.progressPercent).toBe(0)
  })

  it('警告与缺失资源去重', () => {
    const model = useModelStore()
    model.beginLoading({ path: 'p', fileName: 'n', formatId: 'obj' })
    model.addWarning('w')
    model.addWarning('w')
    model.addMissingResource('a.mtl')
    model.addMissingResource('a.mtl')
    expect(model.warnings).toEqual(['w'])
    expect(model.missingResources).toEqual(['a.mtl'])
  })
})

describe('modelStore M2 检查数据', () => {
  it('setBounds 只留下纯数字快照（three 对象不进响应式状态）', () => {
    const model = useModelStore()
    const box = new Box3(new Vector3(-1, 0, -2), new Vector3(3, 4, 2))

    model.setBounds({
      box,
      size: box.getSize(new Vector3()),
      center: box.getCenter(new Vector3()),
      min: box.min.clone(),
      max: box.max.clone(),
    })

    expect(model.bounds).toEqual({
      size: { x: 4, y: 4, z: 4 },
      min: { x: -1, y: 0, z: -2 },
      max: { x: 3, y: 4, z: 2 },
      center: { x: 1, y: 2, z: 0 },
    })
    // 关键：快照里不能残留 three 对象（否则会被 Vue 深度代理，也需要额外 API 去防）
    expect(model.bounds.box).toBeUndefined()
    expect(model.bounds.min.getCenter).toBeUndefined()

    model.setBounds(null)
    expect(model.bounds).toBe(null)
  })

  it('层级数据设置与就地补丁（含嵌套节点）', () => {
    const model = useModelStore()
    const nodes = [
      {
        id: 'root',
        label: 'Scene',
        visible: true,
        children: [
          { id: 'a', label: 'A', visible: true, children: [] },
          { id: 'b', label: 'B', visible: false, children: [] },
        ],
      },
    ]
    model.setHierarchy(nodes, { count: 3, truncated: true })
    expect(model.hierarchyCount).toBe(3)
    expect(model.hierarchyTruncated).toBe(true)
    expect(model.hierarchy[0].children).toHaveLength(2)

    expect(model.patchNodeVisibility('a', false)).toBe(true)
    expect(model.hierarchy[0].children[0].visible).toBe(false)
    expect(model.patchNodeVisibility('missing', false)).toBe(false)

    model.setAllVisibility(false)
    expect(model.hierarchy[0].visible).toBe(false)
    expect(model.hierarchy[0].children[1].visible).toBe(false)

    model.applyVisibilityFlags(
      new Map([
        ['root', true],
        ['a', true],
        ['b', false],
      ]),
    )
    expect(model.hierarchy[0].visible).toBe(true)
    expect(model.hierarchy[0].children[0].visible).toBe(true)
    expect(model.hierarchy[0].children[1].visible).toBe(false)

    // 非 Map 参数不应炸
    expect(() => model.applyVisibilityFlags(null)).not.toThrow()
    expect(() => model.applyVisibilityFlags({})).not.toThrow()
  })

  it('setHierarchy 对非法输入给出空数组而不是 undefined', () => {
    const model = useModelStore()
    model.setHierarchy(null)
    expect(model.hierarchy).toEqual([])
  })

  it('reset 会清空层级、包围盒与选中节点', () => {
    const model = useModelStore()
    model.setHierarchy([{ id: 'x', label: 'X', visible: true, children: [] }], { count: 1 })
    model.setSelectedNode('x')
    model.setBounds({ size: { x: 1, y: 1, z: 1 }, min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 }, center: { x: 0.5, y: 0.5, z: 0.5 } })

    model.reset()

    expect(model.hierarchy).toEqual([])
    expect(model.hierarchyCount).toBe(0)
    expect(model.hierarchyTruncated).toBe(false)
    expect(model.bounds).toBe(null)
    expect(model.selectedNodeId).toBe('')
  })
})
