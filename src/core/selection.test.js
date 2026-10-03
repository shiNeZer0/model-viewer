import { describe, expect, it } from 'vitest'

import { resolveNodeClick } from './selection.js'

describe('resolveNodeClick', () => {
  it('点击未选中的节点 → 选中它', () => {
    expect(resolveNodeClick('', 'meshA')).toBe('meshA')
    expect(resolveNodeClick('meshA', 'meshB')).toBe('meshB')
  })

  it('再次点击已选中的节点 → 取消选中（空串）', () => {
    expect(resolveNodeClick('meshA', 'meshA')).toBe('')
  })

  it('没有点中任何节点时清除选中（而不是保留原值）', () => {
    expect(resolveNodeClick('meshA', '')).toBe('')
    expect(resolveNodeClick('meshA', undefined)).toBe('')
    expect(resolveNodeClick('', '')).toBe('')
  })
})
