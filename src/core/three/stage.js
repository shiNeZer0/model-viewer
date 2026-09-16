/**
 * 场景舞台：背景、网格、坐标轴（含 X/Y/Z 标签）。
 *
 * 与引擎分开的原因：这些是「可开关的装饰」，与渲染循环、相机控制无关，
 * 单独成模块后 M2 的边界框标注也能挂进来而不让 ViewerEngine 继续膨胀。
 */

import {
  AxesHelper,
  CanvasTexture,
  Color,
  GridHelper,
  Group,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

export const BACKGROUND_MODES = [
  { id: 'solid', label: '纯色' },
  { id: 'gradient', label: '渐变' },
  { id: 'transparent', label: '透明（棋盘）' },
]

export const DEFAULT_BACKGROUND_MODE = 'solid'
export const DEFAULT_BACKGROUND_COLOR = '#1b1e24'
export const DEFAULT_GRADIENT_TOP = '#2f3540'
export const DEFAULT_GRADIENT_BOTTOM = '#0d0f13'

/** 网格刻度数：固定 10 格，尺寸随模型缩放 */
const GRID_DIVISIONS = 10

export function resolveBackgroundMode(modeId) {
  if (!modeId) return null
  return BACKGROUND_MODES.find((mode) => mode.id === modeId) ?? null
}

/**
 * 把任意尺寸取整到「1/2/5 × 10^n」，网格与坐标轴的尺寸才不会出现 3.7 这种刻度。
 */
export function niceGridSize(extent) {
  if (!Number.isFinite(extent) || extent <= 0) return 10
  const exponent = Math.floor(Math.log10(extent))
  const base = 10 ** exponent
  const normalized = extent / base
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * base
}

/** 程序化竖直渐变背景（无外部资源；纯色 Texture 会被 three 当作全屏背景贴图） */
export function createGradientTexture(topColor, bottomColor, { height = 256 } = {}) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, topColor)
  gradient.addColorStop(1, bottomColor)
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, height)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createAxisLabel(text, color) {
  if (typeof document === 'undefined') return null
  const element = document.createElement('div')
  element.className = 'mv-axis-label'
  element.textContent = text
  element.style.color = color
  element.style.font = '600 11px system-ui, sans-serif'
  element.style.textShadow = '0 0 3px rgba(0,0,0,0.9)'
  element.style.userSelect = 'none'
  return new CSS2DObject(element)
}

export class Stage {
  constructor(scene) {
    this.scene = scene
    this.mode = DEFAULT_BACKGROUND_MODE
    this.backgroundColor = DEFAULT_BACKGROUND_COLOR
    this.gradientTop = DEFAULT_GRADIENT_TOP
    this.gradientBottom = DEFAULT_GRADIENT_BOTTOM
    this.gradientTexture = null

    this.grid = null
    this.gridSize = null
    this.axes = null
    this.labelGroup = new Group()
    this.labelGroup.name = 'mv-axis-labels'
    this.groundY = 0
  }

  setBackground(settings = {}) {
    const next = {
      mode: settings.mode ?? this.mode ?? DEFAULT_BACKGROUND_MODE,
      color: settings.color ?? this.backgroundColor,
      gradientTop: settings.gradientTop ?? this.gradientTop,
      gradientBottom: settings.gradientBottom ?? this.gradientBottom,
    }
    const resolved = resolveBackgroundMode(next.mode) ?? resolveBackgroundMode(DEFAULT_BACKGROUND_MODE)

    this.mode = resolved.id
    this.backgroundColor = next.color
    this.gradientTop = next.gradientTop
    this.gradientBottom = next.gradientBottom

    if (resolved.id === 'transparent') {
      // 真正的透明：渲染器开了 alpha，棋盘由容器 CSS 提供
      this.scene.background = null
      this.disposeGradientTexture()
      return this.mode
    }

    if (resolved.id === 'solid') {
      this.scene.background = new Color(this.backgroundColor)
      this.disposeGradientTexture()
      return this.mode
    }

    // 渐变：颜色未变则复用已有纹理，避免每次滑杆变化都重建 Canvas
    if (
      !this.gradientTexture ||
      this.gradientTopCache !== this.gradientTop ||
      this.gradientBottomCache !== this.gradientBottom
    ) {
      this.disposeGradientTexture()
      this.gradientTexture = createGradientTexture(this.gradientTop, this.gradientBottom)
      this.gradientTopCache = this.gradientTop
      this.gradientBottomCache = this.gradientBottom
    }
    this.scene.background = this.gradientTexture
    return this.mode
  }

  setHelpers({ showGrid = false, showAxes = true } = {}) {
    if (showGrid) this.ensureGrid()
    if (showAxes) this.ensureAxes()
    if (this.grid) this.grid.visible = showGrid
    if (this.axes) this.axes.visible = showAxes
    this.labelGroup.visible = showAxes
  }

  /** 依据模型包围盒调整地面网格与坐标轴的尺度 */
  fitToBox(box) {
    if (!box || box.isEmpty?.()) return
    const size = box.getSize(new Vector3())
    const extent = Math.max(size.x, size.y, size.z) || 1
    const gridSize = niceGridSize(extent * 1.5)
    this.groundY = box.min.y

    if (this.gridSize !== gridSize) {
      this.gridSize = gridSize
      // 网格格数烘焙在几何体里，尺寸变化必须重建
      if (this.grid) {
        this.scene.remove(this.grid)
        this.grid.geometry.dispose()
        this.grid.material.dispose()
        this.grid = null
      }
      this.rebuildAxes(gridSize / 2)
      this.rebuildLabels(gridSize / 2)
    }

    if (this.grid) this.grid.position.y = this.groundY
    if (this.axes) this.axes.position.y = this.groundY
    this.labelGroup.position.y = this.groundY
  }

  ensureGrid() {
    if (this.grid) return this.grid
    const size = this.gridSize ?? 10
    this.grid = new GridHelper(size, GRID_DIVISIONS, 0x5c6472, 0x2c313a)
    this.grid.name = 'mv-grid'
    this.grid.material.transparent = true
    this.grid.material.opacity = 0.9
    this.grid.position.y = this.groundY
    this.scene.add(this.grid)
    return this.grid
  }

  rebuildAxes(length) {
    if (this.axes) {
      this.scene.remove(this.axes)
      this.axes.geometry.dispose()
      this.axes.material.dispose()
      this.axes = null
    }
    // AxesHelper 的长度烘焙在几何体里，尺寸变化需要重建
    this.pendingAxesLength = length
    if (this.axesVisible) this.ensureAxes()
  }

  ensureAxes() {
    this.axesVisible = true
    if (!this.axes) {
      this.axes = new AxesHelper(this.pendingAxesLength ?? (this.gridSize ?? 10) / 2)
      this.axes.name = 'mv-axes'
      this.axes.position.y = this.groundY
      this.scene.add(this.axes)
    }
    return this.axes
  }

  rebuildLabels(length) {
    if (!this.labelGroup.parent) this.scene.add(this.labelGroup)
    for (const child of [...this.labelGroup.children]) {
      this.labelGroup.remove(child)
      child.element?.remove?.()
    }
    const presets = [
      { text: 'X', color: '#ff6b6b', position: [length, 0, 0] },
      { text: 'Y', color: '#7bed9f', position: [0, length, 0] },
      { text: 'Z', color: '#70a1ff', position: [0, 0, length] },
    ]
    for (const preset of presets) {
      const label = createAxisLabel(preset.text, preset.color)
      if (!label) continue
      label.position.set(...preset.position)
      // 让标签跟随地面高度（与坐标轴同高）
      label.center.set(0, 0.5)
      this.labelGroup.add(label)
    }
  }

  disposeGradientTexture() {
    if (this.gradientTexture) {
      this.gradientTexture.dispose()
      this.gradientTexture = null
    }
  }

  dispose() {
    this.disposeGradientTexture()
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.geometry.dispose()
      this.grid.material.dispose()
      this.grid = null
    }
    if (this.axes) {
      this.scene.remove(this.axes)
      this.axes.geometry.dispose()
      this.axes.material.dispose()
      this.axes = null
    }
    for (const child of [...this.labelGroup.children]) {
      this.labelGroup.remove(child)
      child.element?.remove?.()
    }
    this.labelGroup.removeFromParent()
    if (this.scene.background?.isTexture) this.scene.background = null
  }
}
