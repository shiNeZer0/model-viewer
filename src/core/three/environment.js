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

import {
  builtinEnvironmentLabel,
  builtinEnvironmentUrl,
} from '../../constants/builtinEnvironments.js'

export const GRADIENT_TEXTURE_SIZE = { width: 128, height: 64 }
/** RoomEnvironment 的模糊量：0.04 是 three 官方示例的取值 */
const ROOM_ENVIRONMENT_SIGMA = 0.04

/** 程序化来源（不含 imported / builtin，那两者需要额外的"文件是否已加载"判断） */
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
 * 当前环境设置对应的贴图 URL（没有则 null）。
 *
 * 把两种"需要先去读文件"的来源统一起来：
 * - `imported`：用户选的 HDR/EXR，URL 存在 `customHdrUrl`（桌面端 asset 协议 / Web 端 blob）
 * - `builtin`：随应用分发的全景图，按 id 推导出应用内 URL
 *
 * 两者后续处理完全相同（读取 → 登记 → PMREM），区别只在 URL 从哪来。
 */
export function resolveEnvironmentTextureUrl(environment = {}) {
  if (environment?.source === 'imported') return environment.customHdrUrl || null
  if (environment?.source === 'builtin') return builtinEnvironmentUrl(environment.builtinId)
  return null
}

/**
 * 贴图**加载完成后**是否应该立刻应用它。
 *
 * 异步加载有天然竞态：用户连着切两张时，**先发起的请求可能后完成**。若它无条件套用，
 * 就会用旧选择覆盖用户最新的选择 —— 表现为"偶发的切换没生效"，是否发生取决于完成顺序。
 * 所以应用前必须确认"这一张仍是当前选中的那张"。
 *
 * 注意：**登记进缓存不受此限制**，登记总是有益的（下次切回来就是命中了），只是先不应用。
 *
 * @param {object} currentEnvironment 引擎当前持有的 environment（可能已被更新为最新选择）
 * @param {string|null} loadedUrl 刚加载完成的贴图 URL
 */
export function shouldApplyLoadedTexture(currentEnvironment, loadedUrl) {
  if (!loadedUrl) return false
  return resolveEnvironmentTextureUrl(currentEnvironment) === loadedUrl
}

/**
 * 环境贴图的展示名（日志与界面提示共用）。
 * 内置的取清单里的中文标签，导入的取用户文件名；都取不到时回退到 id / 空串。
 */
export function environmentTextureName(environment = {}) {
  if (environment?.source === 'builtin') {
    return builtinEnvironmentLabel(environment.builtinId) || environment.builtinId || ''
  }
  return environment?.customHdrName || ''
}

/**
 * 决定这一帧实际要用哪种环境（纯函数，便于单测）。
 *
 * 关键点：**需要读文件的贴图没准备好时必须退化为渐变**。它要经网络读取 + PMREM 转换，
 * 是异步的；若此时让 scene.environment 保持为空，画面会直接变黑，
 * 用户看到的是"选了 HDR 反而黑了"。
 *
 * `hasTexture` 设计成**回调**而不是布尔值：用哪个 URL 去问"登记了没有"是本函数的内部知识
 * （它自己就是靠 `resolveEnvironmentTextureUrl` 推出的目标 URL）。早先这里收布尔值，
 * 调用方得自己再解析一次 URL，结果只看了 `customHdrUrl`，内置来源（该字段为 null）
 * 被永远当成"未准备好"，切了等于没切。
 *
 * @param {object} environment 光照状态里的 environment
 * @param {{hasTexture?: (url: string) => boolean}} options 查询某个 URL 的贴图是否已登记
 * @returns {{kind: 'none'|'gradient'|'room'|'imported', cacheKey: string, fellBack: boolean,
 *   textureUrl?: string|null}} 需要读文件时一并给出目标 URL，调用方不必重复解析
 */
export function resolveEnvironmentPlan(environment = {}, { hasTexture = () => false } = {}) {
  const raw = environment.source ?? 'gradient'
  /*
   * `builtin` 与 `imported` 归为一类：两者的生成路径完全一样（都从"已登记的纹理"做 PMREM），
   * 区别只在 URL 从哪来，所以这里统一判定，kind 依旧复用 `imported`。
   */
  const needsTexture = raw === 'imported' || raw === 'builtin'
  // 与 normalizeLightingState 的兜底保持一致：非法来源按渐变处理（防御性，正常路径到不了这里）
  const requested = needsTexture || PROCEDURAL_SOURCES.includes(raw) ? raw : 'gradient'

  const textureUrl = needsTexture ? resolveEnvironmentTextureUrl(environment) : null
  const canUseTexture = needsTexture && Boolean(textureUrl) && hasTexture(textureUrl)
  const kind = canUseTexture ? 'imported' : needsTexture ? 'gradient' : requested

  if (kind === 'imported') {
    /*
     * 缓存键用 URL：同一张贴图的不同强度不需要重新做 PMREM。
     * **同时把 textureUrl 一并返回** —— 调用方（EnvironmentManager.apply）要拿它去取纹理；
     * 若让调用方自己再解析一次，就会重演"只看 customHdrUrl、内置来源解析成 null"那个 bug。
     */
    return { kind, cacheKey: `texture|${textureUrl}`, fellBack: false, textureUrl }
  }
  return {
    kind,
    cacheKey: environmentCacheKey({ ...environment, source: kind }),
    fellBack: needsTexture,
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
  /*
   * 用 HDRLoader，不用旧的 RGBELoader：后者从 three r180 起只是 HDRLoader 的一层包装
   * （唯一区别是构造函数里多打一条弃用警告 `RGBELoader has been deprecated`），
   * 换过来行为完全一致，还省掉那条控制台噪音。
   */
  const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js')
  return new HDRLoader().loadAsync(url)
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
   *   bottomColor: string, customHdrUrl?: string, builtinId?: string}} environment
   * @returns {object|null} 当前的环境贴图（供"环境贴图作为背景"使用）
   */
  apply(environment = {}) {
    const intensity = Number.isFinite(environment.intensity) ? environment.intensity : 1
    const plan = resolveEnvironmentPlan(environment, {
      hasTexture: (url) => this.hasImportedTexture(url),
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
        // 用 plan 携带的 URL，**不要**在这里重新解析（内置来源没有 customHdrUrl，会被解析成 null）
        this.currentTexture = this.generateFromImported(plan.textureUrl)
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
