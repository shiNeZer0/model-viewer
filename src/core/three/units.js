/**
 * 长度单位换算与格式化（纯函数，可单测）。
 *
 * 背景：三维格式大多不带单位信息——STL/OBJ 的数值单位完全靠约定（毫米、米、英寸都有可能），
 * glTF 规范是米，3MF 通常是毫米。查看器无法自动猜到，因此策略是：
 * **让用户声明"这个模型的 1 个单位是什么"**，再把尺寸换算到易读的单位显示。
 *
 * `raw`（原始单位）的含义是"不做任何换算，直接显示文件里的数值"，
 * 这是默认值，也最不容易误导。
 */

export const LENGTH_UNITS = [
  { id: 'raw', label: '原始单位（不换算）', toMeters: 1, digits: 3 },
  { id: 'mm', label: '毫米 mm', toMeters: 0.001, digits: 2 },
  { id: 'cm', label: '厘米 cm', toMeters: 0.01, digits: 3 },
  { id: 'm', label: '米 m', toMeters: 1, digits: 4 },
  { id: 'in', label: '英寸 in', toMeters: 0.0254, digits: 3 },
]

/** 显示单位：auto 表示按数值大小自动挑选 */
export const DISPLAY_UNIT_IDS = ['auto', 'mm', 'cm', 'm', 'in']

export const DEFAULT_SOURCE_UNIT = 'raw'
export const DEFAULT_DISPLAY_UNIT = 'auto'
/** 声明了真实单位时，"原始单位"不再可选，可选项只剩物理单位 */
export const PHYSICAL_UNIT_IDS = ['mm', 'cm', 'm', 'in']

export function resolveUnit(unitId) {
  if (!unitId) return null
  return LENGTH_UNITS.find((unit) => unit.id === unitId) ?? null
}

/** 某单位下 1 个单位等于多少米 */
export function toMeters(value, unitId) {
  const unit = resolveUnit(unitId)
  if (!unit || !Number.isFinite(value)) return null
  return value * unit.toMeters
}

export function fromMeters(meters, unitId) {
  const unit = resolveUnit(unitId)
  if (!unit || !Number.isFinite(meters) || unit.toMeters === 0) return null
  return meters / unit.toMeters
}

/** 在声明单位与显示单位之间换算（纯数值） */
export function convertLength(value, { from = DEFAULT_SOURCE_UNIT, to = DEFAULT_DISPLAY_UNIT } = {}) {
  if (!Number.isFinite(value)) return null
  const meters = toMeters(value, from)
  if (meters === null) return null
  if (to === 'auto') return fromMeters(meters, autoPickUnit(meters))
  return fromMeters(meters, to)
}

/**
 * 按米的量级自动挑选显示单位：
 * < 1 cm → mm；< 1 m → cm；< 1000 m → m；否则 m（三维模型极少超过 1 km）。
 */
export function autoPickUnit(meters) {
  if (!Number.isFinite(meters) || meters === 0) return 'mm'
  const abs = Math.abs(meters)
  if (abs < 0.01) return 'mm'
  if (abs < 1) return 'cm'
  return 'm'
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) return '—'
  // 极小值不要退化成 0.00
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return value.toExponential(2)
  return value.toFixed(digits)
}

/**
 * 把原始数值格式化成"带单位"的可读文本。
 * @returns {{value: number|null, unit: string, text: string, converted: boolean}}
 */
export function formatLength(
  value,
  { sourceUnit = DEFAULT_SOURCE_UNIT, displayUnit = DEFAULT_DISPLAY_UNIT } = {},
) {
  if (!Number.isFinite(value)) {
    return { value: null, unit: '', text: '—', converted: false }
  }

  // 未声明单位：原样显示，不做任何换算（避免给出虚假精度）
  if (sourceUnit === DEFAULT_SOURCE_UNIT || !resolveUnit(sourceUnit)) {
    return {
      value,
      unit: '单位',
      text: `${formatNumber(value, resolveUnit('raw').digits)}（原始单位）`,
      converted: false,
    }
  }

  const meters = toMeters(value, sourceUnit)
  const targetId = displayUnit === 'auto' ? autoPickUnit(meters) : displayUnit
  const converted = fromMeters(meters, targetId)
  const unit = resolveUnit(targetId)

  return {
    value: converted,
    unit: targetId,
    text: `${formatNumber(converted, unit?.digits ?? 3)} ${targetId}`,
    converted: true,
  }
}
