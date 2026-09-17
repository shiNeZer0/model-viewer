import { describe, expect, it } from 'vitest'

import {
  MAX_RECENT_FILES,
  describeRecentTime,
  normalizeRecentEntry,
  normalizeRecentList,
  toTimestampMs,
  withoutRecentEntry,
} from './recentFiles.js'

describe('toTimestampMs', () => {
  it('数字时间戳原样返回，非法值归一为 0', () => {
    expect(toTimestampMs(1730000000000)).toBe(1730000000000)
    expect(toTimestampMs(0)).toBe(0)
    expect(toTimestampMs(-1)).toBe(0)
    expect(toTimestampMs(Number.NaN)).toBe(0)
    expect(toTimestampMs(null)).toBe(0)
    expect(toTimestampMs(undefined)).toBe(0)
    expect(toTimestampMs({})).toBe(0)
  })

  it('SQLite 的 CURRENT_TIMESTAMP 按 UTC 解析（不能被当成本地时间）', () => {
    // 关键回归点：直接用 Date.parse 会按本地时区解释，东八区整体差 8 小时
    expect(toTimestampMs('2026-09-17 10:24:00')).toBe(Date.UTC(2026, 8, 17, 10, 24, 0))
    expect(toTimestampMs('2026-09-17T10:24:00')).toBe(Date.UTC(2026, 8, 17, 10, 24, 0))
    // 秒可省略
    expect(toTimestampMs('2026-09-17 10:24')).toBe(Date.UTC(2026, 8, 17, 10, 24, 0))
    // 已经带时区标记的 ISO 串交给引擎解析
    expect(toTimestampMs('2026-09-17T10:24:00.000Z')).toBe(Date.UTC(2026, 8, 17, 10, 24, 0))
  })

  it('无法识别的文本返回 0 而不是 NaN', () => {
    expect(toTimestampMs('')).toBe(0)
    expect(toTimestampMs('   ')).toBe(0)
    expect(toTimestampMs('不是时间')).toBe(0)
  })
})

describe('normalizeRecentEntry', () => {
  it('兼容桌面 SQLite 的 snake_case 记录', () => {
    expect(
      normalizeRecentEntry({
        path: 'F:\\models\\车.obj',
        file_name: '车.obj',
        format: 'OBJ',
        size_bytes: 2048,
        last_opened_at: '2026-09-17 10:24:00',
        open_count: 3,
      }),
    ).toEqual({
      path: 'F:\\models\\车.obj',
      fileName: '车.obj',
      formatId: 'obj',
      sizeBytes: 2048,
      lastOpenedAtMs: Date.UTC(2026, 8, 17, 10, 24, 0),
      openCount: 3,
    })
  })

  it('兼容 Web localStorage 的 camelCase 记录', () => {
    const entry = normalizeRecentEntry({
      path: '椅子.obj::2048',
      fileName: '椅子.obj',
      format: 'obj',
      sizeBytes: 2048,
      lastOpenedAt: 1730000000000,
      openCount: 2,
    })
    expect(entry.fileName).toBe('椅子.obj')
    expect(entry.lastOpenedAtMs).toBe(1730000000000)
    expect(entry.openCount).toBe(2)
  })

  it('缺字段时给出安全默认值，缺路径则整条无效', () => {
    const entry = normalizeRecentEntry({ path: 'C:\\a\\b\\model.stl' })
    expect(entry.fileName).toBe('model.stl') // 从路径兜底取文件名
    expect(entry.formatId).toBe('')
    expect(entry.sizeBytes).toBeNull()
    expect(entry.lastOpenedAtMs).toBe(0)
    expect(entry.openCount).toBe(1)

    expect(normalizeRecentEntry({ path: '   ' })).toBeNull()
    expect(normalizeRecentEntry({ file_name: 'x.glb' })).toBeNull()
    expect(normalizeRecentEntry(null)).toBeNull()
    expect(normalizeRecentEntry('nope')).toBeNull()
  })

  it('负数/非法数值被收敛，不产生 NaN 或负尺寸', () => {
    const entry = normalizeRecentEntry({ path: 'x.glb', size_bytes: -5, open_count: 0 })
    expect(entry.sizeBytes).toBeNull()
    expect(entry.openCount).toBe(1)
  })
})

describe('normalizeRecentList', () => {
  it('按时间倒序排列并裁剪到上限', () => {
    const list = normalizeRecentList([
      { path: 'a.glb', lastOpenedAt: 1000 },
      { path: 'b.glb', lastOpenedAt: 3000 },
      { path: 'c.glb', lastOpenedAt: 2000 },
    ])
    expect(list.map((entry) => entry.path)).toEqual(['b.glb', 'c.glb', 'a.glb'])

    const many = Array.from({ length: MAX_RECENT_FILES + 5 }, (_, index) => ({
      path: `m${index}.glb`,
      lastOpenedAt: index + 1,
    }))
    expect(normalizeRecentList(many)).toHaveLength(MAX_RECENT_FILES)
    expect(normalizeRecentList(many, { limit: 2 }).map((entry) => entry.path)).toEqual([
      `m${MAX_RECENT_FILES + 4}.glb`,
      `m${MAX_RECENT_FILES + 3}.glb`,
    ])
  })

  it('同一路径只保留最近一次记录', () => {
    const list = normalizeRecentList([
      { path: 'a.glb', lastOpenedAt: 1000, open_count: 1 },
      { path: 'a.glb', lastOpenedAt: 5000, open_count: 2 },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].lastOpenedAtMs).toBe(5000)
    expect(list[0].openCount).toBe(2)
  })

  it('丢弃无效条目；非数组输入返回空数组', () => {
    const list = normalizeRecentList([{ path: 'a.glb' }, null, { file_name: 'b.glb' }, 'x'])
    expect(list.map((entry) => entry.path)).toEqual(['a.glb'])
    expect(normalizeRecentList(null)).toEqual([])
    expect(normalizeRecentList(undefined)).toEqual([])
  })
})

describe('withoutRecentEntry', () => {
  it('按路径移除单条', () => {
    const entries = [{ path: 'a' }, { path: 'b' }]
    expect(withoutRecentEntry(entries, 'a')).toEqual([{ path: 'b' }])
    expect(withoutRecentEntry(entries, 'missing')).toHaveLength(2)
    expect(withoutRecentEntry(null, 'a')).toEqual([])
  })
})

describe('describeRecentTime', () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0)

  it('按距今时长给出相对文案', () => {
    expect(describeRecentTime(now - 10 * 1000, now)).toBe('刚刚')
    expect(describeRecentTime(now - 5 * 60 * 1000, now)).toBe('5 分钟前')
    expect(describeRecentTime(now - 3 * 60 * 60 * 1000, now)).toBe('3 小时前')
    expect(describeRecentTime(now - 30 * 60 * 60 * 1000, now)).toBe('昨天')
    expect(describeRecentTime(now - 5 * 24 * 60 * 60 * 1000, now)).toBe('5 天前')
  })

  it('超过 30 天显示日期；未来时间不显示负数', () => {
    expect(describeRecentTime(Date.UTC(2026, 0, 2, 3, 4, 5), now)).toBe('2026-01-02')
    expect(describeRecentTime(now + 60 * 1000, now)).toBe('刚刚')
  })

  it('无效时间显示占位符', () => {
    expect(describeRecentTime(0, now)).toBe('—')
    expect(describeRecentTime(Number.NaN, now)).toBe('—')
    expect(describeRecentTime(null, now)).toBe('—')
  })
})
