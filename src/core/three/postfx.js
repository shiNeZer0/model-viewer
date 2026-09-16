/**
 * 后处理管线：色调映射 / 曝光 / 饱和度。
 *
 * 设计要点：
 * 1. **双路径**：开启后处理时走 EffectComposer（RenderPass → 饱和度 → OutputPass），
 *    关闭时直接 renderer.render（此时色调映射由渲染器自身应用）。两条路径都不重复做色调映射——
 *    three 在渲染到 render target 时会跳过色调映射与色彩空间转换，交给末端的 OutputPass。
 * 2. **惰性创建**：关闭后处理时不分配任何离屏 framebuffer。
 * 3. **MSAA**：自建带 samples 的 HalfFloatRenderTarget，避免后处理路径丢失抗锯齿。
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
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

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
export const DEFAULT_SATURATION = 1

export const EXPOSURE_RANGE = { min: 0.1, max: 3, step: 0.05 }
export const SATURATION_RANGE = { min: 0, max: 2, step: 0.05 }

export function resolveToneMapping(toneMappingId) {
  const entry = TONE_MAPPINGS.find((item) => item.id === toneMappingId)
  return entry ? entry.value : null
}

function clampRange(value, { min, max }, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function clampExposure(value) {
  return clampRange(value, EXPOSURE_RANGE, DEFAULT_EXPOSURE)
}

export function clampSaturation(value) {
  return clampRange(value, SATURATION_RANGE, DEFAULT_SATURATION)
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

/** 饱和度着色器：1 = 原样，0 = 灰度，>1 更浓（Rec.709 亮度权重） */
export const SaturationShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: DEFAULT_SATURATION },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      float luma = dot( texel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      gl_FragColor = vec4( mix( vec3( luma ), texel.rgb, saturation ), texel.a );
    }
  `,
}

export class PostFx {
  constructor(renderer, scene, camera, options = {}) {
    const settings = normalizePostFxSettings(options)
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.samples = Number.isFinite(options.samples) ? options.samples : 4
    this.enabled = settings.enabled
    this.saturation = settings.saturation
    this.composer = null
    this.saturationPass = null
    this.size = null

    this.setToneMapping(settings.toneMapping)
    this.setExposure(settings.exposure)
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

    this.saturationPass = new ShaderPass(SaturationShader)
    this.saturationPass.uniforms.saturation.value = this.saturation
    composer.addPass(this.saturationPass)

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
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled)
  }

  setSaturation(value) {
    this.saturation = clampSaturation(value)
    if (this.saturationPass) {
      this.saturationPass.uniforms.saturation.value = this.saturation
    }
  }

  setToneMapping(toneMappingId) {
    const resolved = resolveToneMapping(toneMappingId)
    this.renderer.toneMapping = resolved === null ? NeutralToneMapping : resolved
  }

  setExposure(value) {
    this.renderer.toneMappingExposure = clampExposure(value)
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
    if (this.composer) {
      this.composer.dispose()
      this.composer = null
      this.saturationPass = null
    }
  }
}
