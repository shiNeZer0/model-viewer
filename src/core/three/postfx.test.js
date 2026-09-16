import { AgXToneMapping, NeutralToneMapping, NoToneMapping } from 'three'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EXPOSURE,
  DEFAULT_SATURATION,
  DEFAULT_TONE_MAPPING,
  EXPOSURE_RANGE,
  SATURATION_RANGE,
  SaturationShader,
  TONE_MAPPINGS,
  clampExposure,
  clampSaturation,
  normalizePostFxSettings,
  resolveToneMapping,
} from './postfx.js'

describe('TONE_MAPPINGS', () => {
  it('id 唯一且能被解析成 three 常量', () => {
    const ids = TONE_MAPPINGS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolveToneMapping('none')).toBe(NoToneMapping)
    expect(resolveToneMapping('agx')).toBe(AgXToneMapping)
    expect(resolveToneMapping('neutral')).toBe(NeutralToneMapping)
  })

  it('未知 id 返回 null（由调用方决定回退值）', () => {
    expect(resolveToneMapping('nope')).toBe(null)
    expect(resolveToneMapping(undefined)).toBe(null)
  })
})

describe('clampExposure / clampSaturation', () => {
  it('夹到合法区间', () => {
    expect(clampExposure(0)).toBe(EXPOSURE_RANGE.min)
    expect(clampExposure(99)).toBe(EXPOSURE_RANGE.max)
    expect(clampSaturation(-1)).toBe(SATURATION_RANGE.min)
    expect(clampSaturation(9)).toBe(SATURATION_RANGE.max)
  })

  it('非法输入回退到默认值', () => {
    expect(clampExposure(Number.NaN)).toBe(DEFAULT_EXPOSURE)
    expect(clampExposure(undefined)).toBe(DEFAULT_EXPOSURE)
    expect(clampSaturation(null)).toBe(DEFAULT_SATURATION)
    expect(clampSaturation('abc')).toBe(DEFAULT_SATURATION)
  })
})

describe('normalizePostFxSettings', () => {
  it('空输入给出默认设置', () => {
    expect(normalizePostFxSettings()).toEqual({
      toneMapping: DEFAULT_TONE_MAPPING,
      exposure: DEFAULT_EXPOSURE,
      saturation: DEFAULT_SATURATION,
      enabled: true,
    })
  })

  it('非法色调映射回退，数值被夹紧，enabled 仅在显式 false 时关闭', () => {
    expect(normalizePostFxSettings({ toneMapping: 'bad' }).toneMapping).toBe(DEFAULT_TONE_MAPPING)
    expect(normalizePostFxSettings({ exposure: 100, saturation: -3 })).toMatchObject({
      exposure: EXPOSURE_RANGE.max,
      saturation: SATURATION_RANGE.min,
    })
    expect(normalizePostFxSettings({ enabled: false }).enabled).toBe(false)
    expect(normalizePostFxSettings({ enabled: 0 }).enabled).toBe(true)
  })
})

describe('SaturationShader', () => {
  it('具备 ShaderPass 需要的 uniforms 与着色器源码', () => {
    expect(Object.keys(SaturationShader.uniforms)).toEqual(['tDiffuse', 'saturation'])
    expect(SaturationShader.vertexShader).toContain('gl_Position')
    expect(SaturationShader.fragmentShader).toContain('tDiffuse')
    expect(SaturationShader.fragmentShader).toContain('saturation')
  })
})
