import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 这些用例锁住的是"最近文件"这条链上最容易坏的几处：
 * - 两端后端字段名不同（snake_case / camelCase）→ 归一化必须都认；
 * - 记录失败不能把查看模型的主流程带崩（失败要保留旧列表并记录错误）；
 * - 删除/清空是乐观更新，落库失败必须回滚，否则界面与库里状态不一致。
 */

const storage = vi.hoisted(() => ({
  listRecentFiles: vi.fn(),
  removeRecentFile: vi.fn(),
  clearRecentFiles: vi.fn(),
}))

vi.mock('../platform/storage/index.js', () => storage)

import { useRecentStore } from './recentStore.js'

beforeEach(() => {
  setActivePinia(createPinia())
  storage.listRecentFiles.mockReset()
  storage.removeRecentFile.mockReset()
  storage.clearRecentFiles.mockReset()
  storage.listRecentFiles.mockResolvedValue([])
  storage.removeRecentFile.mockResolvedValue(undefined)
  storage.clearRecentFiles.mockResolvedValue(undefined)
})

describe('recentStore 加载', () => {
  it('把两端后端的记录都归一化，并按时间倒序', async () => {
    const newer = Date.UTC(2026, 8, 17, 12, 0, 0)
    storage.listRecentFiles.mockResolvedValue([
      { path: 'F:\\a\\旧.obj', file_name: '旧.obj', format: 'OBJ', size_bytes: 10, last_opened_at: '2026-09-17 08:00:00' },
      { path: '车.glb::2048', fileName: '车.glb', format: 'glb', sizeBytes: 2048, lastOpenedAt: newer },
    ])

    const recent = useRecentStore()
    await recent.load()

    expect(storage.listRecentFiles).toHaveBeenCalledWith(recent.MAX_RECENT_FILES)
    expect(recent.loaded).toBe(true)
    expect(recent.entries.map((entry) => entry.fileName)).toEqual(['车.glb', '旧.obj'])
    expect(recent.entries[0].lastOpenedAtMs).toBe(newer)
    expect(recent.entries[1].lastOpenedAtMs).toBe(Date.UTC(2026, 8, 17, 8, 0, 0))
  })

  it('读取失败时保留旧列表，只记录错误（不影响查看模型）', async () => {
    storage.listRecentFiles.mockResolvedValueOnce([{ path: 'a.glb', lastOpenedAt: 1 }])
    const recent = useRecentStore()
    await recent.load()
    expect(recent.entries).toHaveLength(1)

    storage.listRecentFiles.mockRejectedValueOnce(new Error('IO_ERROR: 磁盘忙'))
    await recent.load()

    expect(recent.entries).toHaveLength(1)
    expect(recent.loadError).toContain('读取文件失败')
  })

  it('refresh 在未加载过时不查库，加载过才刷新', async () => {
    const recent = useRecentStore()
    await recent.refresh()
    expect(storage.listRecentFiles).not.toHaveBeenCalled()

    await recent.load()
    storage.listRecentFiles.mockResolvedValueOnce([{ path: 'b.glb', lastOpenedAt: 2 }])
    await recent.refresh()
    expect(recent.entries.map((entry) => entry.path)).toEqual(['b.glb'])
  })

  it('Web 运行时（Node 测试环境）不允许按路径重开', () => {
    expect(useRecentStore().canReopen).toBe(false)
  })
})

describe('recentStore 删除', () => {
  async function seededStore() {
    storage.listRecentFiles.mockResolvedValue([
      { path: 'a.glb', lastOpenedAt: 2 },
      { path: 'b.glb', lastOpenedAt: 1 },
    ])
    const recent = useRecentStore()
    await recent.load()
    return recent
  }

  it('移除单条：界面立即更新并落库', async () => {
    const recent = await seededStore()
    await recent.remove('a.glb')
    expect(recent.entries.map((entry) => entry.path)).toEqual(['b.glb'])
    expect(storage.removeRecentFile).toHaveBeenCalledWith('a.glb')
  })

  it('移除失败回滚，避免界面与库不一致', async () => {
    const recent = await seededStore()
    storage.removeRecentFile.mockRejectedValueOnce(new Error('boom'))
    await recent.remove('a.glb')
    expect(recent.entries.map((entry) => entry.path)).toEqual(['a.glb', 'b.glb'])
    expect(recent.loadError).toBe('boom')
  })

  it('清空：界面立即清空并落库；失败回滚', async () => {
    const recent = await seededStore()
    await recent.clear()
    expect(recent.entries).toEqual([])
    expect(storage.clearRecentFiles).toHaveBeenCalledTimes(1)

    const second = await seededStore()
    storage.clearRecentFiles.mockRejectedValueOnce(new Error('boom'))
    await second.clear()
    expect(second.entries).toHaveLength(2)
    expect(second.loadError).toBe('boom')
  })
})
