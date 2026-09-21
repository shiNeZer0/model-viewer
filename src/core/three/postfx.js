/**
 * 后处理管线：**可插拔通道** + 色调映射输出。
 *
 * 为什么改成通道：M1 时这条链是硬编码的三段式（RenderPass → 饱和度 → OutputPass），
 * 每加一个效果就多一个 if 分支，很快会失控。现在每个效果是一个独立的「通道」定义
 * （见 `postfx/` 目录），管线只负责三件事：按 order 组装、按开关与恒等判定启停、按尺寸同步。
 *
 * 三条不变式（M1 起就成立，改造后依然）：
 * 1. **双路径**：开后处理走 EffectComposer；关闭时直渲（此时色调映射由渲染器自己应用）。
 *    两条路径都不重复做色调映射 —— three 渲染到 render target 时会跳过它，交给末端 OutputPass。
 * 2. **惰性创建**：关闭后处理时不分配任何离屏 framebuffer。
 * 3. **MSAA**：自建带 samples 的 HalfFloatRenderTarget，后处理路径不丢抗锯齿。
 *
 * 通道接口见 `DEFAULT_CHANNELS` 里各定义的字段：`create / update / isIdentity / describe / dispose`。
 */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  HalfFloatType,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  WebGLRenderTarget,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'

import { bloomChannel } from './postfx/bloom.js'
import { dofChannel } from './postfx/dof.js'
import { gradeChannel } from './postfx/grade.js'
import { gtaoChannel } from './postfx/gtao.js'
import { outlineChannel } from './postfx/outline.js'
import {
  DEFAULT_SATURATION,
  SATURATION_RANGE,
  SaturationShader,
  clampSaturation,
  saturationChannel,
} from './postfx/saturation.js'
import { DEFAULT_POSTFX_SAMPLES, clampRange } from './postfx/shared.js'

// 原有导出一律保留：displayStore / perfMode / 测试都从本模块 import
export { DEFAULT_SATURATION, SATURATION_RANGE, SaturationShader, clampSaturation, saturationChannel }
export { DEFAULT_POSTFX_SAMPLES }

export const TONE_MAPPINGS = [
  { id: 'none', label: '无（线性截断）', value: NoToneMapping },
  { id: 'linear', label: '线性', value: LinearToneMapping },
  { id: 'aces', label: 'ACES Filmic', value: ACESFilmicToneMapping },
  { id: 'agx', label: 'AgX', value: AgXToneMapping },
  { id: 'neutral', label: 'Khronos Neutral', value: NeutralToneMapping },
]

/** 默认用 Neutral：它只压缩高光、几乎不改中间调，最贴近「查看器应忠实呈现模型」的目标 */
export const DEFAULT_TONE_MAPPING = 'neutral'
export const DEFAULT_EXPOSURE = 1

export const EXPOSURE_RANGE = { min: 0.1, max: 3, step: 0.05 }

/**
 * 管线内置通道（组装时按 order 升序，小的先执行）。
 *
 * 顺序即语义：描边/遮蔽/泛光/景深都作用在**线性空间的 3D 画面**上，调色与饱和度在后，
 * OutputPass 负责最后的色调映射与 sRGB 输出 —— 顺序错了效果会明显不对。
 */
export const DEFAULT_CHANNELS = [
  outlineChannel,
  gtaoChannel,
  bloomChannel,
  dofChannel,
  gradeChannel,
  saturationChannel,
]

export function resolveToneMapping(toneMappingId) {
  const entry = TONE_MAPPINGS.find((item) => item.id === toneMappingId)
  return entry ? entry.value : null
}

export function clampExposure(value) {
  return clampRange(value, EXPOSURE_RANGE, DEFAULT_EXPOSURE)
}

/** 把外部（数据库/用户输入）来的后处理设置收敛到合法范围 */
export function normalizePostFxSettings({
  toneMapping,
  exposure,
  saturation,
  enabled,
} = {}) {
  return {
    toneMapping: resolveToneMapping(toneMapping) === null ? DEFAULT_TONE_MAPPING : toneMapping,
    exposure: clampExposure(exposure),
    saturation: clampSaturation(saturation),
    enabled: enabled !== false,
  }
}

export class PostFx {
  /**
   * @param {object} options
   * @param {Array} [options.channels] 通道定义列表（默认 DEFAULT_CHANNELS；测试可注入替身）
   * @param {Record<string, boolean>} [options.channelEnabled] 逐通道初始开关
   * @param {Record<string, object>} [options.channelSettings] 逐通道初始参数
   */
  constructor(renderer, scene, camera, options = {}) {
    const settings = normalizePostFxSettings(options)
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.samples = Number.isFinite(options.samples) ? options.samples : DEFAULT_POSTFX_SAMPLES
    this.enabled = settings.enabled
    this.composer = null
    this.size = null
    /** 已应用到 composer 的像素比：用于跳过冗余的 setPixelRatio（见 applySize） */
    this.appliedPixelRatio = null

    /**
     * id → { definition, pass, enabled, settings }。
     * Map 的插入顺序就是管线顺序（组装时按 order 升序插入）。
     */
    this.channels = new Map()
    const definitions = [...(options.channels ?? DEFAULT_CHANNELS)].sort(
      (left, right) => left.order - right.order,
    )
    for (const definition of definitions) {
      this.channels.set(definition.id, {
        definition,
        pass: null,
        enabled: options.channelEnabled?.[definition.id] ?? definition.defaultEnabled !== false,
        settings: {
          ...(definition.defaultSettings ?? {}),
          ...(options.channelSettings?.[definition.id] ?? {}),
        },
      })
    }

    this.setToneMapping(settings.toneMapping)
    this.setExposure(settings.exposure)
  }

  /* ------------------------------- 通道管理 ------------------------------- */

  /**
   * 某通道当前是否处于「恒等变换」（开着也没意义 → 管线会跳过）。
   * 把 pass 一并传进去：有些通道的"有没有意义"取决于外部写入 pass 的状态
   * （例如描边通道的 selectedObjects 为空）。
   */
  isIdentity(state) {
    return Boolean(state.definition.isIdentity?.(state.settings, state.pass))
  }

  /** 管线里所有通道的元信息（UI 用它渲染开关与参数控件） */
  describeChannels() {
    return [...this.channels.values()].map((state) => ({
      id: state.definition.id,
      label: state.definition.label,
      enabled: state.enabled,
      identity: this.isIdentity(state),
      heavy: Boolean(state.definition.heavy),
      settings: { ...state.settings },
      ranges: state.definition.ranges ?? {},
    }))
  }

  /** 取某个通道的 three Pass（用于写入通道自己拿不到的外部状态，如选中对象） */
  getChannelPass(id) {
    return this.channels.get(id)?.pass ?? null
  }

  /** 通道的外部状态变化后重新同步（重算 enabled；例如选中对象变了） */
  refreshChannel(id) {
    const state = this.channels.get(id)
    if (!state) return false
    this.syncChannel(state)
    return true
  }

  /**
   * 批量启停「重」通道（低性能模式用）。
   * 只动标了 heavy 的通道，用户对轻量效果的开关不该被牵连。
   * @returns {boolean} 是否有通道真的被改动
   */
  setHeavyChannelsEnabled(enabled) {
    let changed = false
    for (const [id, state] of this.channels) {
      if (!state.definition.heavy) continue
      if (this.setChannelEnabled(id, enabled)) changed = true
    }
    return changed
  }

  /** 会被低性能模式自动关闭的通道 id（UI 据此给出提示） */
  heavyChannelIds() {
    return [...this.channels.values()]
      .filter((state) => state.definition.heavy)
      .map((state) => state.definition.id)
  }

  /** @returns {boolean} 是否真的发生了变化 */
  setChannelEnabled(id, enabled) {
    const state = this.channels.get(id)
    if (!state) return false
    const next = Boolean(enabled)
    if (next === state.enabled) return false
    state.enabled = next
    this.syncChannel(state)
    return true
  }

  /** 合并式更新通道参数（pass 尚未创建时只改状态，组装时会一并生效） */
  setChannelSettings(id, partial) {
    const state = this.channels.get(id)
    if (!state || !partial) return false
    state.settings = { ...state.settings, ...partial }
    this.syncChannel(state)
    return true
  }

  /**
   * 把通道的开关与参数写进它的 pass。
   * 恒等变换的通道即使开着也不渲染 —— 这是"跳过白跑一趟"的通用实现，
   * 饱和度 = 1、泛光强度 = 0 之类都靠它收敛在同一个地方。
   */
  syncChannel(state) {
    if (!state.pass) return
    state.definition.update?.(state.pass, state.settings)
    state.pass.enabled = state.enabled && !this.isIdentity(state)
  }

  /** 兼容旧接口：饱和度通道的 pass（旧调用方与测试用它检查恒等跳过） */
  get saturationPass() {
    return this.channels.get('saturation')?.pass ?? null
  }

  get saturation() {
    return this.channels.get('saturation')?.settings.saturation ?? DEFAULT_SATURATION
  }

  /**
   * 饱和度 = 1 时着色器是恒等变换（`mix(vec3(luma), texel.rgb, 1.0)` 恒等于 `texel.rgb`），
   * 白跑一趟全屏 pass + 一次 render target 乒乓。由通道的 isIdentity 声明，这里只是入口。
   */
  setSaturation(value) {
    return this.setChannelSettings('saturation', { saturation: clampSaturation(value) })
  }

  /* ------------------------------- 组装与尺寸 ------------------------------- */

  createContext() {
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: this.size?.width ?? 1,
      height: this.size?.height ?? 1,
      pixelRatio: this.size?.pixelRatio ?? 1,
    }
  }

  ensureComposer() {
    if (this.composer) return this.composer

    const renderTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      // WebGL2 下 samples > 0 即为 MSAA；后处理路径同样保留抗锯齿
      samples: this.samples,
    })
    const composer = new EffectComposer(this.renderer, renderTarget)
    composer.addPass(new RenderPass(this.scene, this.camera))

    /*
     * 通道一次性全部建好，之后靠 pass.enabled 启停 ——
     * 于是"开关某个效果"不需要重建 render target（那才是每帧级别的大开销）。
     */
    for (const state of this.channels.values()) {
      const pass = state.definition.create(this.createContext())
      if (!pass) {
        console.warn(`[PostFx] 通道 ${state.definition.id} 在当前环境不可用，已跳过`)
        continue
      }
      state.pass = pass
      composer.addPass(pass)
      this.syncChannel(state)
    }

    // OutputPass 负责色调映射与 sRGB 输出，必须放在最后
    composer.addPass(new OutputPass())

    this.composer = composer
    if (this.size) this.applySize()
    return composer
  }

  setSize(width, height, pixelRatio = 1) {
    this.size = {
      width: Math.max(Math.floor(width), 1),
      height: Math.max(Math.floor(height), 1),
      pixelRatio: Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1,
    }
    if (this.composer) this.applySize()
  }

  applySize() {
    const { width, height, pixelRatio } = this.size
    /*
     * EffectComposer.setPixelRatio 内部会自己调一次 setSize（见其源码），紧接着再显式
     * setSize 一次是冗余的；像素比没变时更是白白多走一趟 render target 的重建判断。
     * 只在像素比真的变化时才调它。
     */
    if (this.appliedPixelRatio !== pixelRatio) {
      this.composer.setPixelRatio(pixelRatio)
      this.appliedPixelRatio = pixelRatio
    }
    this.composer.setSize(width, height)
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled)
  }

  /**
   * 改变 MSAA 采样数（低性能模式会把它降到 0）。
   *
   * `samples` 是创建 render target 时的参数，改它只能重建 composer —— 所以这里直接丢掉
   * 旧的（下一次 render 会按新参数惰性重建），而不是试图原地修改。
   * @returns {boolean} 是否真的发生了变化（未变化时不白重建一遍 GPU 资源）
   */
  setSamples(samples) {
    const next = Number.isFinite(samples) && samples > 0 ? Math.floor(samples) : 0
    if (next === this.samples) return false
    this.samples = next
    this.dispose()
    this.appliedPixelRatio = null
    return true
  }

  setToneMapping(toneMappingId) {
    const resolved = resolveToneMapping(toneMappingId)
    // 记下原始 id 供性能快照回显（three 的常量是数字，日志里读不出来）
    this.toneMappingId = resolved === null ? DEFAULT_TONE_MAPPING : toneMappingId
    this.renderer.toneMapping = resolved === null ? NeutralToneMapping : resolved
  }

  setExposure(value) {
    this.renderer.toneMappingExposure = clampExposure(value)
  }

  /**
   * 后处理链路的当前形态（纯状态汇报，不读 GPU）。
   * 供性能快照使用：排查"帧率为什么低"时，第一件要确认的就是实际跑了几趟 pass。
   */
  describe() {
    const saturationState = this.channels.get('saturation')
    return {
      enabled: this.enabled,
      samples: this.samples,
      toneMapping: this.toneMappingId ?? DEFAULT_TONE_MAPPING,
      exposure: this.renderer.toneMappingExposure,
      saturation: this.saturation,
      // 恒等 pass 已被跳过（saturation === 1）
      saturationPassSkipped: saturationState ? this.isIdentity(saturationState) : false,
      passes: (this.composer?.passes ?? []).map((pass) => ({
        name: pass.constructor?.name ?? 'Pass',
        enabled: pass.enabled !== false,
      })),
      channels: this.describeChannels(),
    }
  }

  /** 两条路径的统一出口 */
  render() {
    if (this.enabled) {
      this.ensureComposer().render()
      return
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    // 通道自建的资源（额外的 render target、材质）由通道自己释放
    for (const state of this.channels.values()) {
      if (!state.pass) continue
      state.definition.dispose?.(state.pass)
      state.pass = null
    }
    if (this.composer) {
      this.composer.dispose()
      this.composer = null
    }
  }
}
