/**
 * 标准视图预设与相机定位计算（纯函数，可单测）。
 *
 * 把「方向 + 距离」的算法从 ViewerEngine 里抽出来，一方面便于验证
 * （宽高比、退化方向这些边界最容易出错），另一方面让 M2 的「聚焦选中」复用同一套数学。
 */

/**
 * direction 是「相机相对包围球中心」的单位方向。
 * 顶/底视图刻意带一点 Z 偏移：相机方向与 up 向量平行时 OrbitControls 会退化成万向锁。
 */
export const VIEW_PRESETS = [
  { id: 'front', label: '前视图', direction: [0, 0, 1] },
  { id: 'back', label: '后视图', direction: [0, 0, -1] },
  { id: 'left', label: '左视图', direction: [-1, 0, 0] },
  { id: 'right', label: '右视图', direction: [1, 0, 0] },
  { id: 'top', label: '顶视图', direction: [0, 1, 0.0001] },
  { id: 'bottom', label: '底视图', direction: [0, -1, 0.0001] },
  { id: 'iso', label: '等轴测', direction: [1, 0.62, 1] },
]

export const DEFAULT_VIEW_PRESET = 'iso'

export function resolveViewPreset(presetId) {
  if (!presetId) return null
  return VIEW_PRESETS.find((preset) => preset.id === presetId) ?? null
}

/** 归一化方向；零向量或非法输入回退到等轴测方向，避免出现 NaN 相机坐标 */
export function normalizeDirection(direction) {
  const fallback = [1, 0.62, 1]
  const source = Array.isArray(direction) && direction.length === 3 ? direction : fallback
  const [x, y, z] = source.map((value) => (Number.isFinite(value) ? value : 0))
  const length = Math.hypot(x, y, z)
  if (!length) return normalizeDirection(fallback)
  return [x / length, y / length, z / length]
}

/** 竖直视角的兜底值（相机 fov 未传入时使用） */
export const DEFAULT_FOV_DEG = 50

/**
 * 相机到包围球中心的最小距离：取水平/垂直视角中较小者，
 * 这样窄窗口（aspect < 1）里模型也不会被裁掉两侧。
 * 非法 fov（undefined/NaN/0/负数）回退到 50°，否则会算出 NaN 相机坐标。
 */
export function computeViewDistance(radius, fovDeg = DEFAULT_FOV_DEG, aspect = 1, padding = 1.25) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1e-3
  const safePadding = Number.isFinite(padding) && padding > 0 ? padding : 1
  const safeFov =
    Number.isFinite(fovDeg) && fovDeg > 0 && fovDeg < 180 ? fovDeg : DEFAULT_FOV_DEG
  const verticalFov = (safeFov * Math.PI) / 180
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect)
  const limitingFov = Math.min(verticalFov, horizontalFov)
  return (safeRadius / Math.sin(limitingFov / 2)) * safePadding
}

/**
 * 计算某个预设下相机的落点。
 * @param {{center: number[]|{x:number,y:number,z:number}, radius: number, fovDeg?: number, aspect?: number, presetId?: string, padding?: number}} options
 * @returns {{position: [number,number,number], distance: number, presetId: string}}
 */
export function computeCameraPlacement({
  center,
  radius,
  fovDeg = DEFAULT_FOV_DEG,
  aspect = 1,
  presetId = DEFAULT_VIEW_PRESET,
  padding = 1.25,
} = {}) {
  const preset = resolveViewPreset(presetId) ?? resolveViewPreset(DEFAULT_VIEW_PRESET)
  const direction = normalizeDirection(preset.direction)
  const distance = computeViewDistance(radius, fovDeg, aspect, padding)

  const centerX = Number.isFinite(center?.x) ? center.x : Array.isArray(center) ? center[0] : 0
  const centerY = Number.isFinite(center?.y) ? center.y : Array.isArray(center) ? center[1] : 0
  const centerZ = Number.isFinite(center?.z) ? center.z : Array.isArray(center) ? center[2] : 0

  return {
    position: [
      centerX + direction[0] * distance,
      centerY + direction[1] * distance,
      centerZ + direction[2] * distance,
    ],
    distance,
    presetId: preset.id,
  }
}
