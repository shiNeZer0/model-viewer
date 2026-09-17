/**
 * 环境贴图管理：程序化渐变 / RoomEnvironment / 用户导入的 HDR。
 *
 * 为什么不用现成 HDRI 文件：体积与许可都是麻烦。默认用**程序化渐变**生成等距柱状贴图，
 * 再经 PMREM 转成供 PBR 材质使用的高光环境；"影棚"预设则用 three 自带的 RoomEnvironment。
 * 用户确实需要实拍环境时，可以导入自己的 .hdr/.exr。
 *
 * 单测覆盖的是"渐变数据生成"这类纯逻辑（不需要 WebGL）；PMREM 部分只能在真实渲染器上跑。
 */

import { Color, DataTexture, EquirectangularReflectionMapping, PMREMGenerator, RGBAFormat, FloatType } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export const GRADIENT_TEXTURE_SIZE = { width: 128, height: 64 }
/** RoomEnvironment 的模糊量：0.04 是 three 官方示例的取值 */
const ROOM_ENVIRONMENT_SIGMA = 0.04

/** 程序化来源（不含 imported，它需要额外的加载状态判断） */
const PROCEDURAL_SOURCES = ['gradient', 'room', 'none']

function mixChannel(a, b, t) {
  return a + (b - a) * t
}

/**
 * 生成等距柱状投影的渐变环境数据（纯函数）。
 * 行方向：0 = 天顶 → 中间 = 地平线 → 末行 = 地面。
 *
 * 颜色用 three 的 Color 解析：在 ColorManagement 开启时它会把 sRGB 十六进制转成线性值，
 * 正好符合"环境贴图数据应是线性空间"的要求（浮点 DataTexture 不做色彩空间转换）。
 *
 * @returns {{data: Float32Array, width: number, height: number}} RGBA 浮点数据
 */
export function createGradientEquirectData({
  topColor = '#e8edf5',
  horizonColor = '#b9c3d1',
  bottomColor = '#3a3f48',
  width = GRADIENT_TEXTURE_SIZE.width,
  height = GRADIENT_TEXTURE_SIZE.height,
} = {}) {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : GRADIENT_TEXTURE_SIZE.width
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.floor(height) : GRADIENT_TEXTURE_SIZE.height

  const top = new Color(topColor)
  const horizon = new Color(horizonColor)
  const bottom = new Color(bottomColor)

  const data = new Float32Array(safeWidth * safeHeight * 4)

  for (let y = 0; y < safeHeight; y += 1) {
    const v = safeHeight === 1 ? 0 : y / (safeHeight - 1)
    const upper = v < 0.5
    const t = upper ? v * 2 : (v - 0.5) * 2
    const from = upper ? top : horizon
    const to = upper ? horizon : bottom
    const r = mixChannel(from.r, to.r, t)
    const g = mixChannel(from.g, to.g, t)
    const b = mixChannel(from.b, to.b, t)

    for (let x = 0; x < safeWidth; x += 1) {
      const index = (y * safeWidth + x) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = 1
    }
  }

  return { data, width: safeWidth, height: safeHeight }
}

/** 环境设置的缓存键：只有它变了才需要重新生成 PMREM */
export function environmentCacheKey(environment = {}) {
  return [
    environment.source,
    environment.topColor,
    environment.horizonColor,
    environment.bottomColor,
    environment.customHdrName ?? '',
  ].join('|')
}

/**
 * 决定这一帧实际要用哪种环境（纯函数，便于单测）。
 *
 * 关键点：**导入的贴图没准备好时必须退化为渐变**。它要经网络读取 + PMREM 转换，
 * 是异步的；若此时让 scene.environment 保持为空，画面会直接变黑，
 * 用户看到的是"导入了 HDR 反而黑了"。
 *
 * @param {object} environment 光照状态里的 environment
 * @param {{importedReady?: boolean}} options 导入贴图是否已加载并登记
 * @returns {{kind: 'none'|'gradient'|'room'|'imported', cacheKey: string, fellBack: boolean}}
 */
export function resolveEnvironmentPlan(environment = {}, { importedReady = false } = {}) {
  const raw = environment.source ?? 'gradient'
  // 与 normalizeLightingState 的兜底保持一致：非法来源按渐变处理（防御性，正常路径到不了这里）
  const requested = raw === 'imported' || PROCEDURAL_SOURCES.includes(raw) ? raw : 'gradient'
  const canUseImported = requested === 'imported' && importedReady && Boolean(environment.customHdrUrl)
  const kind = canUseImported ? 'imported' : requested === 'imported' ? 'gradient' : requested

  if (kind === 'imported') {
    // 缓存键用 URL：同一张 HDR 的不同强度不需要重新做 PMREM
    return { kind, cacheKey: `imported|${environment.customHdrUrl}`, fellBack: false }
  }
  return {
    kind,
    cacheKey: environmentCacheKey({ ...environment, source: kind }),
    fellBack: requested === 'imported',
  }
}

/**
 * 读取等距柱状的 HDR / EXR 文件（按需 import，两个 loader 都不进首屏）。
 * @param {string} url asset 协议 URL 或 blob URL
 * @param {{extension?: string}} options 扩展名（exr 走 EXRLoader，其余按 HDR 处理）
 */
export async function loadEquirectangularTexture(url, { extension = 'hdr' } = {}) {
  if (extension === 'exr') {
    const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js')
    return new EXRLoader().loadAsync(url)
  }
  const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js')
  return new RGBELoader().loadAsync(url)
}

export class EnvironmentManager {
  /**
   * @param {object} renderer WebGLRenderer（PMREM 需要真实渲染器）
   * @param {object} scene three 的 Scene
   */
  constructor(renderer, scene) {
    if (!renderer) throw new Error('EnvironmentManager 需要 WebGLRenderer')
    if (!scene) throw new Error('EnvironmentManager 需要 Scene')
    this.renderer = renderer
    this.scene = scene
    this.generator = new PMREMGenerator(renderer)
    this.currentTexture = null
    this.currentKey = null
    this.roomScene = null
    /** 用户导入的等距柱状贴图：URL → 原始 texture（尚未做 PMREM） */
    this.importedTextures = new Map()
  }

  /**
   * 登记一张导入的环境贴图（由引擎在文件读完之后调用）。
   * 同一 URL 重复登记会替换并释放旧贴图，避免切换主题时泄漏显存。
   */
  registerImportedTexture(url, texture) {
    if (!url || !texture) return false
    const existing = this.importedTextures.get(url)
    if (existing && existing !== texture) existing.dispose?.()
    this.importedTextures.set(url, texture)
    return true
  }

  hasImportedTexture(url) {
    return Boolean(url && this.importedTextures.has(url))
  }

  /**
   * 应用环境设置（幂等）。
   * @param {{source: string, intensity: number, topColor: string, horizonColor: string,
   *   bottomColor: string, customHdrUrl?: string}} environment
   * @returns {object|null} 当前的环境贴图（供"环境贴图作为背景"使用）
   */
  apply(environment = {}) {
    const intensity = Number.isFinite(environment.intensity) ? environment.intensity : 1
    const plan = resolveEnvironmentPlan(environment, {
      importedReady: this.hasImportedTexture(environment.customHdrUrl),
    })

    if (plan.kind === 'none') {
      this.disposeTexture()
      this.scene.environment = null
      this.scene.environmentIntensity = 0
      this.currentKey = plan.cacheKey
      return null
    }

    if (this.currentKey !== plan.cacheKey || !this.currentTexture) {
      this.disposeTexture()
      if (plan.kind === 'imported') {
        this.currentTexture = this.generateFromImported(environment.customHdrUrl)
      } else {
        this.currentTexture =
          plan.kind === 'room' ? this.generateFromRoom() : this.generateFromGradient(environment)
      }
      this.currentKey = plan.cacheKey
    }

    this.scene.environment = this.currentTexture
    this.scene.environmentIntensity = intensity
    return this.currentTexture
  }

  generateFromGradient(environment) {
    const { data, width, height } = createGradientEquirectData(environment)
    const texture = new DataTexture(data, width, height, RGBAFormat, FloatType)
    texture.mapping = EquirectangularReflectionMapping
    texture.needsUpdate = true

    const target = this.generator.fromEquirectangular(texture)
    // 源数据只是中间产物，转换后即可释放
    texture.dispose()
    return target.texture
  }

  generateFromRoom() {
    if (!this.roomScene) this.roomScene = new RoomEnvironment()
    const target = this.generator.fromScene(this.roomScene, ROOM_ENVIRONMENT_SIGMA)
    return target.texture
  }

  /** 用已登记的导入贴图生成 PMREM 环境（M6-5 的导入路径走这里） */
  generateFromImported(url) {
    const source = this.importedTextures.get(url)
    if (!source) return null
    return this.generator.fromEquirectangular(source).texture
  }

  disposeTexture() {
    if (this.currentTexture) {
      this.currentTexture.dispose()
      this.currentTexture = null
    }
  }

  dispose() {
    this.disposeTexture()
    // 导入贴图是原始数据（未做 PMREM），也必须显式释放
    for (const texture of this.importedTextures.values()) texture.dispose?.()
    this.importedTextures.clear()
    // RoomEnvironment 内部是若干 Mesh + 材质，交给 three 的常规释放流程
    if (this.roomScene) {
      this.roomScene.traverse?.((node) => {
        node.geometry?.dispose?.()
        if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.())
        else node.material?.dispose?.()
      })
      this.roomScene = null
    }
    this.generator.dispose?.()
  }
}
