import {
  DEFAULT_PRESET_ID,
  ENVIRONMENT_SOURCES,
  LIGHTING_PRESETS,
  presetToState,
  resolvePreset,
} from './lightingPresets.js'
import { describe, expect, it } from 'vitest'

import { LIGHT_LIMITS, LIGHT_ROLES } from '../../core/three/lighting.js'

describe('LIGHTING_PRESETS', () => {
  it('包含 5 个内置预设且 id 唯一', () => {
    const ids = LIGHTING_PRESETS.map((preset) => preset.id)
    expect(ids).toEqual(['studio', 'sunset', 'forest', 'panorama', 'none'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolvePreset(DEFAULT_PRESET_ID)).toBeTruthy()
  })

  it('每个预设结构完整：三盏灯按主/补/轮廓排列，且数值都在合法区间', () => {
    for (const preset of LIGHTING_PRESETS) {
      expect(preset.label, preset.id).toBeTruthy()
      expect(preset.description, preset.id).toBeTruthy()

      expect(preset.lights.map((light) => light.role)).toEqual(LIGHT_ROLES.map((role) => role.id))
      for (const light of preset.lights) {
        expect(light.intensity, `${preset.id}/${light.role}`).toBeGreaterThanOrEqual(LIGHT_LIMITS.intensity.min)
        expect(light.intensity).toBeLessThanOrEqual(LIGHT_LIMITS.intensity.max)
        expect(light.elevation).toBeGreaterThanOrEqual(LIGHT_LIMITS.elevation.min)
        expect(light.elevation).toBeLessThanOrEqual(LIGHT_LIMITS.elevation.max)
        expect(light.azimuth).toBeGreaterThanOrEqual(LIGHT_LIMITS.azimuth.min)
        expect(light.azimuth).toBeLessThanOrEqual(LIGHT_LIMITS.azimuth.max)
        expect(light.color).toMatch(/^#[0-9a-f]{6}$/i)
      }

      expect(ENVIRONMENT_SOURCES, preset.id).toContain(preset.environment.source)
      expect(preset.background.mode, preset.id).toBeTruthy()
      expect(preset.render.toneMapping, preset.id).toBeTruthy()
    }
  })

  it('resolvePreset 未命中返回 null', () => {
    expect(resolvePreset('nope')).toBe(null)
    expect(resolvePreset(undefined)).toBe(null)
    expect(resolvePreset('sunset')?.label).toBe('黄昏')
  })

  it('presetToState 深拷贝：改结果不会污染预设常量', () => {
    const preset = resolvePreset('sunset')
    const state = presetToState(preset)

    expect(state.lights).toHaveLength(3)
    expect(state.lights[0]).not.toBe(preset.lights[0])

    state.lights[0].intensity = 99
    state.environment.topColor = '#000000'

    expect(preset.lights[0].intensity).not.toBe(99)
    expect(preset.environment.topColor).not.toBe('#000000')
  })

  it('presetToState 对空输入返回 null', () => {
    expect(presetToState(null)).toBe(null)
  })
})
