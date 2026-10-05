/**
 * 内置全景环境贴图（2:1 等距柱状 HDR）。
 *
 * 这些文件随应用分发（放在 `public/hdr/`，会被 vite 原样复制进 `dist`，进而打进安装包），
 * 因此**文件名刻意使用 ASCII**：运行时要通过 URL 取，而非 ASCII 路径在自定义协议
 * （`tauri.localhost`）与"部署在子路径"两种情况下都出过问题；界面显示的 `label` 仍是中文。
 *
 * 素材来自 `assets/hdr/` 的原始全景图，统一缩放到 1600×800（见设计文档 §45）。
 */

/** 内置贴图目录（相对站点根，运行时按 URL 取） */
export const BUILTIN_ENVIRONMENT_DIR = 'hdr/'

/**
 * 内置贴图清单。
 * `id` 会被持久化进设置（`environment.builtinId`），**改名即等于破坏已有设置**，不要随意动。
 */
export const BUILTIN_ENVIRONMENTS = [
  { id: 'studio-1', label: '灯光室 1', file: 'studio-1.hdr' },
  { id: 'studio-2', label: '灯光室 2', file: 'studio-2.hdr' },
  { id: 'studio-white-black', label: '灯光室 · 白黑', file: 'studio-white-black.hdr' },
  { id: 'studio-white-blue', label: '灯光室 · 白蓝', file: 'studio-white-blue.hdr' },
  { id: 'studio-blue-red', label: '灯光室 · 蓝红', file: 'studio-blue-red.hdr' },
  { id: 'neighbor', label: '隔壁', file: 'neighbor.hdr' },
  { id: 'mountain', label: '山地', file: 'mountain.hdr' },
  { id: 'stone-forest', label: '石林', file: 'stone-forest.hdr' },
]

/** 默认选中的内置贴图（用户第一次切到「内置」时用它，避免出现空选择） */
export const DEFAULT_BUILTIN_ENVIRONMENT_ID = BUILTIN_ENVIRONMENTS[0].id

/** id → 清单项；找不到返回 null（设置里可能残留旧 id，绝不抛错） */
export function resolveBuiltinEnvironment(id) {
  if (!id) return null
  return BUILTIN_ENVIRONMENTS.find((item) => item.id === id) ?? null
}

/** 内置贴图的显示名；找不到时回退到 id，避免界面出现空白 */
export function builtinEnvironmentLabel(id) {
  return resolveBuiltinEnvironment(id)?.label ?? id ?? ''
}

/**
 * 内置贴图的**绝对 URL**。
 *
 * 必须是绝对 URL：Tauri 的 `tauri.localhost` 与"部署在子路径"都会让相对路径解析到错误位置
 * （与 `ModelLoader` 里解码器路径同一套理由）。用 `document.baseURI` 推导，两种部署都成立。
 *
 * @returns {string|null} 非 ASCII、找不到 id、或没有 document 时返回 null
 */
export function builtinEnvironmentUrl(id) {
  const entry = resolveBuiltinEnvironment(id)
  if (!entry) return null
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
  try {
    return new URL(`${BUILTIN_ENVIRONMENT_DIR}${entry.file}`, base).href
  } catch {
    return null
  }
}
