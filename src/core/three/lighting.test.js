import { Scene } from 'three'
import { describe, expect, it } from 'vitest'

import {
  LIGHT_LIMITS,
  LIGHT_ROLES,
  SCHEMA_VERSION,
  LightingRig,
  computeLightPosition,
  createDefaultLightingState,
  createThemePayload,
  describeLightPositions,
  normalizeColor,
  normalizeLight,
  normalizeLightingState,
  parseThemePayload,
} from './lighting.js'

describe('computeLightPosition', () => {
  it('方位角 0°/仰角 0° 落在 +Z 轴上', () => {
    const [x, y, z] = computeLightPosition({ azimuth: 0, elevation: 0, radius: 10 })
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(10, 6)
  })

  it('方位角 90° 落在 +X 轴上', () => {
    const [x, , z] = computeLightPosition({ azimuth: 90, elevation: 0, radius: 10 })
    expect(x).toBeCloseTo(10, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('仰角 90° 在正上方，负仰角在下方', () => {
    const [topX, topY, topZ] = computeLightPosition({ azimuth: 0, elevation: 90, radius: 5 })
    expect(topY).toBeCloseTo(5, 6)
    expect(Math.hypot(topX, topZ)).toBeLessThan(1e-6)

    const [, belowY] = computeLightPosition({ azimuth: 0, elevation: -45, radius: 5 })
    expect(belowY).toBeLessThan(0)
  })

  it('到原点的距离恒等于半径', () => {
    for (const config of [
      { azimuth: 35, elevation: 40, radius: 10 },
      { azimuth: -120, elevation: 12, radius: 3 },
      { azimuth: 175, elevation: -60, radius: 40 },
    ]) {
      const position = computeLightPosition(config)
      expect(Math.hypot(...position)).toBeCloseTo(config.radius, 6)
    }
  })

  it('越界与非数值输入被收敛，不产生 NaN', () => {
    const clamped = computeLightPosition({ azimuth: 9999, elevation: -400, radius: -5 })
    expect(clamped.every((value) => Number.isFinite(value))).toBe(true)

    const fallback = computeLightPosition({ azimuth: Number.NaN, elevation: undefined, radius: 'x' })
    expect(fallback.every((value) => Number.isFinite(value))).toBe(true)
    expect(Math.hypot(...fallback)).toBeCloseTo(10, 6)
  })
})

describe('normalizeColor / normalizeLight', () => {
  it('非法颜色回退', () => {
    expect(normalizeColor('#ff8800')).toBe('#ff8800')
    expect(normalizeColor('red')).toBe('#ffffff')
    expect(normalizeColor(undefined, '#123456')).toBe('#123456')
  })

  it('光源字段被补全与夹取', () => {
    const light = normalizeLight({ intensity: 999, elevation: 400, color: 'bad' }, 'key')
    expect(light.role).toBe('key')
    expect(light.intensity).toBe(LIGHT_LIMITS.intensity.max)
    expect(light.elevation).toBe(LIGHT_LIMITS.elevation.max)
    expect(light.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(light.enabled).toBe(true)
  })
})

describe('normalizeLightingState', () => {
  it('固定补齐 key/fill/rim 三盏灯', () => {
    const state = normalizeLightingState({ lights: [{ role: 'rim', intensity: 3 }] })
    expect(state.lights.map((light) => light.role)).toEqual(LIGHT_ROLES.map((role) => role.id))
    expect(state.lights.find((light) => light.role === 'rim').intensity).toBe(3)
    // 未提供的灯沿用该角色在内置预设里的取值
    expect(state.lights.find((light) => light.role === 'key').intensity).toBeGreaterThan(0)
  })

  it('环境 source 非法时回退为 gradient，强度被夹取', () => {
    const state = normalizeLightingState({ environment: { source: 'space', intensity: 99 } })
    expect(state.environment.source).toBe('gradient')
    expect(state.environment.intensity).toBe(LIGHT_LIMITS.environmentIntensity.max)
  })

  it('默认状态等于影棚预设', () => {
    const state = createDefaultLightingState()
    expect(state.presetId).toBe('studio')
    expect(state.environment.source).toBe('room')
    expect(state.lights).toHaveLength(3)
  })

  it('保留未知的 presetId（用户自定义主题用）', () => {
    expect(normalizeLightingState({ presetId: 'custom-1' }).presetId).toBe('custom-1')
  })
})

describe('主题载荷', () => {
  it('createThemePayload 规范化光照并带上背景与渲染设置', () => {
    const payload = createThemePayload({
      lighting: { presetId: 'x', lights: [{ role: 'key', intensity: 5 }] },
      background: { mode: 'gradient', gradientTop: '#111111' },
      render: { exposure: 1.2 },
    })
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION)
    expect(payload.lighting.lights).toHaveLength(3)
    expect(payload.background.mode).toBe('gradient')
    expect(payload.render.exposure).toBe(1.2)
  })

  it('parseThemePayload 支持 JSON 字符串与对象', () => {
    const payload = createThemePayload({ lighting: { presetId: 'p1' } })
    const fromString = parseThemePayload(JSON.stringify(payload))
    const fromObject = parseThemePayload(payload)
    expect(fromString.ok).toBe(true)
    expect(fromObject.ok).toBe(true)
    expect(fromString.payload.lighting.presetId).toBe('p1')
  })

  it('拒绝垃圾数据并给出原因（不抛错）', () => {
    expect(parseThemePayload('{not json').ok).toBe(false)
    expect(parseThemePayload('{not json').error).toContain('JSON')
    expect(parseThemePayload(null).ok).toBe(false)
    expect(parseThemePayload([1, 2, 3]).ok).toBe(false)
    expect(parseThemePayload(42).ok).toBe(false)
  })

  it('拒绝来自更高版本的主题', () => {
    const result = parseThemePayload({ schemaVersion: SCHEMA_VERSION + 1, lighting: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('更高版本')
  })

  it('兼容没有 schemaVersion 的历史数据', () => {
    const result = parseThemePayload({ lights: [{ role: 'key', intensity: 2 }] })
    expect(result.ok).toBe(true)
    expect(result.payload.lighting.lights).toHaveLength(3)
  })
})

describe('LightingRig', () => {
  it('按状态摆好三盏平行光与半球光', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)

    const state = normalizeLightingState({
      presetId: 'none',
      ambient: { enabled: true, intensity: 0.5, skyColor: '#ff0000', groundColor: '#0000ff' },
      lights: [
        { role: 'key', enabled: true, intensity: 2, color: '#ffffff', azimuth: 90, elevation: 0, radius: 4 },
        { role: 'fill', enabled: false, intensity: 1, azimuth: 0, elevation: 0, radius: 4 },
        { role: 'rim', enabled: true, intensity: 3, azimuth: 0, elevation: 90, radius: 6 },
      ],
    })
    rig.apply(state)

    const key = rig.lights.get('key')
    expect(key.visible).toBe(true)
    expect(key.intensity).toBe(2)
    expect(key.position.x).toBeCloseTo(4, 5)
    expect(scene.children).toContain(key)

    const fill = rig.lights.get('fill')
    expect(fill.visible).toBe(false)

    const rim = rig.lights.get('rim')
    expect(rim.position.y).toBeCloseTo(6, 5)

    expect(rig.hemisphere.intensity).toBe(0.5)
    expect(rig.hemisphere.visible).toBe(true)
    expect(rig.enabledCount).toBe(2)

    rig.dispose()
    expect(scene.children).toHaveLength(0)
  })

  it('dispose 后场景里不残留光源', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)
    expect(scene.children.length).toBeGreaterThan(0)
    rig.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

describe('describeLightPositions', () => {
  it('给出三盏灯的世界坐标与颜色', () => {
    const described = describeLightPositions({ presetId: 'none' })
    expect(described).toHaveLength(3)
    expect(described[0].position.length()).toBeCloseTo(10, 5)
    expect(described.every((item) => item.color.isColor)).toBe(true)
  })
})
