/**
 * 饱和度通道。
 *
 * 它原本硬编码在管线里（M1 的三段式），现在是一个普通通道 —— 同时示范了通道接口的两个通用能力：
 * - `isIdentity`：告诉管线"当前参数下这一趟是恒等变换"。管线会跳过它而不是白跑；
 *   默认饱和度就是 1，而 `mix(vec3(luma), texel.rgb, 1.0)` 恒等于原色，这一趟以前是**开箱即浪费**的。
 * - `describe`：把参数回显进性能快照。
 */

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { clampRange } from './shared.js'

export const DEFAULT_SATURATION = 1
export const SATURATION_RANGE = { min: 0, max: 2, step: 0.05 }

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

export function clampSaturation(value) {
  return clampRange(value, SATURATION_RANGE, DEFAULT_SATURATION)
}

export const saturationChannel = {
  id: 'saturation',
  label: '饱和度',
  /** 靠近输出端（数值大的后执行） */
  order: 90,
  defaultEnabled: true,
  defaultSettings: { saturation: DEFAULT_SATURATION },
  ranges: { saturation: SATURATION_RANGE },

  create() {
    const pass = new ShaderPass(SaturationShader)
    pass.name = 'mv-postfx-saturation'
    return pass
  },

  update(pass, settings) {
    pass.uniforms.saturation.value = clampSaturation(settings.saturation)
  },

  isIdentity(settings) {
    return clampSaturation(settings.saturation) === DEFAULT_SATURATION
  },

  describe(pass, settings) {
    return { saturation: clampSaturation(settings.saturation) }
  },
}
