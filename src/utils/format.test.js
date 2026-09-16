import { describe, expect, it } from 'vitest'

import { formatBytes, formatCount, formatTimestamp } from './format.js'

describe('formatBytes', () => {
  it('按 1024 进制换算并保留 1 位小数', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5.5 * 1024 * 1024 * 1024)).toBe('5.5 GB')
  })

  it('非法输入返回占位符而不是 NaN', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('formatCount', () => {
  it('千分位与空值兜底', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(undefined)).toBe('0')
  })
})

describe('formatTimestamp', () => {
  it('输出可读的本地时间', () => {
    expect(formatTimestamp(0)).toBe('—')
    expect(formatTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    )
  })

  it('非法输入返回占位符', () => {
    expect(formatTimestamp(undefined)).toBe('—')
    expect(formatTimestamp(-5)).toBe('—')
  })
})
