/**
 * 调色通道：色温 + 暗角。
 *
 * 为什么不是 LUT：three 的 LUTPass 需要一张 3D 查找表纹理（外部 .cube/.png 资源，或再写一条
 * 程序化生成链路），而它能做的"风格化调色"与已有的饱和度通道 + 5 种色调映射高度重叠。
 * 这里只做两件**在线性空间下依然成立**的事，因此不需要额外资源、也不会有色彩管理的坑：
 *
 * - **色温**：对 R/B 通道做增益。这在线性空间里就是"色温"的物理含义，不是近似。
 * - **暗角**：按到画面中心的归一化距离做乘法衰减，与所处色彩空间无关。
 *
 * 刻意**没做对比度**：对比度是显示空间的非线性操作（以 0.5 中灰为中心拉伸），放在
 * OutputPass 之前的线性空间里做，得到的是"曝光式"的结果 —— 与用户在别处见到的
 * 对比度滑杆不是一回事，加进来只会让人困惑。宁可不做。
 */

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

export const GRADE_DEFAULTS = {
  /** -1 = 冷，0 = 原样，+1 = 暖 */
  temperature: 0,
  /** 0 = 关闭，1 = 最强 */
  vignette: 0,
}

export const GRADE_RANGES = {
  temperature: { min: -1, max: 1, step: 0.05 },
  vignette: { min: 0, max: 1, step: 0.05 },
}

export const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    temperature: { value: GRADE_DEFAULTS.temperature },
    vignette: { value: GRADE_DEFAULTS.vignette },
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
    uniform float temperature;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec3 color = texel.rgb;

      // 色温：暖调抬红压蓝，冷调相反（通道增益，线性空间下即色温本身）
      color *= vec3( 1.0 + temperature * 0.12, 1.0, 1.0 - temperature * 0.12 );

      // 暗角：到画面中心的归一化距离（1.414 让四角恰好到 1.0）
      float dist = length( vUv - 0.5 ) * 1.41421356;
      color *= 1.0 - vignette * smoothstep( 0.4, 1.0, dist );

      gl_FragColor = vec4( color, texel.a );
    }
  `,
}

export const gradeChannel = {
  id: 'grade',
  label: '调色',
  order: 80,
  defaultEnabled: true,
  defaultSettings: { ...GRADE_DEFAULTS },
  ranges: GRADE_RANGES,

  create() {
    const pass = new ShaderPass(ColorGradeShader)
    pass.name = 'mv-postfx-grade'
    return pass
  },

  update(pass, settings) {
    pass.uniforms.temperature.value = settings.temperature
    pass.uniforms.vignette.value = settings.vignette
  },

  /** 色温与暗角都是"原样"时，这一趟也是恒等变换 */
  isIdentity(settings) {
    return settings.temperature === 0 && settings.vignette === 0
  },

  describe(pass, settings) {
    return { temperature: settings.temperature, vignette: settings.vignette }
  },
}
