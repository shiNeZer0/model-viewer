/**
 * 场景舞台：背景、网格、坐标轴（含 X/Y/Z 标签）。
 *
 * 与引擎分开的原因：这些是「可开关的装饰」，与渲染循环、相机控制无关，
 * 单独成模块后 M2 的边界框标注也能挂进来而不让 ViewerEngine 继续膨胀。
 *
 * 关键设计：**把「开关意图」与「几何尺寸」当成两个独立状态**。
 * - 意图（wantGrid / wantAxes）只由 UI 决定；
 * - 尺寸（gridSize / groundY）由模型包围盒决定，模型变化时会重建几何。
 * 重建必须按意图恢复，否则会出现这两类怪现象：
 *   「网格开关是开的，加载模型后网格却消失了」（重建后没补建）
 *   「坐标轴明明关掉了，加载模型后又自己回来」（重建时无视意图）
 */

import {
  AxesHelper,
  CanvasTexture,
  Color,
  GridHelper,
  Group,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  ShadowMaterial,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

export const BACKGROUND_MODES = [
  { id: 'solid', label: '纯色' },
  { id: 'gradient', label: '渐变' },
  { id: 'environment', label: '环境贴图' },
  { id: 'transparent', label: '透明（棋盘）' },
]

export const DEFAULT_BACKGROUND_MODE = 'solid'
export const DEFAULT_BACKGROUND_COLOR = '#1b1e24'
export const DEFAULT_GRADIENT_TOP = '#2f3540'
export const DEFAULT_GRADIENT_BOTTOM = '#0d0f13'

/** 网格刻度数：固定 10 格，尺寸随模型缩放 */
const GRID_DIVISIONS = 10
/** 还没量过模型时的网格尺寸 */
export const DEFAULT_GRID_SIZE = 10

export function resolveBackgroundMode(modeId) {
  if (!modeId) return null
  return BACKGROUND_MODES.find((mode) => mode.id === modeId) ?? null
}

/**
 * 把任意尺寸取整到「1/2/5 × 10^n」，网格与坐标轴的尺寸才不会出现 3.7 这种刻度。
 */
export function niceGridSize(extent) {
  if (!Number.isFinite(extent) || extent <= 0) return DEFAULT_GRID_SIZE
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
    this.gradientTopCache = null
    this.gradientBottomCache = null

    this.grid = null
    this.axes = null
    this.shadowCatcher = null
    this.labelGroup = new Group()
    this.labelGroup.name = 'mv-axis-labels'

    /** 由模型包围盒推导；null 表示还没量过模型 */
    this.gridSize = null
    this.groundY = 0

    /** 开关意图（唯一事实源） */
    this.wantGrid = false
    this.wantAxes = true
    this.wantShadow = false
  }

  /** 当前应使用的网格尺寸（模型未知时用默认值） */
  get effectiveGridSize() {
    return this.gridSize ?? DEFAULT_GRID_SIZE
  }

  /* ------------------------------- 背景 ------------------------------- */

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

    if (resolved.id === 'environment') {
      // 环境贴图作背景（全景预设）：纹理由引擎通过 setEnvironmentBackground 提供
      this.disposeGradientTexture()
      if (this.environmentTexture) {
        this.scene.background = this.environmentTexture
        this.scene.backgroundIntensity = this.environmentIntensity ?? 1
        this.scene.backgroundBlurriness = this.environmentBlurriness ?? 0.25
      } else {
        // 没有环境贴图（例如环境来源为"无环境"）时退化为纯色，避免背景变成 null
        this.scene.background = new Color(this.backgroundColor)
      }
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
    // 拿不到 Canvas 时（极少数环境）回退为纯色，绝不让背景变成 null
    this.scene.background = this.gradientTexture ?? new Color(this.backgroundColor)
    return this.mode
  }

  /**
   * 由引擎提供环境贴图（PMREM 结果）。
   * 它既用于 IBL（scene.environment），也可以在 background=environment 时直接当背景。
   */
  setEnvironmentBackground(texture, { intensity = 1, blurriness = 0.25 } = {}) {
    this.environmentTexture = texture ?? null
    this.environmentIntensity = Number.isFinite(intensity) ? intensity : 1
    this.environmentBlurriness = Number.isFinite(blurriness) ? blurriness : 0.25
    if (this.mode === 'environment') this.setBackground({ mode: 'environment' })
  }

  /* --------------------------- 辅助显示（网格/坐标轴） --------------------------- */

  /** 记录开关意图并立即同步（这是 UI 唯一需要调用的入口） */
  setHelpers({ showGrid = false, showAxes = true, showShadow = false } = {}) {
    this.wantGrid = Boolean(showGrid)
    this.wantAxes = Boolean(showAxes)
    this.wantShadow = Boolean(showShadow)
    this.syncHelpers()
  }

  /** 按意图补建缺失对象、设置可见性并贴合地面高度 */
  syncHelpers() {
    if (this.wantGrid) this.ensureGrid()
    if (this.wantAxes) this.ensureAxes()
    if (this.wantShadow) this.ensureShadowCatcher()

    if (this.grid) {
      this.grid.visible = this.wantGrid
      this.grid.position.y = this.groundY
    }
    if (this.axes) {
      this.axes.visible = this.wantAxes
      this.axes.position.y = this.groundY
    }
    if (this.shadowCatcher) {
      this.shadowCatcher.visible = this.wantShadow
      this.shadowCatcher.position.y = this.groundY
      this.applyShadowScale()
    }
    if (this.labelGroup.parent) this.labelGroup.position.y = this.groundY
    this.labelGroup.visible = this.wantAxes
  }

  /**
   * 阴影接收面：一块**只显示阴影、自身完全透明**的平面（`ShadowMaterial`）。
   * 这是"接地阴影"的标准做法 —— 不必真的往场景里摆一块地板（那会挡住背景与网格），
   * 却能让模型与地面产生明确的接触关系（否则模型看起来是"飘"着的）。
   */
  ensureShadowCatcher() {
    if (this.shadowCatcher) return this.shadowCatcher

    // 平面默认在 XY 平面，绕 X 轴转 -90° 后朝上（+Y）
    const geometry = new PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    const material = new ShadowMaterial({ opacity: 0.35, transparent: true })

    this.shadowCatcher = new Mesh(geometry, material)
    this.shadowCatcher.name = 'mv-shadow-catcher'
    this.shadowCatcher.receiveShadow = true
    this.shadowCatcher.position.y = this.groundY
    this.applyShadowScale()
    this.scene.add(this.shadowCatcher)
    return this.shadowCatcher
  }

  /** 接收面要够大才接得住斜射的影子；用网格尺寸的两倍作为边长 */
  applyShadowScale() {
    if (!this.shadowCatcher) return
    const size = this.effectiveGridSize * 2
    this.shadowCatcher.scale.set(size, 1, size)
  }

  ensureGrid() {
    if (this.grid) return this.grid
    const size = this.effectiveGridSize
    this.grid = new GridHelper(size, GRID_DIVISIONS, 0x5c6472, 0x2c313a)
    this.grid.name = 'mv-grid'
    this.grid.material.transparent = true
    this.grid.material.opacity = 0.9
    this.grid.position.y = this.groundY
    this.grid.visible = this.wantGrid
    this.scene.add(this.grid)
    return this.grid
  }

  ensureAxes() {
    if (this.axes) return this.axes
    // AxesHelper 的长度烘焙在几何体里，尺寸变化必须重建（见 rebuildHelpers）
    this.axes = new AxesHelper(this.effectiveGridSize / 2)
    this.axes.name = 'mv-axes'
    this.axes.position.y = this.groundY
    this.axes.visible = this.wantAxes
    this.scene.add(this.axes)
    this.rebuildLabels(this.effectiveGridSize / 2)
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

  disposeGrid() {
    if (!this.grid) return
    this.scene.remove(this.grid)
    this.grid.geometry.dispose()
    this.grid.material.dispose()
    this.grid = null
  }

  disposeAxes() {
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
  }

  disposeShadowCatcher() {
    if (!this.shadowCatcher) return
    this.scene.remove(this.shadowCatcher)
    this.shadowCatcher.geometry.dispose()
    this.shadowCatcher.material.dispose()
    this.shadowCatcher = null
  }

  /** 尺寸变化后重建几何，并**按当前意图**恢复可见性 */
  rebuildHelpers() {
    this.disposeGrid()
    this.disposeAxes()
    this.disposeShadowCatcher()
    this.syncHelpers()
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
      // 尺寸变了：几何体必须重建，重建后按意图恢复（开着的补建、关着的保持隐藏）
      this.rebuildHelpers()
      return
    }

    this.syncHelpers()
  }

  /* ------------------------------- 清理 ------------------------------- */

  disposeGradientTexture() {
    if (this.gradientTexture) {
      this.gradientTexture.dispose()
      this.gradientTexture = null
    }
  }

  dispose() {
    this.disposeGradientTexture()
    this.disposeGrid()
    this.disposeAxes()
    this.disposeShadowCatcher()
    this.labelGroup.removeFromParent()
    if (this.scene.background?.isTexture) this.scene.background = null
  }
}
