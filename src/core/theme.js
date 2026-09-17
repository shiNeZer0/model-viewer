/**
 * 明暗主题（M6 前的界面补充）。
 *
 * Element Plus 的暗色机制就是「在 <html> 上加/去 `dark` 类」+ 已引入的 `dark/css-vars.css`，
 * 所以这里只做三件事：把设置解析成具体主题、把类名落到 DOM、以及跟随系统时监听变化。
 *
 * 与 3D 视口的约定（用户确认）：**UI 跟随明暗，3D 视口背景不跟随**——
 * 视口背景仍由「显示 → 背景」控制并默认深色，理由见设计文档；
 * 因此 canvas 相关底色保持硬编码深色，不接入主题。
 */

export const THEME_MODES = [
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
  { id: 'system', label: '跟随系统' },
]

export const DEFAULT_THEME_MODE = 'dark'

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveThemeMode(modeId) {
  if (!modeId) return DEFAULT_THEME_MODE
  return THEME_MODES.some((mode) => mode.id === modeId) ? modeId : DEFAULT_THEME_MODE
}

/** 设置 + 系统偏好 → 实际生效的主题（纯函数） */
export function resolveTheme(modeId, prefersDark = false) {
  const mode = resolveThemeMode(modeId)
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

/**
 * 把主题落到 DOM：切换 `dark` 类，并同步 `color-scheme`
 * （后者让原生滚动条、表单控件、系统对话框跟随，否则亮色下会出现深色滚动条）。
 * @returns {boolean} 是否成功应用（无 document 时返回 false，便于测试与 SSR）
 */
export function applyTheme(theme, doc = globalThis.document) {
  const root = doc?.documentElement
  if (!root) return false
  const isDark = theme === 'dark'
  root.classList.toggle('dark', isDark)
  if (root.style) root.style.colorScheme = isDark ? 'dark' : 'light'
  return true
}

/** 当前系统是否偏好深色 */
export function systemPrefersDark(target = globalThis) {
  return Boolean(target?.matchMedia?.(SYSTEM_DARK_QUERY)?.matches)
}

/**
 * 监听系统主题变化。
 * @returns {() => void} 取消监听（环境不支持时返回空函数，调用方无需判空）
 */
export function createSystemThemeWatcher({ onChange, target = globalThis } = {}) {
  const query = target?.matchMedia?.(SYSTEM_DARK_QUERY)
  if (!query?.addEventListener) return () => {}

  const handler = (event) => onChange?.(Boolean(event.matches))
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}
