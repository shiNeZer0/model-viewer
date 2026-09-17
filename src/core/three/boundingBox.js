/**
 * 边界框与尺寸标注（M2）。
 *
 * 分两部分：
 * 1. **纯函数**（`describeDimensions` / `describeCorner`）负责"算什么、怎么显示"，
 *    单位换算复用 units.js，可在 Node 下单测；
 * 2. `BoundingBoxOverlay` 负责"怎么画"——Box3Helper 画线框，CSS2D 标签显示长宽高与角点坐标。
 *    标签依赖 DOM，Node 环境下自动退化为"只画线框"，不会抛错。
 */

import { Box3, Box3Helper, Color, Vector3 } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { formatLength } from './units.js'

export const BOUNDING_BOX_COLOR = 0xffc857

/**
 * 三个轴向的尺寸文案（纯函数）。
 * @returns {Array<{axis: string, name: string, value: number, text: string, unit: string, converted: boolean}>}
 */
export function describeDimensions(box, { sourceUnit, displayUnit } = {}) {
  if (!box || box.isEmpty?.()) return []
  const size = box.getSize(new Vector3())
  return [
    { axis: 'x', name: '长 X', value: size.x },
    { axis: 'y', name: '高 Y', value: size.y },
    { axis: 'z', name: '宽 Z', value: size.z },
  ].map((entry) => ({
    ...entry,
    ...formatLength(entry.value, { sourceUnit, displayUnit }),
  }))
}

/** 最小/最大角点坐标文案（纯函数） */
export function describeCorner(box, { sourceUnit, displayUnit } = {}) {
  if (!box || box.isEmpty?.()) return { min: null, max: null }
  const format = (vector) =>
    ['x', 'y', 'z']
      .map((axis) => formatLength(vector[axis], { sourceUnit, displayUnit }).text)
      .join(', ')

  return {
    min: format(box.min),
    max: format(box.max),
  }
}

/** 三条尺寸标签的摆放位置（对应的边中点），纯计算便于测试 */
export function dimensionLabelPositions(box) {
  if (!box || box.isEmpty?.()) return []
  const { min, max } = box
  return [
    { axis: 'x', position: [(min.x + max.x) / 2, min.y, max.z] },
    { axis: 'y', position: [max.x, (min.y + max.y) / 2, max.z] },
    { axis: 'z', position: [max.x, min.y, (min.z + max.z) / 2] },
  ]
}

function createLabelElement(className) {
  if (typeof document === 'undefined') return null
  const element = document.createElement('div')
  element.className = `mv-bbox-label ${className}`
  element.style.font = '600 11px system-ui, sans-serif'
  element.style.padding = '1px 5px'
  element.style.borderRadius = '3px'
  element.style.background = 'rgba(15, 17, 21, 0.72)'
  element.style.color = '#ffc857'
  element.style.whiteSpace = 'nowrap'
  element.style.userSelect = 'none'
  element.style.pointerEvents = 'none'
  return element
}

export class BoundingBoxOverlay {
  constructor(scene) {
    this.scene = scene
    this.helper = null
    this.labels = []
    this.visible = false
    this.sourceUnit = undefined
    this.displayUnit = undefined
    this.currentBox = null
  }

  setVisible(visible) {
    this.visible = Boolean(visible)
    if (this.helper) this.helper.visible = this.visible
    for (const label of this.labels) label.visible = this.visible
  }

  setUnits({ sourceUnit, displayUnit } = {}) {
    this.sourceUnit = sourceUnit
    this.displayUnit = displayUnit
  }

  /** 用新的包围盒重建线框与标签；box 为空时清空所有显示 */
  update(box) {
    this.clear()
    if (!box || box.isEmpty?.()) return null

    this.currentBox = box.clone()

    if (typeof Box3Helper === 'function') {
      this.helper = new Box3Helper(this.currentBox, new Color(BOUNDING_BOX_COLOR))
      this.helper.name = 'mv-bbox-helper'
      this.helper.visible = this.visible
      // 稍微抬高渲染顺序，避免与模型表面 z-fighting
      this.helper.renderOrder = 2
      this.scene.add(this.helper)
    }

    const unitOptions = { sourceUnit: this.sourceUnit, displayUnit: this.displayUnit }
    const dimensions = describeDimensions(this.currentBox, unitOptions)
    const positions = dimensionLabelPositions(this.currentBox)

    for (const entry of dimensions) {
      const position = positions.find((item) => item.axis === entry.axis)
      const element = createLabelElement(`mv-bbox-label--${entry.axis}`)
      if (!element) continue
      element.textContent = `${entry.name} ${entry.text}`
      const label = new CSS2DObject(element)
      label.position.set(...position.position)
      label.center.set(0.5, 0.5)
      label.visible = this.visible
      label.name = `mv-bbox-label-${entry.axis}`
      this.scene.add(label)
      this.labels.push(label)
    }

    const corner = describeCorner(this.currentBox, unitOptions)
    const cornerElement = createLabelElement('mv-bbox-label--min')
    if (cornerElement && corner.min) {
      cornerElement.textContent = `min ${corner.min}`
      const label = new CSS2DObject(cornerElement)
      label.position.copy(this.currentBox.min)
      label.center.set(0, 1)
      label.visible = this.visible
      label.name = 'mv-bbox-label-min'
      this.scene.add(label)
      this.labels.push(label)
    }

    return this.currentBox
  }

  clear() {
    if (this.helper) {
      this.scene.remove(this.helper)
      this.helper.geometry?.dispose?.()
      this.helper.material?.dispose?.()
      this.helper = null
    }
    for (const label of this.labels) {
      this.scene.remove(label)
      label.element?.remove?.()
    }
    this.labels = []
    this.currentBox = null
  }

  dispose() {
    this.clear()
  }
}
