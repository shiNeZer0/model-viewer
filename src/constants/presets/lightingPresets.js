/**
 * 内置光照预设（纯数据，可单测）。
 *
 * 每个预设是一份完整的"观感快照"：三点光源 + 环境 + 背景 + 色调。
 * 之所以把 render/background 也放进预设：用户切换"影棚/黄昏"时期待的是**整体观感**变化，
 * 而不是只有灯变了、背景和曝光还是上一套。
 *
 * 这些预设写在代码里而不是数据库里：便于随版本调优，也避免内置项被用户误删。
 * 用户自定义的"主题"另存到 lighting_themes 表。
 */

/** 预设引用的环境类型：gradient=程序化渐变；room=RoomEnvironment；none=不用环境贴图 */
export const ENVIRONMENT_SOURCES = ['gradient', 'room', 'none']

export const LIGHTING_PRESETS = [
  {
    id: 'studio',
    label: '影棚',
    description: '中性白、三点布光 + RoomEnvironment，最接近产品图的观感',
    ambient: { enabled: true, intensity: 0.25, skyColor: '#ffffff', groundColor: '#2f3038' },
    lights: [
      { role: 'key', enabled: true, intensity: 2.6, color: '#ffffff', azimuth: 35, elevation: 40, radius: 10 },
      { role: 'fill', enabled: true, intensity: 0.9, color: '#dfe8ff', azimuth: -120, elevation: 12, radius: 10 },
      { role: 'rim', enabled: true, intensity: 1.4, color: '#fff3e0', azimuth: 175, elevation: 28, radius: 10 },
    ],
    environment: { source: 'room', intensity: 1, topColor: '#e8edf5', horizonColor: '#b9c3d1', bottomColor: '#3a3f48' },
    background: { mode: 'gradient', gradientTop: '#2f3540', gradientBottom: '#0d0f13' },
    render: { toneMapping: 'neutral', exposure: 1, saturation: 1 },
  },
  {
    id: 'sunset',
    label: '黄昏',
    description: '低角度暖光 + 冷色补光，强调体积与轮廓',
    ambient: { enabled: true, intensity: 0.2, skyColor: '#ffd9a8', groundColor: '#2a2233' },
    lights: [
      { role: 'key', enabled: true, intensity: 3.2, color: '#ffb26b', azimuth: 65, elevation: 8, radius: 12 },
      { role: 'fill', enabled: true, intensity: 0.7, color: '#7fa8ff', azimuth: -140, elevation: 15, radius: 12 },
      { role: 'rim', enabled: true, intensity: 1.8, color: '#ffd9a8', azimuth: -170, elevation: 22, radius: 12 },
    ],
    environment: { source: 'gradient', intensity: 1.15, topColor: '#4a6fa5', horizonColor: '#ffd9a8', bottomColor: '#2a2233' },
    background: { mode: 'gradient', gradientTop: '#3b4a6b', gradientBottom: '#c98a5b' },
    render: { toneMapping: 'agx', exposure: 1.05, saturation: 1.1 },
  },
  {
    id: 'forest',
    label: '森林',
    description: '绿色环境光 + 柔和顶光，像在树荫下看模型',
    ambient: { enabled: true, intensity: 0.4, skyColor: '#cfe8c8', groundColor: '#2b3a26' },
    lights: [
      { role: 'key', enabled: true, intensity: 2.1, color: '#e8ffd9', azimuth: -25, elevation: 62, radius: 10 },
      { role: 'fill', enabled: true, intensity: 0.8, color: '#9fd0a0', azimuth: 120, elevation: 20, radius: 10 },
      { role: 'rim', enabled: true, intensity: 1.1, color: '#d8ffcf', azimuth: -160, elevation: 35, radius: 10 },
    ],
    environment: { source: 'gradient', intensity: 1.2, topColor: '#dff0d8', horizonColor: '#7fae76', bottomColor: '#26331f' },
    background: { mode: 'gradient', gradientTop: '#3a4a37', gradientBottom: '#131a11' },
    render: { toneMapping: 'neutral', exposure: 1, saturation: 1.05 },
  },
  {
    id: 'panorama',
    label: '全景',
    description: '把环境贴图直接当作背景（天空盒效果），便于观察反射',
    ambient: { enabled: false, intensity: 0, skyColor: '#ffffff', groundColor: '#333344' },
    lights: [
      { role: 'key', enabled: true, intensity: 1.8, color: '#ffffff', azimuth: 40, elevation: 35, radius: 10 },
      { role: 'fill', enabled: true, intensity: 0.6, color: '#cfe3ff', azimuth: -130, elevation: 10, radius: 10 },
      { role: 'rim', enabled: false, intensity: 1, color: '#ffffff', azimuth: 180, elevation: 25, radius: 10 },
    ],
    environment: { source: 'gradient', intensity: 1.3, topColor: '#cfe0f5', horizonColor: '#9fb2c8', bottomColor: '#4a5560' },
    background: { mode: 'environment' },
    render: { toneMapping: 'neutral', exposure: 1, saturation: 1 },
  },
  {
    id: 'none',
    label: '无环境',
    description: '关闭环境贴图，只用三点光源，便于检查几何与法线',
    ambient: { enabled: false, intensity: 0, skyColor: '#ffffff', groundColor: '#333344' },
    lights: [
      { role: 'key', enabled: true, intensity: 2.4, color: '#ffffff', azimuth: 35, elevation: 45, radius: 10 },
      { role: 'fill', enabled: true, intensity: 0.8, color: '#cfe3ff', azimuth: -120, elevation: 15, radius: 10 },
      { role: 'rim', enabled: true, intensity: 1.2, color: '#ffe6c7', azimuth: 180, elevation: 30, radius: 10 },
    ],
    environment: { source: 'none', intensity: 0, topColor: '#808080', horizonColor: '#808080', bottomColor: '#808080' },
    background: { mode: 'solid', color: '#1b1e24' },
    render: { toneMapping: 'none', exposure: 1, saturation: 1 },
  },
]

export const DEFAULT_PRESET_ID = 'studio'

export function resolvePreset(presetId) {
  if (!presetId) return null
  return LIGHTING_PRESETS.find((preset) => preset.id === presetId) ?? null
}

/** 深拷贝成可编辑状态，避免后续改动污染预设常量 */
export function presetToState(preset) {
  if (!preset) return null
  return {
    presetId: preset.id,
    ambient: { ...preset.ambient },
    lights: preset.lights.map((light) => ({ ...light })),
    environment: { ...preset.environment },
  }
}
