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
  }

  /**
   * 应用环境设置（幂等）。
   * @param {{source: string, intensity: number, topColor: string, horizonColor: string, bottomColor: string}} environment
   * @returns {object|null} 当前的环境贴图（供"环境贴图作为背景"使用）
   */
  apply(environment = {}) {
    const source = environment.source ?? 'gradient'
    const intensity = Number.isFinite(environment.intensity) ? environment.intensity : 1
    const key = environmentCacheKey(environment)

    if (source === 'none') {
      this.disposeTexture()
      this.scene.environment = null
      this.scene.environmentIntensity = 0
      this.currentKey = key
      return null
    }

    if (this.currentKey !== key || !this.currentTexture) {
      this.disposeTexture()
      this.currentTexture =
        source === 'room'
          ? this.generateFromRoom()
          : this.generateFromGradient(environment)
      this.currentKey = key
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

  /** 用外部加载好的等距柱状贴图（HDR/EXR）替换环境 */
  applyEquirectangularTexture(texture) {
    this.disposeTexture()
    const target = this.generator.fromEquirectangular(texture)
    this.currentTexture = target.texture
    this.currentKey = null
    this.scene.environment = this.currentTexture
    return this.currentTexture
  }

  disposeTexture() {
    if (this.currentTexture) {
      this.currentTexture.dispose()
      this.currentTexture = null
    }
  }

  dispose() {
    this.disposeTexture()
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
