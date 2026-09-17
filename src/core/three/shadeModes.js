/**
 * 着色模式策略层。
 *
 * 核心约束：**只换材质引用与叠加层，绝不修改几何，也不修改可见性**。
 * - 只换材质 → 模式切换是常数级开销，切回「实体」能 100% 还原原始材质与贴图；
 * - 不碰 visible → 可见性统一由 `visibility.js` 按「用户开关 + 模型原始值 + 仅线框」解析，
 *   否则「仅线框」切回实体时会把用户手动隐藏的网格一起显示出来。
 *
 * 线框相关模式有两道保护：超过 fullLimit 时退化为「只画结构边」，
 * 超过 hardLimit 时直接跳过并给出提示——否则百万面模型一开线框就会卡死。
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  WireframeGeometry,
} from 'three'

import { CLAY_COLOR } from './materialNormalizer.js'
import { collectModelStats } from './stats.js'

export const SHADE_MODES = [
  { id: 'shaded', label: '实体（贴图）', hint: '使用模型自带的材质与贴图' },
  { id: 'clay', label: '实体（无贴图）', hint: '统一黏土材质，只看形体比例' },
  { id: 'flat', label: '平面着色', hint: '关闭法线插值，裸露三角面' },
  { id: 'shadedWire', label: '实体 + 线框', hint: '在实体上叠加边线' },
  { id: 'wire', label: '仅线框', hint: '只显示网格线' },
  { id: 'vertexColor', label: '顶点色', hint: '直接显示几何体的顶点颜色' },
  { id: 'normal', label: '法线', hint: '用颜色表示法线朝向' },
  { id: 'uv', label: 'UV 棋盘格', hint: '检查 UV 展开与贴图密度' },
]

export const DEFAULT_SHADE_MODE = 'shaded'
/** 超过该三角面数就退化为「只画结构边」 */
export const WIREFRAME_TRIANGLE_LIMIT = 300_000
/** 超过该三角面数直接跳过线框生成 */
export const WIREFRAME_HARD_LIMIT = 2_000_000
/** 结构边判定阈值（夹角大于该值的相邻面之间画线） */
export const EDGE_THRESHOLD_DEG = 30
/** 线框轻微放大，避免与实体表面 z-fighting */
const OVERLAY_SCALE = 1.001

const OVERLAY_COLOR = 0x7fb2ff

export function resolveShadeMode(modeId) {
  if (!modeId) return null
  return SHADE_MODES.find((mode) => mode.id === modeId) ?? null
}

/** 需要额外生成线框叠加层 */
export function needsWireframeOverlay(modeId) {
  return modeId === 'shadedWire' || modeId === 'wire'
}

/** 需要隐藏实体（否则线框会被实体挡住） */
export function hidesSolid(modeId) {
  return modeId === 'wire'
}

/** 该模式是否替换了模型原始材质 */
export function overridesMaterial(modeId) {
  return ['clay', 'flat', 'wire', 'vertexColor', 'normal', 'uv'].includes(modeId)
}

/** 三角面数：有索引取索引数，无索引取顶点数 */
export function triangleCountOf(geometry) {
  const position = geometry?.attributes?.position
  if (!position?.count) return 0
  const indexCount = geometry?.index?.count
  return Math.floor((indexCount ?? position.count) / 3)
}

/** UV 棋盘格纹理（需要 DOM Canvas，Node 环境下返回 null） */
export function createCheckerTexture({
  cells = 8,
  cellSize = 32,
  colorA = '#f2f4f8',
  colorB = '#c2453f',
} = {}) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = cells * cellSize
  canvas.height = cells * cellSize
  const context = canvas.getContext('2d')
  if (!context) return null

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? colorA : colorB
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

export class ShadeController {
  /**
   * @param {object} root 模型根节点（three Object3D）
   * @param {{wireframeTriangleLimit?: number, wireframeHardLimit?: number, edgeThresholdDeg?: number}} options
   */
  constructor(root, options = {}) {
    this.root = root
    this.wireframeTriangleLimit = options.wireframeTriangleLimit ?? WIREFRAME_TRIANGLE_LIMIT
    this.wireframeHardLimit = options.wireframeHardLimit ?? WIREFRAME_HARD_LIMIT
    this.edgeThresholdDeg = options.edgeThresholdDeg ?? EDGE_THRESHOLD_DEG

    /** mesh -> 原始材质 */
    this.originalMaterials = new Map()
    /** 随模式切换创建/销毁的材质（flat 的克隆） */
    this.transientMaterials = new Set()
    /** 整个控制器生命周期内复用的材质（黏土/法线/顶点色/UV/线框） */
    this.sharedMaterials = new Set()
    /** 线框几何体（每个 mesh 一份） */
    this.overlayGeometries = new Set()
    this.overlays = []
    this.currentMode = null

    this.rememberOriginals()
  }

  rememberOriginals() {
    this.root?.traverse((node) => {
      if (!node.isMesh) return
      if (!this.originalMaterials.has(node)) this.originalMaterials.set(node, node.material)
    })
  }

  /**
   * 应用着色模式。
   * @returns {string[]} 需要展示给用户的提示（例如「模型过大已跳过线框」）
   */
  apply(modeId) {
    const mode = resolveShadeMode(modeId) ?? resolveShadeMode(DEFAULT_SHADE_MODE)
    const warnings = []

    // 每次都从「原始状态」重新开始，避免反复切换时叠加残留
    this.clearOverlays()
    this.restoreMaterials()

    // 「仅线框」只画线、不做材质替换（实体是否隐藏由 visibility 层统一解析）
    if (!hidesSolid(mode.id)) {
      if (mode.id === 'clay') {
        this.overrideAll(() => this.getClayMaterial())
      } else if (mode.id === 'flat') {
        this.overrideAll((mesh, original) => this.flatVariant(original))
      } else if (mode.id === 'normal') {
        this.overrideAll(() => this.getNormalMaterial())
      } else if (mode.id === 'vertexColor') {
        if (this.hasGeometryAttribute('color')) {
          this.overrideAll(() => this.getVertexColorMaterial())
        } else {
          warnings.push('该模型的几何体没有顶点颜色属性，已保持原始材质')
        }
      } else if (mode.id === 'uv') {
        if (!this.hasGeometryAttribute('uv')) {
          warnings.push('该模型的几何体没有 UV 坐标，无法显示 UV 棋盘格')
        } else {
          const material = this.getUvMaterial(warnings)
          if (material) this.overrideAll(() => material)
        }
      }
    }

    if (needsWireframeOverlay(mode.id)) {
      warnings.push(...this.buildOverlays())
    }

    this.currentMode = mode.id
    return warnings
  }

  /* ------------------------------ 材质处理 ------------------------------ */

  restoreMaterials() {
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material
    }
    for (const material of this.transientMaterials) {
      material.dispose()
    }
    this.transientMaterials.clear()
  }

  overrideAll(factory) {
    for (const [mesh, original] of this.originalMaterials) {
      const material = factory(mesh, original)
      if (material) mesh.material = material
    }
  }

  hasGeometryAttribute(attributeName) {
    let found = false
    this.root?.traverse((node) => {
      if (found || !node.isMesh) return
      if (node.geometry?.attributes?.[attributeName]?.count) found = true
    })
    return found
  }

  /** 每个原始材质克隆一份并开启平面着色（共享材质必须克隆，否则会污染其他 mesh） */
  flatVariant(material) {
    const list = Array.isArray(material) ? material : [material]
    const cloned = list.filter(Boolean).map((item) => {
      const clone = item.clone()
      clone.flatShading = true
      clone.needsUpdate = true
      this.transientMaterials.add(clone)
      return clone
    })
    if (!cloned.length) return null
    return Array.isArray(material) ? cloned : cloned[0]
  }

  trackShared(material) {
    this.sharedMaterials.add(material)
    return material
  }

  getClayMaterial() {
    if (!this.clayMaterial) {
      this.clayMaterial = this.trackShared(
        new MeshStandardMaterial({
          name: 'mv-shade-clay',
          color: new Color(CLAY_COLOR),
          metalness: 0.08,
          roughness: 0.62,
          side: DoubleSide,
        }),
      )
    }
    return this.clayMaterial
  }

  getNormalMaterial() {
    if (!this.normalMaterial) {
      this.normalMaterial = this.trackShared(new MeshNormalMaterial({ name: 'mv-shade-normal' }))
    }
    return this.normalMaterial
  }

  getVertexColorMaterial() {
    if (!this.vertexColorMaterial) {
      this.vertexColorMaterial = this.trackShared(
        new MeshStandardMaterial({
          name: 'mv-shade-vertex-color',
          color: 0xffffff,
          vertexColors: true,
          metalness: 0.05,
          roughness: 0.7,
          side: DoubleSide,
        }),
      )
    }
    return this.vertexColorMaterial
  }

  getUvMaterial(warnings) {
    if (this.uvMaterial) return this.uvMaterial
    const texture = createCheckerTexture()
    if (!texture) {
      warnings.push('当前环境无法创建 Canvas 纹理，UV 棋盘格不可用')
      return null
    }
    this.checkerTexture = texture
    this.uvMaterial = this.trackShared(
      new MeshBasicMaterial({ name: 'mv-shade-uv', map: texture, side: DoubleSide }),
    )
    return this.uvMaterial
  }

  getOverlayMaterial() {
    if (!this.overlayMaterial) {
      this.overlayMaterial = this.trackShared(
        new LineBasicMaterial({
          name: 'mv-wireframe-overlay',
          color: OVERLAY_COLOR,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      )
    }
    return this.overlayMaterial
  }

  /* ------------------------------ 线框叠加 ------------------------------ */

  buildOverlays() {
    const warnings = []
    const stats = collectModelStats(this.root)

    if (!stats.meshCount) return warnings

    if (stats.triangleCount > this.wireframeHardLimit) {
      warnings.push(
        `模型三角面数（${stats.triangleCount.toLocaleString('zh-CN')}）超过 ${this.wireframeHardLimit.toLocaleString('zh-CN')}，` +
          '已跳过线框生成以避免卡死',
      )
      return warnings
    }

    const useFullWireframe = stats.triangleCount <= this.wireframeTriangleLimit
    if (!useFullWireframe) {
      warnings.push(
        `模型较大（${stats.triangleCount.toLocaleString('zh-CN')} 面），线框退化为只显示结构边（${this.edgeThresholdDeg}° 以上折角）`,
      )
    }
    if (stats.hasSkin) {
      warnings.push('模型含骨骼蒙皮，线框按绑定姿势生成，播放动画时不会跟随形变')
    }

    const material = this.getOverlayMaterial()
    const scale = new Vector3(OVERLAY_SCALE, OVERLAY_SCALE, OVERLAY_SCALE)

    this.root?.traverse((node) => {
      if (!node.isMesh || !node.geometry) return
      // 骨架网格的线框需要蒙皮计算，这里按绑定姿势生成，故跳过骨骼网格之外的复杂性
      const geometry = useFullWireframe
        ? new WireframeGeometry(node.geometry)
        : new EdgesGeometry(node.geometry, this.edgeThresholdDeg)

      this.overlayGeometries.add(geometry)
      const lines = new LineSegments(geometry, material)
      lines.name = 'mv-wireframe-overlay'
      lines.renderOrder = 1
      lines.matrixAutoUpdate = false
      // 挂在 mesh 的父节点上并复制其局部矩阵：这样「仅线框」模式隐藏 mesh 时线仍可见
      const parent = node.parent ?? this.root
      parent.add(lines)
      lines.matrix.copy(node.matrix).scale(scale)
      lines.matrixWorldNeedsUpdate = true
      this.overlays.push(lines)
    })

    return warnings
  }

  clearOverlays() {
    for (const lines of this.overlays) {
      lines.removeFromParent()
    }
    this.overlays = []
    for (const geometry of this.overlayGeometries) {
      geometry.dispose()
    }
    this.overlayGeometries.clear()
  }

  dispose() {
    this.clearOverlays()
    this.restoreMaterials()
    for (const material of this.sharedMaterials) {
      material.dispose()
    }
    this.sharedMaterials.clear()
    if (this.checkerTexture) {
      this.checkerTexture.dispose()
      this.checkerTexture = null
    }
  }
}
