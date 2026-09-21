/**
 * FBX 兼容性兜底与诊断。
 *
 * 为什么需要单独一个模块：three 的 FBXLoader 对很多情况是**静默降级** —— 只在 `console.warn`
 * 一句（"不支持的贴图类型""多层贴图只留第一层""一个骨骼挂多个几何体""Z-up 已自动旋转"……），
 * 界面上没有任何反馈，用户只会觉得"这个文件打开得不对"。这里把那些降级翻译成界面提示，
 * 并补上 three 不做或没告诉用户的三件事：
 *   1. FBX 声明的单位（`UnitScaleFactor`）→ 预选「模型单位」，解决"尺寸明显不对"；
 *   2. 没有可用材质 / 纯黑材质的网格 → 套默认黏土材质，解决"一片黑"；
 *   3. 加载失败时的中文解释（FBX 6.x 直接被 loader 拒绝）。
 *
 * 除 `collectLoaderWarnings` 会临时接管 `console.warn`（并在 finally 里还原）外全是纯函数，
 * 因此可以在 Node 下完整单测。
 */

import { rawErrorMessage } from '../../utils/error-messages.js'
import { createDefaultMaterial } from './materialNormalizer.js'

/** three 的 FBXLoader 告警前缀（不同版本略有差别，两个都认） */
export const FBX_WARNING_PREFIXES = ['THREE.FBXLoader', 'FBXLoader']
/** 同类告警最多上报几条：一张 FBX 的贴图告警可能刷几十条，界面只要"有这些情况" */
export const MAX_FBX_WARNINGS = 8
/** 判定"看起来是黑的"的阈值（线性空间的分量上界） */
const NEAR_BLACK = 0.02

/** 已知告警的翻译表：命中则给出人话，并去掉 loader 前缀 */
const WARNING_TRANSLATIONS = [
  {
    match: /Z-UP coordinate system/i,
    text: '该文件声明为 Z-up 坐标系：加载器已把整个场景旋转成 Y-up（顶点数据未改写），朝向按此处理',
  },
  {
    match: /layered textures are not supported/i,
    text: '文件里有多层贴图（layered textures）：three 不支持，只保留了第一层',
  },
  {
    match: /(\w+) map is not supported in three\.js, skipping texture/i,
    text: (matched) => `贴图通道「${matched[1]}」three 不支持，已跳过该贴图`,
  },
  {
    match: /skeleton attached to more than one geometry is not supported/i,
    text: '一个骨骼被多个几何体共用：three 不支持这种绑定，蒙皮可能显示异常',
  },
  {
    match: /image type "?([\w.]+)"? is not supported/i,
    text: (matched) => `图片格式「${matched[1]}」不受支持，该贴图已跳过`,
  },
]

/**
 * 把 loader 的告警原文整理成人话（纯函数）。
 * 命中翻译表就给中文说明，否则原样返回去掉前缀的文案 —— 绝不吞掉信息。
 */
export function cleanFbxWarning(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  const body = raw.replace(/^(THREE\.)?FBXLoader:\s*/i, '')

  for (const rule of WARNING_TRANSLATIONS) {
    const matched = rule.match.exec(body)
    if (!matched) continue
    return typeof rule.text === 'function' ? rule.text(matched) : rule.text
  }
  return body
}

/**
 * 在执行 `run()` 期间接管 `console.warn`，把 FBXLoader 的告警收集成界面提示。
 *
 * 只能这么做的原因：这些降级发生在 loader 内部，既不返回也不抛错。
 * 注意两点：① 非 FBXLoader 的日志照旧输出；② **无论成功还是抛错都必须还原 console.warn**，
 * 否则全局日志会被永久劫持。
 *
 * @param {() => Promise<any>} run 真正执行加载的回调
 * @returns {Promise<{result: any, warnings: string[]}>}
 */
export async function collectLoaderWarnings(
  run,
  { prefixes = FBX_WARNING_PREFIXES, max = MAX_FBX_WARNINGS } = {},
) {
  if (typeof run !== 'function') throw new Error('collectLoaderWarnings 需要一个回调')
  const original = console.warn
  const warnings = []
  const seen = new Set()

  console.warn = (...args) => {
    const text = args.filter((arg) => typeof arg === 'string').join(' ')
    if (text && prefixes.some((prefix) => text.includes(prefix))) {
      const cleaned = cleanFbxWarning(text)
      // 去重 + 限流：同一张贴图类型可能刷很多条
      if (cleaned && !seen.has(cleaned) && warnings.length < max) {
        seen.add(cleaned)
        warnings.push(cleaned)
      }
      return // 已经上报到界面，不必再刷控制台
    }
    original.apply(console, args)
  }

  try {
    const result = await run()
    return { result, warnings }
  } finally {
    console.warn = original
  }
}

/**
 * 从加载结果里读 FBX 的单位系数。
 *
 * three 把它写在 `sceneGraph.userData.unitScaleFactor` 上，但 `parseScene` 中途会把"只有单个分组"
 * 的场景 unwrap 一层，所以这里做浅层兜底（根对象找不到就看它的直接子节点）。
 */
export function readFbxUnitScale(root) {
  const candidates = [root, ...(Array.isArray(root?.children) ? root.children : [])]
  for (const node of candidates) {
    const value = node?.userData?.unitScaleFactor
    if (Number.isFinite(value)) return value
  }
  return null
}

/** FBX 的 UnitScaleFactor 是"1 个 FBX 单位等于多少厘米"，据此映射到本项目的模型单位 */
const UNIT_BY_SCALE = [
  { scale: 1, label: '厘米（cm）', sourceUnit: 'cm' },
  { scale: 10, label: '毫米（mm）', sourceUnit: 'mm' },
  { scale: 100, label: '米（m）', sourceUnit: 'm' },
  { scale: 2.54, label: '英寸（in）', sourceUnit: 'in' },
]

/**
 * 单位系数 → `{ label, sourceUnit, hint }`；识别不了返回 null（**不猜**：宁可不提示，
 * 也不要给用户一个错的换算）。
 */
export function describeFbxUnit(unitScaleFactor) {
  const value = Number.isFinite(unitScaleFactor) ? unitScaleFactor : null
  if (value === null) return null

  for (const entry of UNIT_BY_SCALE) {
    // 浮点比较：2.54 这类值要留容差
    if (Math.abs(value - entry.scale) < 1e-6) {
      return {
        label: entry.label,
        sourceUnit: entry.sourceUnit,
        hint: `该文件以${entry.label}为单位（FBX UnitScaleFactor=${value}），已预选「模型信息 → 模型单位」`,
      }
    }
  }
  return null
}

/**
 * 判定一个材质是否"不可用"：没有材质、或既没有贴图又是纯黑的颜色。
 * 纯白不算 —— 那是正常的默认材质；PBR(Stingray) 材质在 three 里解析不出来时恰恰表现为纯黑。
 */
export function isUnusableMaterial(material) {
  if (!material) return true
  if (material.map || material.emissiveMap || material.vertexColors) return false
  const color = material.color
  if (!color) return false
  return color.r <= NEAR_BLACK && color.g <= NEAR_BLACK && color.b <= NEAR_BLACK
}

/**
 * 给"没有可用材质"的网格套上默认黏土材质（three 的 FBX 只支持 Lambert/Phong，
 * PBR 材质会解析成纯黑，看起来像"模型坏了"）。
 * 数组材质只有在**全部**不可用时才替换，避免破坏部分正确的材质。
 * @returns {{replaced: number}}
 */
export function ensureUsableMaterials(root) {
  let replaced = 0
  root?.traverse?.((node) => {
    if (!node.isMesh) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    if (!materials.every(isUnusableMaterial)) return
    node.material = createDefaultMaterial()
    replaced += 1
  })
  return { replaced }
}

/**
 * 把 FBX 相关的失败原因翻译成可操作的中文说明（纯函数）。
 * 最典型的是旧版 FBX：`FBXLoader` 对 `FileVersion < 7000` 直接抛错。
 */
export function describeFbxError(error) {
  const message = rawErrorMessage(error)

  const version = /FBX version not supported,?\s*FileVersion:?\s*(\d+)/i.exec(message)
  if (version) {
    return `该 FBX 版本过旧（FileVersion ${version[1]}，低于 7.0）：three 的加载器不支持，请在导出器里另存为 FBX 7.4 / 7.5 后重试`
  }
  if (/FBXLoader.*(not a binary FBX|not an ascii FBX)/i.test(message)) {
    return `文件既不是二进制也不是 ASCII FBX（可能已损坏、被加密或只是扩展名为 .fbx）：${message}`
  }
  if (/Unexpected end of|Array buffer allocation failed|Invalid typed array/i.test(message)) {
    return `文件似乎不完整或已损坏（读取时提前结束）：${message}`
  }
  return message
}
