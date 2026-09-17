import { Box3, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  BoundingBoxOverlay,
  describeCorner,
  describeDimensions,
  dimensionLabelPositions,
} from './boundingBox.js'

const BOX = new Box3(new Vector3(-1, 0, -2), new Vector3(3, 4, 2)) // 尺寸 4 × 4 × 4，最小角 (-1,0,-2)

describe('describeDimensions', () => {
  it('输出三轴尺寸，未声明单位时按原值显示', () => {
    const dimensions = describeDimensions(BOX)
    expect(dimensions.map((entry) => entry.axis)).toEqual(['x', 'y', 'z'])
    expect(dimensions.map((entry) => entry.name)).toEqual(['长 X', '高 Y', '宽 Z'])
    expect(dimensions.every((entry) => entry.value === 4)).toBe(true)
    expect(dimensions[0].converted).toBe(false)
    expect(dimensions[0].text).toContain('原始单位')
  })

  it('声明毫米后按易读单位换算', () => {
    const dimensions = describeDimensions(BOX, { sourceUnit: 'mm', displayUnit: 'auto' })
    // 4 mm = 0.004 m < 0.01 → 自动选 mm
    expect(dimensions[0].unit).toBe('mm')
    expect(dimensions[0].text).toBe('4.00 mm')
  })

  it('空包围盒返回空数组', () => {
    expect(describeDimensions(new Box3())).toEqual([])
    expect(describeDimensions(null)).toEqual([])
  })
})

describe('describeCorner', () => {
  it('给出 min/max 角点坐标文案', () => {
    const corner = describeCorner(BOX)
    expect(corner.min).toContain('-1.000')
    expect(corner.max).toContain('3.000')
    expect(corner.min.split(', ')).toHaveLength(3)
  })

  it('声明单位后坐标也走换算', () => {
    const corner = describeCorner(BOX, { sourceUnit: 'm', displayUnit: 'cm' })
    // 3 m = 300 cm
    expect(corner.max).toContain('300.000 cm')
  })

  it('空包围盒返回 null', () => {
    expect(describeCorner(new Box3())).toEqual({ min: null, max: null })
  })
})

describe('dimensionLabelPositions', () => {
  it('三个标签落在各自边的中点', () => {
    const positions = dimensionLabelPositions(BOX)
    expect(positions).toHaveLength(3)
    expect(positions[0].position).toEqual([1, 0, 2]) // X 边中点
    expect(positions[1].position).toEqual([3, 2, 2]) // Y 边中点
    expect(positions[2].position).toEqual([3, 0, 0]) // Z 边中点
  })

  it('空包围盒返回空数组', () => {
    expect(dimensionLabelPositions(new Box3())).toEqual([])
  })
})

describe('BoundingBoxOverlay', () => {
  it('update 创建线框辅助对象并挂到场景，clear 后不残留', () => {
    const scene = new Scene()
    const overlay = new BoundingBoxOverlay(scene)

    overlay.update(BOX)
    expect(overlay.helper).toBeTruthy()
    expect(scene.children).toContain(overlay.helper)
    expect(overlay.currentBox.equals(BOX)).toBe(true)

    overlay.clear()
    expect(overlay.helper).toBe(null)
    expect(scene.children.some((child) => child.name === 'mv-bbox-helper')).toBe(false)
  })

  it('可见性开关作用于线框（Node 下无 DOM，标签为空但不应抛错）', () => {
    const scene = new Scene()
    const overlay = new BoundingBoxOverlay(scene)
    overlay.update(BOX)

    overlay.setVisible(false)
    expect(overlay.helper.visible).toBe(false)
    overlay.setVisible(true)
    expect(overlay.helper.visible).toBe(true)
    expect(overlay.labels).toEqual([])
    expect(() => overlay.dispose()).not.toThrow()
  })

  it('update 空包围盒等于清空显示', () => {
    const scene = new Scene()
    const overlay = new BoundingBoxOverlay(scene)
    overlay.update(BOX)
    overlay.update(new Box3())
    expect(overlay.helper).toBe(null)
    expect(overlay.currentBox).toBe(null)
  })

  it('换单位后重新 update 会反映到尺寸文案（通过 currentBox 保持正确）', () => {
    const scene = new Scene()
    const overlay = new BoundingBoxOverlay(scene)
    overlay.setUnits({ sourceUnit: 'raw', displayUnit: 'auto' })
    overlay.update(BOX)
    const rawTexts = describeDimensions(overlay.currentBox, {
      sourceUnit: 'raw',
      displayUnit: 'auto',
    })

    overlay.setUnits({ sourceUnit: 'mm', displayUnit: 'auto' })
    overlay.update(overlay.currentBox)
    const convertedTexts = describeDimensions(overlay.currentBox, {
      sourceUnit: 'mm',
      displayUnit: 'auto',
    })

    expect(rawTexts[0].text).not.toBe(convertedTexts[0].text)
    expect(convertedTexts[0].text).toContain('mm')
    overlay.dispose()
  })
})
