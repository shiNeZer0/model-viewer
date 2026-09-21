/**
 * 光照装置与光照状态（可单测部分优先）。
 *
 * 组成：
 * - 三点平行光（主光/补光/轮廓光）+ 半球环境光，各自可调强度/颜色/方位/仰角/半径；
 * - 环境贴图强度（scene.environmentIntensity）；
 * - 主题（用户自定义光照设置）的快照校验与序列化。
 *
 * 方位/仰角 → 世界坐标的换算抽成纯函数，是这块最容易出错也最容易验证的部分。
 */

import { Color, DirectionalLight, HemisphereLight, Sphere, Vector3 } from 'three'

import { DEFAULT_PRESET_ID, resolvePreset } from '../../constants/presets/lightingPresets.js'

export const SCHEMA_VERSION = 1

export const LIGHT_ROLES = [
  { id: 'key', label: '主光', description: '决定明暗关系与投影方向，通常最强' },
  { id: 'fill', label: '补光', description: '抬起暗部细节，避免死黑' },
  { id: 'rim', label: '轮廓光', description: '从背后勾边，突出剪影与体积' },
]

export const LIGHT_LIMITS = {
  intensity: { min: 0, max: 10, step: 0.05 },
  azimuth: { min: -180, max: 180, step: 1 },
  // 允许到正上/正下方：平行光在极点处依然有定义，只是方位角失去意义
  elevation: { min: -90, max: 90, step: 1 },
  radius: { min: 0.1, max: 100, step: 0.5 },
  ambientIntensity: { min: 0, max: 3, step: 0.05 },
  environmentIntensity: { min: 0, max: 5, step: 0.05 },
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function clamp(value, { min, max }, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 取颜色；非法值回退到 fallback（避免把 undefined 喂给 three） */
export function normalizeColor(value, fallback = '#ffffff') {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
}

/**
 * 方位角/仰角/半径 → 世界坐标（纯函数）。
 * 约定：方位角绕 +Y 轴，0° 指向 +Z，逆时针为正；仰角从水平面起算，+90° 在正上方。
 */
export function computeLightPosition({ azimuth = 0, elevation = 0, radius = 10 } = {}) {
  const azimuthRad = (clamp(azimuth, LIGHT_LIMITS.azimuth, 0) * Math.PI) / 180
  const elevationRad = (clamp(elevation, LIGHT_LIMITS.elevation, 0) * Math.PI) / 180
  const safeRadius = clamp(radius, LIGHT_LIMITS.radius, 10)
  const horizontal = Math.cos(elevationRad) * safeRadius

  return [
    Math.sin(azimuthRad) * horizontal,
    Math.sin(elevationRad) * safeRadius,
    Math.cos(azimuthRad) * horizontal,
  ]
}

/** 补全/收敛单个光源配置 */
export function normalizeLight(light = {}, role = 'key') {
  const fallback = resolvePreset(DEFAULT_PRESET_ID).lights.find((item) => item.role === role) ?? {}
  return {
    role,
    enabled: light.enabled === undefined ? (fallback.enabled ?? true) : Boolean(light.enabled),
    intensity: clamp(light.intensity, LIGHT_LIMITS.intensity, fallback.intensity ?? 1),
    color: normalizeColor(light.color, fallback.color ?? '#ffffff'),
    azimuth: clamp(light.azimuth, LIGHT_LIMITS.azimuth, fallback.azimuth ?? 0),
    elevation: clamp(light.elevation, LIGHT_LIMITS.elevation, fallback.elevation ?? 30),
    radius: clamp(light.radius, LIGHT_LIMITS.radius, fallback.radius ?? 10),
  }
}

/** 环境来源：程序化渐变 / three 自带影棚 / 关闭 / 用户导入的 HDR、EXR */
export const ENVIRONMENT_SOURCES = ['gradient', 'room', 'none', 'imported']

/**
 * 给模型树打开投影与接收阴影。
 *
 * **必须显式打开**：three 里每个 Object3D 的 `castShadow` / `receiveShadow` 默认都是 `false`，
 * 只配置光源的 `castShadow` 是不会有任何影子的 —— 这正是"明明配好了阴影却一个都看不到"的经典原因
 * （本项目就踩过一次：光源侧开了，模型侧没开）。
 *
 * 只处理 Mesh / SkinnedMesh：点云与线（含"仅线框"的覆盖层）本就不该参与阴影。
 * 接收阴影让"部件之间的遮挡"（手臂落在躯干上）也成立，由此产生的自阴影条纹由
 * `shadow.normalBias` 抑制。
 *
 * @returns {{meshes: number}} 处理到的网格数
 */
export function enableModelShadows(root) {
  const report = { meshes: 0 }
  root?.traverse?.((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return
    node.castShadow = true
    node.receiveShadow = true
    report.meshes += 1
  })
  return report
}

/**
 * 只有主光投影：三盏灯都投影会让影子互相叠加、互相打架，反而看不清形体。
 */
export const SHADOW_LIGHT_ROLE = 'key'

/**
 * 阴影默认参数。
 * `mapSize` 是开销与清晰度的直接权衡（2048² 在 4K 视口下够用，再大收益很小）；
 * `bias` / `normalBias` 用来压掉自阴影产生的条纹（shadow acne）。
 */
export const SHADOW_DEFAULTS = {
  mapSize: 2048,
  bias: -0.0005,
  normalBias: 0.02,
}

/** 补全/收敛完整光照状态（按 key/fill/rim 顺序固定三盏） */
export function normalizeLightingState(state = {}) {
  const preset = resolvePreset(state.presetId)
  const ambientSource = state.ambient ?? preset?.ambient ?? {}
  const environmentSource = state.environment ?? preset?.environment ?? {}

  return {
    presetId: preset ? preset.id : state.presetId ?? DEFAULT_PRESET_ID,
    ambient: {
      enabled: ambientSource.enabled === undefined ? true : Boolean(ambientSource.enabled),
      intensity: clamp(ambientSource.intensity, LIGHT_LIMITS.ambientIntensity, 0.25),
      skyColor: normalizeColor(ambientSource.skyColor, '#ffffff'),
      groundColor: normalizeColor(ambientSource.groundColor, '#333344'),
    },
    lights: LIGHT_ROLES.map((role) => {
      const source = (state.lights ?? []).find((light) => light.role === role.id) ?? {}
      return normalizeLight(source, role.id)
    }),
    environment: {
      source: ENVIRONMENT_SOURCES.includes(environmentSource.source)
        ? environmentSource.source
        : 'gradient',
      intensity: clamp(environmentSource.intensity, LIGHT_LIMITS.environmentIntensity, 1),
      topColor: normalizeColor(environmentSource.topColor, '#e8edf5'),
      horizonColor: normalizeColor(environmentSource.horizonColor, '#b9c3d1'),
      bottomColor: normalizeColor(environmentSource.bottomColor, '#3a3f48'),
      // 用户导入的 HDR/EXR：名字用于回显；url 是本次运行可用的加载地址；
      // path 是桌面端复制进应用数据目录的副本路径（跨会话复现靠它）；
      // extension 决定用 RGBELoader 还是 EXRLoader（blob URL 上取不到扩展名）
      customHdrName: nonEmptyString(environmentSource.customHdrName),
      customHdrUrl: nonEmptyString(environmentSource.customHdrUrl),
      customHdrPath: nonEmptyString(environmentSource.customHdrPath),
      customHdrExtension: nonEmptyString(environmentSource.customHdrExtension),
    },
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value ? value : null
}

/**
 * 启动时读取设置用：导入的环境贴图只有在"存在应用数据目录副本"时才能跨会话复现。
 *
 * Web 端导入的只是 blob URL，刷新页面即失效；桌面端若副本被删掉也读不出来。
 * 这两种情况都退回程序化渐变，避免留下一个"界面显示已导入、实际没有环境"的假状态。
 */
export function degradeStaleImportedEnvironment(environment) {
  if (environment?.source !== 'imported') return environment
  if (environment.customHdrPath) return environment
  return {
    ...environment,
    source: 'gradient',
    customHdrName: null,
    customHdrUrl: null,
    customHdrExtension: null,
  }
}

/** 默认光照状态 = 内置「影棚」预设 */
export function createDefaultLightingState() {
  return normalizeLightingState({ presetId: DEFAULT_PRESET_ID })
}

/**
 * 主题载荷（存进 lighting_themes.payload）。
 * 除光照本身外还带上背景与色调，保证"应用主题 = 复现当时的整体观感"。
 */
export function createThemePayload({ lighting, background, render } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    lighting: normalizeLightingState(lighting),
    background: background && typeof background === 'object' ? { ...background } : { mode: 'solid', color: '#1b1e24' },
    render: render && typeof render === 'object' ? { ...render } : {},
  }
}

/**
 * 解析数据库里的主题载荷：兼容旧版本、拒绝垃圾数据。
 * @returns {{ok: boolean, payload: object|null, error?: string}}
 */
export function parseThemePayload(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, payload: null, error: '主题数据不是合法 JSON' }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, payload: null, error: '主题数据格式不正确' }
  }

  const version = Number(parsed.schemaVersion)
  if (Number.isFinite(version) && version > SCHEMA_VERSION) {
    return { ok: false, payload: null, error: `主题由更高版本（v${version}）保存，当前版本无法读取` }
  }

  return {
    ok: true,
    payload: createThemePayload({
      lighting: parsed.lighting ?? parsed,
      background: parsed.background,
      render: parsed.render,
    }),
  }
}

/**
 * 光照装置：持有三盏平行光与半球光，把状态映射到 three 对象。
 * 与 ShadeController/visibility 一样，只做"状态 → 对象"的映射，不持有业务状态。
 */
export class LightingRig {
  constructor(scene) {
    this.scene = scene
    this.hemisphere = new HemisphereLight(0xffffff, 0x333344, 0.25)
    this.hemisphere.name = 'mv-ambient'

    this.lights = new Map()
    for (const role of LIGHT_ROLES) {
      const light = new DirectionalLight(0xffffff, 1)
      light.name = `mv-light-${role.id}`
      this.lights.set(role.id, light)
    }

    for (const light of this.lights.values()) scene.add(light)
    scene.add(this.hemisphere)

    /**
     * 阴影默认关，且**只配在主光上**。
     *
     * 注意切换 `castShadow` 会改变 three 计算的 `numDirLightShadows`，而它是 program
     * cache key 的一部分（与 §36 里 light.visible 的问题同源）—— 所以拨动阴影开关会有
     * 一次性重编译，这是无法完全避免的；能避免的是**每帧重渲 shadow map**（见引擎侧
     * 的 shadowNeedsUpdate 标记，静态场景只在真的变了才重渲）。
     */
    this.shadowEnabled = false
    const keyLight = this.lights.get(SHADOW_LIGHT_ROLE)
    keyLight.castShadow = false
    keyLight.shadow.mapSize.set(SHADOW_DEFAULTS.mapSize, SHADOW_DEFAULTS.mapSize)
    keyLight.shadow.bias = SHADOW_DEFAULTS.bias
    keyLight.shadow.normalBias = SHADOW_DEFAULTS.normalBias
  }

  /**
   * 应用光照状态（幂等，可反复调用）。
   *
   * **关闭某盏灯用 `intensity = 0`，而不是 `visible = false`。**
   * three 的 `WebGLRenderer.projectObject` 会跳过 `visible === false` 的对象，该灯就不再
   * 进入 `lights.directional`；而 program cache key 里带着 `numDirLights`（见 WebGLPrograms），
   * 数量一变，**所有材质都要重新编译 shader** —— 表现为拨一次光源开关卡一下，材质越多越明显。
   * 改成 intensity = 0 后，着色器里的 color 已被乘成 0（WebGLLights 里
   * `uniforms.color.copy( light.color ).multiplyScalar( light.intensity )`），贡献同样是 0，
   * 视觉等价，但光源数量恒定，program key 不变，不再触发重编译。
   */
  apply(state) {
    const normalized = normalizeLightingState(state)

    this.hemisphere.visible = true
    this.hemisphere.intensity = normalized.ambient.enabled ? normalized.ambient.intensity : 0
    this.hemisphere.color.set(normalized.ambient.skyColor)
    this.hemisphere.groundColor.set(normalized.ambient.groundColor)

    for (const role of LIGHT_ROLES) {
      const light = this.lights.get(role.id)
      const config = normalized.lights.find((item) => item.role === role.id)
      light.visible = true
      light.intensity = config.enabled ? config.intensity : 0
      light.color.set(config.color)
      light.position.set(...computeLightPosition(config))
      light.updateMatrixWorld()
    }

    return normalized
  }

  /**
   * 开/关阴影（只作用于主光）。
   *
   * 幂等：重复设同一个值不会产生额外开销（three 的 program 参数没变就命中缓存），
   * 因此调用方可以放心地"每次都同步"，而不必自己判断有没有变化。
   * @returns {boolean} 当前状态
   */
  setShadowEnabled(enabled) {
    const next = Boolean(enabled)
    this.shadowEnabled = next
    const light = this.lights.get(SHADOW_LIGHT_ROLE)
    if (light) light.castShadow = next
    return next
  }

  /**
   * 按模型包围盒适配主光的阴影相机。
   *
   * 方向光的阴影相机是**正交相机**，范围写死会有两种典型故障：模型稍大就"影子缺一半"，
   * 反之模型只占贴图一小块、阴影边缘全是锯齿。所以模型一变（加载/摆放/轴向）就要重算。
   *
   * 刻意**不动 `light.target`**：它决定光照方向，改靶心等于悄悄改了打光（项目定位是忠实
   * 呈现模型，不该有这种意外变化）。代价是视锥要以原点为中心去覆盖"偏心的包围球"，
   * 因此范围要把中心偏移量算进去。
   *
   * @returns {{radius: number, extent: number, distance: number}|null}
   */
  fitShadowCamera(box) {
    const light = this.lights.get(SHADOW_LIGHT_ROLE)
    if (!light || !box || box.isEmpty?.()) return null

    const sphere = box.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 1e-3)
    const centerOffset = sphere.center.length()

    // 视锥中心在光照方向（指向原点）上，所以覆盖半径 = 包围球半径 + 球心偏离原点的量
    const span = radius + centerOffset
    const extent = span * 1.1
    const distance = Math.max(light.position.length(), extent)

    const camera = light.shadow.camera
    camera.left = -extent
    camera.right = extent
    camera.top = extent
    camera.bottom = -extent
    camera.near = Math.max(distance - span * 1.2, 0.01)
    camera.far = distance + span * 1.2
    camera.updateProjectionMatrix()

    return { radius: extent, extent, distance }
  }

  /**
   * 当前有几盏灯真的在贡献光照。
   * 判据用 `intensity > 0` 而非 `visible`：关闭的灯现在靠强度归零表达（见 apply）。
   */
  get enabledCount() {
    let count = 0
    for (const light of this.lights.values()) if (light.intensity > 0) count += 1
    return count
  }

  dispose() {
    for (const light of this.lights.values()) {
      light.removeFromParent()
      light.dispose?.()
    }
    this.lights.clear()
    this.hemisphere.removeFromParent()
    this.hemisphere.dispose?.()
  }
}

/** 便于测试/调试：把光照状态里的世界坐标都算出来 */
export function describeLightPositions(state) {
  const normalized = normalizeLightingState(state)
  return normalized.lights.map((light) => ({
    role: light.role,
    enabled: light.enabled,
    position: new Vector3(...computeLightPosition(light)),
    color: new Color(light.color),
  }))
}
