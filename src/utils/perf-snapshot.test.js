import { describe, expect, it } from 'vitest'

import { activeChannelLabels, activePassNames, formatPerfSnapshot } from './perf-snapshot.js'

/** 一份典型的成功快照：饱和度被调到 1.4，因此饱和度 pass 应当生效 */
function makeSnapshot(overrides = {}) {
  return {
    at: '2026-01-01T00:00:00.000Z',
    fps: 60,
    renderedFrames: 1234,
    running: true,
    devicePixelRatio: 2,
    maxPixelRatio: 2,
    pixelRatioLimit: 2,
    lowPerformance: false,
    drawingBuffer: { width: 2560, height: 1440 },
    postFx: {
      enabled: true,
      samples: 4,
      toneMapping: 'neutral',
      exposure: 1,
      saturation: 1.4,
      saturationPassSkipped: false,
      passes: [
        { name: 'RenderPass', enabled: true },
        { name: 'ShaderPass', enabled: true },
        { name: 'OutputPass', enabled: true },
      ],
      channels: [
        // 开着但处于恒等（例如描边没有选中对象）—— 不该算作"在出效果"
        { id: 'outline', label: '选中描边', enabled: true, identity: true },
        { id: 'gtao', label: '环境光遮蔽', enabled: true, identity: false },
        { id: 'bloom', label: '泛光', enabled: false, identity: false },
      ],
    },
    render: { triangles: 100352, calls: 1, geometries: 1, textures: 0 },
    lighting: { directional: 3, hemisphere: true },
    idleMs: 5000,
    gpu: 'NVIDIA GeForce RTX 4060',
    webglVersion: 'WebGL2',
    renderError: null,
    ...overrides,
  }
}

describe('activePassNames', () => {
  it('只保留实际生效的 pass', () => {
    expect(
      activePassNames({
        passes: [
          { name: 'RenderPass', enabled: true },
          { name: 'ShaderPass', enabled: false },
          { name: 'OutputPass', enabled: true },
        ],
      }),
    ).toEqual(['RenderPass', 'OutputPass'])
  })

  it('缺少 passes 时返回空数组而不是抛错', () => {
    expect(activePassNames(undefined)).toEqual([])
    expect(activePassNames({})).toEqual([])
    expect(activePassNames({ passes: null })).toEqual([])
  })
})

describe('activeChannelLabels', () => {
  it('只保留"开着且不是恒等"的通道（与 pass 的 enabled 是两回事）', () => {
    expect(
      activeChannelLabels({
        channels: [
          { label: '选中描边', enabled: true, identity: true },
          { label: '环境光遮蔽', enabled: true, identity: false },
          { label: '泛光', enabled: false, identity: false },
        ],
      }),
    ).toEqual(['环境光遮蔽'])
  })

  it('缺少 channels 时返回空数组而不是抛错', () => {
    expect(activeChannelLabels(undefined)).toEqual([])
    expect(activeChannelLabels({})).toEqual([])
    expect(activeChannelLabels({ channels: null })).toEqual([])
  })

  it('没有 label 时退回 id', () => {
    expect(activeChannelLabels({ channels: [{ id: 'gtao', enabled: true, identity: false }] })).toEqual([
      'gtao',
    ])
  })
})

describe('formatPerfSnapshot', () => {
  it('包含所有会影响帧率的关键字段', () => {
    const text = formatPerfSnapshot(makeSnapshot())
    expect(text).toContain('FPS=60')
    expect(text).toContain('绘制缓冲=2560×1440')
    expect(text).toContain('dpr=2')
    expect(text).toContain('像素比上限=2')
    expect(text).toContain('后处理=开')
    expect(text).toContain('MSAA=4')
    expect(text).toContain('三角面=100352')
    expect(text).toContain('平行光=3')
    expect(text).toContain('RTX 4060')
    // 只列真正在出效果的通道：描边这时是恒等、泛光关着，都不该出现
    expect(text).toContain('效果通道=环境光遮蔽')
  })

  it('恒等饱和度 pass 被跳过时如实标注，且不出现在生效 pass 列表里', () => {
    const text = formatPerfSnapshot(
      makeSnapshot({
        postFx: {
          enabled: true,
          samples: 4,
          toneMapping: 'neutral',
          exposure: 1,
          saturation: 1,
          saturationPassSkipped: true,
          passes: [
            { name: 'RenderPass', enabled: true },
            { name: 'ShaderPass', enabled: false },
            { name: 'OutputPass', enabled: true },
          ],
        },
      }),
    )
    expect(text).toContain('恒等饱和度 pass 已跳过=是')
    expect(text).toContain('生效 pass=RenderPass → OutputPass')
    expect(text).not.toContain('RenderPass → ShaderPass')
  })

  it('缺失字段打印占位符而不是 undefined', () => {
    const text = formatPerfSnapshot({ fps: 30 })
    expect(text).not.toContain('undefined')
    expect(text).toContain('FPS=30')
    expect(text).toContain('GPU=—')
    expect(text).toContain('三角面=—')
  })

  it('循环已停时标注空闲', () => {
    expect(formatPerfSnapshot(makeSnapshot({ running: false }))).toContain('循环=已空闲')
  })

  it('低性能模式显示实际生效的像素比上限（与用户设置可能不同）', () => {
    const text = formatPerfSnapshot(
      makeSnapshot({ lowPerformance: true, pixelRatioLimit: 1, maxPixelRatio: 3 }),
    )
    expect(text).toContain('像素比上限=1')
    expect(text).toContain('低性能模式=开')
    // 用户设置值不该冒充生效值
    expect(text).not.toContain('像素比上限=3')
  })

  it('非法输入返回空串', () => {
    expect(formatPerfSnapshot(null)).toBe('')
    expect(formatPerfSnapshot(undefined)).toBe('')
    expect(formatPerfSnapshot('abc')).toBe('')
  })
})
