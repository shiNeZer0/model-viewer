import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DISPLAY_UNIT,
  DEFAULT_SOURCE_UNIT,
  DISPLAY_UNIT_IDS,
  LENGTH_UNITS,
  autoPickUnit,
  convertLength,
  formatLength,
  fromMeters,
  resolveUnit,
  toMeters,
} from './units.js'

describe('LENGTH_UNITS', () => {
  it('id 唯一且换算系数正确', () => {
    const ids = LENGTH_UNITS.map((unit) => unit.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolveUnit('mm').toMeters).toBe(0.001)
    expect(resolveUnit('cm').toMeters).toBe(0.01)
    expect(resolveUnit('m').toMeters).toBe(1)
    expect(resolveUnit('in').toMeters).toBeCloseTo(0.0254, 10)
    expect(resolveUnit('nope')).toBe(null)
    expect(resolveUnit(undefined)).toBe(null)
  })

  it('显示单位包含 auto', () => {
    expect(DISPLAY_UNIT_IDS[0]).toBe('auto')
  })
})

describe('toMeters / fromMeters', () => {
  it('往返换算一致', () => {
    expect(toMeters(1000, 'mm')).toBeCloseTo(1, 10)
    expect(fromMeters(1, 'mm')).toBeCloseTo(1000, 6)
    expect(fromMeters(toMeters(37, 'in'), 'in')).toBeCloseTo(37, 6)
  })

  it('非法输入返回 null 而不是 NaN', () => {
    expect(toMeters(Number.NaN, 'mm')).toBe(null)
    expect(toMeters(1, 'nope')).toBe(null)
    expect(fromMeters(undefined, 'mm')).toBe(null)
    expect(convertLength('abc')).toBe(null)
  })
})

describe('autoPickUnit', () => {
  it('按量级挑选易读单位', () => {
    expect(autoPickUnit(0)).toBe('mm')
    expect(autoPickUnit(0.005)).toBe('mm')
    expect(autoPickUnit(0.05)).toBe('cm')
    expect(autoPickUnit(0.5)).toBe('cm')
    expect(autoPickUnit(2)).toBe('m')
    expect(autoPickUnit(1500)).toBe('m')
    expect(autoPickUnit(Number.NaN)).toBe('mm')
  })
})

describe('convertLength', () => {
  it('在声明单位与显示单位间换算', () => {
    // 声明模型单位是毫米，显示成米
    expect(convertLength(1234.5, { from: 'mm', to: 'm' })).toBeCloseTo(1.2345, 6)
    // 英寸 → 毫米
    expect(convertLength(2, { from: 'in', to: 'mm' })).toBeCloseTo(50.8, 6)
  })

  it('to=auto 时自动挑单位', () => {
    // 0.5 m = 50 cm
    expect(convertLength(500, { from: 'mm', to: 'auto' })).toBeCloseTo(50, 6)
  })
})

describe('formatLength', () => {
  it('默认（原始单位）原样显示，不做换算', () => {
    const result = formatLength(1234.5678)
    expect(result.converted).toBe(false)
    expect(result.text).toContain('1234.568')
    expect(result.text).toContain('原始单位')
    expect(DEFAULT_SOURCE_UNIT).toBe('raw')
    expect(DEFAULT_DISPLAY_UNIT).toBe('auto')
  })

  it('声明毫米后自动换算成易读单位', () => {
    const result = formatLength(1234.5, { sourceUnit: 'mm', displayUnit: 'auto' })
    expect(result.converted).toBe(true)
    // 1.2345 m ≥ 1 → 自动选 m
    expect(result.unit).toBe('m')
    expect(result.text).toBe('1.2345 m')
  })

  it('指定显示单位时严格使用它', () => {
    const result = formatLength(1000, { sourceUnit: 'mm', displayUnit: 'cm' })
    expect(result.unit).toBe('cm')
    expect(result.text).toBe('100.000 cm')
  })

  it('极小尺寸不退化成 0.00（改用科学计数）', () => {
    const result = formatLength(0.00002, { sourceUnit: 'm', displayUnit: 'm' })
    expect(result.text).not.toBe('0.0000 m')
    expect(result.text).toContain('e-5')
  })

  it('非法输入返回占位符', () => {
    expect(formatLength(Number.NaN).text).toBe('—')
    expect(formatLength(undefined).text).toBe('—')
  })

  it('声明了未知单位时退回"原值显示"，不产生 NaN 文本', () => {
    const result = formatLength(10, { sourceUnit: 'lightyear', displayUnit: 'auto' })
    expect(result.converted).toBe(false)
    expect(result.text).not.toContain('NaN')
  })
})
