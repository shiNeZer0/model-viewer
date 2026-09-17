import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SCREENSHOT_SCALE,
  MAX_EXPORT_EDGE,
  buildScreenshotFileName,
  clampScale,
  dataUrlMimeType,
  resolveExportRatio,
  stripDataUrlPrefix,
} from './screenshot.js'

describe('clampScale', () => {
  it('限制在 1~3，非法值退回默认', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(3)).toBe(3)
    expect(clampScale(0.5)).toBe(1)
    expect(clampScale(99)).toBe(3)
    expect(clampScale(Number.NaN)).toBe(DEFAULT_SCREENSHOT_SCALE)
    expect(clampScale(undefined)).toBe(DEFAULT_SCREENSHOT_SCALE)
    expect(clampScale('2')).toBe(DEFAULT_SCREENSHOT_SCALE)
  })
})

describe('resolveExportRatio', () => {
  it('等于 当前像素比 × 倍数', () => {
    expect(resolveExportRatio({ baseRatio: 1, scale: 2, width: 1280, height: 800 })).toBe(2)
    expect(resolveExportRatio({ baseRatio: 2, scale: 3, width: 1280, height: 800 })).toBe(6)
  })

  it('尺寸未知时不做上限裁剪', () => {
    expect(resolveExportRatio({ baseRatio: 2, scale: 3 })).toBe(6)
  })

  it('单边超过 MAX_EXPORT_EDGE 时被压到上限', () => {
    // 4K 长边 3840，3× 会到 11520 > 8192
    const ratio = resolveExportRatio({ baseRatio: 1, scale: 3, width: 3840, height: 2160 })
    expect(3840 * ratio).toBeLessThanOrEqual(MAX_EXPORT_EDGE)
    expect(3840 * ratio).toBeCloseTo(MAX_EXPORT_EDGE, 5)
  })

  it('上限裁剪不会低于当前显示像素比（否则截图比看到的还糊）', () => {
    const ratio = resolveExportRatio({ baseRatio: 3, scale: 3, width: 8000, height: 6000 })
    expect(ratio).toBe(3)
  })

  it('非法 baseRatio 按 1 处理', () => {
    expect(resolveExportRatio({ baseRatio: 0, scale: 2, width: 100, height: 100 })).toBe(2)
    expect(resolveExportRatio({ baseRatio: Number.NaN, scale: 1, width: 100, height: 100 })).toBe(1)
  })
})

describe('buildScreenshotFileName', () => {
  const now = new Date(2026, 8, 17, 11, 5, 30).getTime() // 本地时间 2026-09-17 11:05:30

  it('用模型名 + 本地时间戳，去掉原扩展名', () => {
    expect(buildScreenshotFileName({ fileName: 'cube.obj', scale: 1, now })).toBe(
      'cube-20260917-110530.png',
    )
    expect(buildScreenshotFileName({ fileName: '机器人.glb', scale: 2, now })).toBe(
      '机器人-20260917-110530@2x.png',
    )
  })

  it('1× 不加倍率后缀；倍数会被收敛', () => {
    expect(buildScreenshotFileName({ fileName: 'a.stl', scale: 3, now })).toBe(
      'a-20260917-110530@3x.png',
    )
    expect(buildScreenshotFileName({ fileName: 'a.stl', scale: 9, now })).toBe(
      'a-20260917-110530@3x.png',
    )
  })

  it('非法文件名字符被替换；没有模型名时用默认名', () => {
    expect(buildScreenshotFileName({ fileName: 'a:b*c?.glb', scale: 1, now })).toBe(
      'a_b_c_-20260917-110530.png',
    )
    expect(buildScreenshotFileName({ fileName: '', scale: 1, now })).toBe(
      'model-viewer-20260917-110530.png',
    )
    expect(buildScreenshotFileName({ fileName: '   ', scale: 1, now })).toBe(
      'model-viewer-20260917-110530.png',
    )
  })

  it('目录名里的点不会被当成扩展名（只按最后一段文件名处理）', () => {
    // 前端传进来的通常是纯文件名，这里保证即使带路径也不会把目录切坏
    expect(buildScreenshotFileName({ fileName: 'my.model/cube.obj', scale: 1, now })).toBe(
      'cube-20260917-110530.png',
    )
  })

  it('时间戳非法时用当前时间兜底（不产生 NaN 文件名）', () => {
    const name = buildScreenshotFileName({ fileName: 'a.glb', scale: 1, now: Number.NaN })
    expect(name).toMatch(/^a-\d{8}-\d{6}\.png$/)
  })
})

describe('stripDataUrlPrefix', () => {
  it('取出 base64 载荷', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
    // 换行/空白来自某些环境的 toDataURL，不能带进 base64 串
    expect(stripDataUrlPrefix('data:image/png;base64,iVBO\n Rw0K')).toBe('iVBORw0K')
    // 已经是纯 base64
    expect(stripDataUrlPrefix(' iVBORw0KGgo= ')).toBe('iVBORw0KGgo=')
  })

  it('非 base64 的 data URL 返回空串（宁可明确失败也不要写坏文件）', () => {
    expect(stripDataUrlPrefix('data:image/svg+xml,%3Csvg%3E')).toBe('')
  })

  it('空值安全返回', () => {
    expect(stripDataUrlPrefix('')).toBe('')
    expect(stripDataUrlPrefix(null)).toBe('')
    expect(stripDataUrlPrefix(undefined)).toBe('')
    expect(stripDataUrlPrefix(123)).toBe('')
  })
})

describe('dataUrlMimeType', () => {
  it('识别 MIME；非 data URL 返回空串', () => {
    expect(dataUrlMimeType('data:image/png;base64,AAAA')).toBe('image/png')
    expect(dataUrlMimeType('data:image/jpeg;base64,AAAA')).toBe('image/jpeg')
    expect(dataUrlMimeType('iVBORw0KGgo=')).toBe('')
    expect(dataUrlMimeType('data:image/png')).toBe('')
    expect(dataUrlMimeType(null)).toBe('')
  })
})
