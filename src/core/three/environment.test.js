import { describe, expect, it } from 'vitest'

import { builtinEnvironmentUrl } from '../../constants/builtinEnvironments.js'
import {
  GRADIENT_TEXTURE_SIZE,
  EnvironmentManager,
  createGradientEquirectData,
  environmentCacheKey,
  resolveEnvironmentPlan,
  shouldApplyLoadedTexture,
} from './environment.js'

/** 取第 y 行第一列像素的亮度（线性值） */
function rowLuma(result, y) {
  const index = y * result.width * 4
  return result.data[index] + result.data[index + 1] + result.data[index + 2]
}

describe('createGradientEquirectData', () => {
  it('生成 RGBA 浮点数据，尺寸与 alpha 正确', () => {
    const result = createGradientEquirectData({ width: 8, height: 4 })
    expect(result.width).toBe(8)
    expect(result.height).toBe(4)
    expect(result.data).toBeInstanceOf(Float32Array)
    expect(result.data.length).toBe(8 * 4 * 4)
    // alpha 必须为 1，否则环境贴图会出现透明伪影
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(1)
    }
  })

  it('自上而下由亮到暗（天顶 → 地平线 → 地面）', () => {
    const result = createGradientEquirectData({
      topColor: '#ffffff',
      horizonColor: '#808080',
      bottomColor: '#000000',
      width: 4,
      height: 9,
    })
    const top = rowLuma(result, 0)
    const middle = rowLuma(result, 4)
    const bottom = rowLuma(result, 8)
    expect(top).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(bottom)
  })

  it('同一行内所有像素一致（只有竖直渐变）', () => {
    const result = createGradientEquirectData({ width: 6, height: 3 })
    for (let y = 0; y < result.height; y += 1) {
      const first = rowLuma(result, y)
      for (let x = 1; x < result.width; x += 1) {
        const index = (y * result.width + x) * 4
        expect(result.data[index] + result.data[index + 1] + result.data[index + 2]).toBeCloseTo(first, 5)
      }
    }
  })

  it('非法尺寸与非法颜色不抛错（回退到默认）', () => {
    const result = createGradientEquirectData({ width: 0, height: Number.NaN })
    expect(result.width).toBe(GRADIENT_TEXTURE_SIZE.width)
    expect(result.height).toBe(GRADIENT_TEXTURE_SIZE.height)

    const bad = createGradientEquirectData({ topColor: 'not-a-color', width: 2, height: 2 })
    expect(bad.data.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('高度为 1 时不产生 NaN', () => {
    const result = createGradientEquirectData({ height: 1, width: 2 })
    expect(result.data.every((value) => Number.isFinite(value))).toBe(true)
  })
})

describe('environmentCacheKey', () => {
  it('颜色或来源变化会换 key（用于避免重复生成 PMREM）', () => {
    const base = { source: 'gradient', topColor: '#fff', horizonColor: '#888', bottomColor: '#000' }
    expect(environmentCacheKey(base)).toBe(environmentCacheKey({ ...base }))
    expect(environmentCacheKey(base)).not.toBe(environmentCacheKey({ ...base, topColor: '#eee' }))
    expect(environmentCacheKey(base)).not.toBe(environmentCacheKey({ ...base, source: 'room' }))
  })
})

describe('resolveEnvironmentPlan（环境贴图来源的选择逻辑）', () => {
  it('三种程序化来源直接透传', () => {
    expect(resolveEnvironmentPlan({ source: 'gradient' }).kind).toBe('gradient')
    expect(resolveEnvironmentPlan({ source: 'room' }).kind).toBe('room')
    expect(resolveEnvironmentPlan({ source: 'none' }).kind).toBe('none')
    // 非法来源退回渐变（与 normalizeLightingState 的兜底一致）
    expect(resolveEnvironmentPlan({ source: 'weird' }).kind).toBe('gradient')
  })

  it('导入的贴图已登记时用 imported，缓存键跟 URL 走', () => {
    const environment = { source: 'imported', customHdrUrl: 'asset://localhost/env/studio.hdr' }
    const plan = resolveEnvironmentPlan(environment, { hasTexture: () => true })
    expect(plan.kind).toBe('imported')
    // 键前缀是 texture：内置与导入共用同一条"从已登记纹理做 PMREM"的路径
    expect(plan.cacheKey).toBe('texture|asset://localhost/env/studio.hdr')
    expect(plan.fellBack).toBe(false)

    // 换一张贴图必须换 key（否则会复用上一张的 PMREM）
    const other = resolveEnvironmentPlan(
      { ...environment, customHdrUrl: 'asset://localhost/env/other.hdr' },
      { hasTexture: () => true },
    )
    expect(other.cacheKey).not.toBe(plan.cacheKey)
  })

  it('贴图还没加载好 / 没有地址时退化为渐变并标记 fellBack（画面不会变黑）', () => {
    const notReady = resolveEnvironmentPlan(
      { source: 'imported', customHdrUrl: 'asset://localhost/env/studio.hdr' },
      { hasTexture: () => false },
    )
    expect(notReady.kind).toBe('gradient')
    expect(notReady.fellBack).toBe(true)

    const noUrl = resolveEnvironmentPlan({ source: 'imported' }, { hasTexture: () => true })
    expect(noUrl.kind).toBe('gradient')
    expect(noUrl.fellBack).toBe(true)
  })

  it('内置全景图走与导入完全相同的一条路径（kind 复用 imported）', () => {
    const environment = { source: 'builtin', builtinId: 'stone-forest' }
    const plan = resolveEnvironmentPlan(environment, { hasTexture: () => true })

    expect(plan.kind).toBe('imported')
    expect(plan.fellBack).toBe(false)
    expect(plan.cacheKey).toMatch(/^texture\|.*\/hdr\/stone-forest\.hdr$/)

    // 换一张内置图必须换 key，否则会复用上一张的 PMREM
    const other = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'mountain' },
      { hasTexture: () => true },
    )
    expect(other.cacheKey).not.toBe(plan.cacheKey)
  })

  it('内置贴图尚未加载完 / id 已失效时同样退化为渐变', () => {
    const notReady = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'mountain' },
      { hasTexture: () => false },
    )
    expect(notReady.kind).toBe('gradient')
    expect(notReady.fellBack).toBe(true)

    // 设置里残留了已下线的 id：推导不出 URL，必须退化而不是黑屏
    const badId = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'removed-scene' },
      { hasTexture: () => true },
    )
    expect(badId.kind).toBe('gradient')
    expect(badId.fellBack).toBe(true)
  })

  it('拿「推导出的 URL」去查登记状态（曾经只看 customHdrUrl，导致内置切换永远无效）', () => {
    const queried = []
    const plan = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'mountain' },
      {
        hasTexture: (url) => {
          queried.push(url)
          return true
        },
      },
    )

    // 关键：查询用的必须是推导出的内置 URL，而不是内置来源根本不存在的 customHdrUrl
    expect(queried).toHaveLength(1)
    expect(queried[0]).toMatch(/\/hdr\/mountain\.hdr$/)
    expect(plan.kind).toBe('imported')
  })

  it('推不出 URL 时不去查登记状态（避免拿 null 去查询）', () => {
    let called = false
    const plan = resolveEnvironmentPlan(
      { source: 'imported' },
      {
        hasTexture: () => {
          called = true
          return true
        },
      },
    )

    expect(called).toBe(false)
    expect(plan.kind).toBe('gradient')
    expect(plan.fellBack).toBe(true)
  })

  it('需要贴图时 plan 会带上 textureUrl（调用方据此取纹理，不必重新解析）', () => {
    const imported = resolveEnvironmentPlan(
      { source: 'imported', customHdrUrl: 'asset://localhost/env/studio.hdr' },
      { hasTexture: () => true },
    )
    expect(imported.textureUrl).toBe('asset://localhost/env/studio.hdr')

    /*
     * 内置这条是关键：曾经 apply 用 environment.customHdrUrl 去取纹理，
     * 而内置来源根本没有这个字段 → generateFromImported(null) → scene.environment = null，
     * 表现为"切了内置毫无变化"。plan 带上 URL 之后，调用方就没有重新解析的机会了。
     */
    const builtin = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'stone-forest' },
      { hasTexture: () => true },
    )
    expect(builtin.textureUrl).toMatch(/\/hdr\/stone-forest\.hdr$/)
  })

  it('退化为渐变时不带 textureUrl（调用方据此不会去取一张不存在的纹理）', () => {
    const fallenBack = resolveEnvironmentPlan(
      { source: 'builtin', builtinId: 'mountain' },
      { hasTexture: () => false },
    )
    expect(fallenBack.kind).toBe('gradient')
    expect(fallenBack.textureUrl).toBeUndefined()

    const procedural = resolveEnvironmentPlan({ source: 'room' })
    expect(procedural.textureUrl).toBeUndefined()
  })
})

describe('shouldApplyLoadedTexture（异步加载的过期判定）', () => {
  it('加载完的正是当前选中的那张 → 应用', () => {
    expect(
      shouldApplyLoadedTexture({ source: 'builtin', builtinId: 'mountain' }, builtinEnvironmentUrl('mountain')),
    ).toBe(true)
  })

  it('加载完的是已被切走的那张 → 不应用（否则晚到的旧请求会覆盖最新选择）', () => {
    // 用户已经切到 mountain，但先发起的 stone-forest 请求这时才完成
    expect(
      shouldApplyLoadedTexture(
        { source: 'builtin', builtinId: 'mountain' },
        builtinEnvironmentUrl('stone-forest'),
      ),
    ).toBe(false)
  })

  it('用户已切到非贴图来源 → 不应用', () => {
    expect(shouldApplyLoadedTexture({ source: 'gradient' }, builtinEnvironmentUrl('mountain'))).toBe(
      false,
    )
    expect(shouldApplyLoadedTexture({ source: 'none' }, 'anything')).toBe(false)
  })

  it('没有 URL / 没有当前环境时一律不应用（防御性）', () => {
    expect(shouldApplyLoadedTexture({ source: 'builtin', builtinId: 'mountain' }, null)).toBe(false)
    expect(shouldApplyLoadedTexture(undefined, builtinEnvironmentUrl('mountain'))).toBe(false)
  })
})

describe('EnvironmentManager', () => {
  it('缺少渲染器或场景时立即报错（fail fast）', () => {
    expect(() => new EnvironmentManager(null, {})).toThrow()
    expect(() => new EnvironmentManager({}, null)).toThrow()
  })
})
