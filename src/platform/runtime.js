/**
 * 运行环境探测与能力声明。
 *
 * 同一份前端代码要同时跑在 Tauri 桌面壳与普通浏览器里，二者的能力差异集中在这里声明，
 * 其余模块只依赖这些标志，不再散落 `__TAURI_INTERNALS__` 判断。
 */

export const RUNTIME = {
  tauri: 'tauri',
  web: 'web',
}

/** Tauri 会注入 __TAURI_INTERNALS__；纯浏览器没有 */
export function detectRuntime() {
  if (typeof window === 'undefined') return RUNTIME.web
  return '__TAURI_INTERNALS__' in window ? RUNTIME.tauri : RUNTIME.web
}

export const runtime = detectRuntime()

export const isTauri = runtime === RUNTIME.tauri

/**
 * 本地文件能力矩阵：
 * - 桌面版：可以用系统对话框选路径、由 Rust 校验并授予 asset 协议读取权限、记录可重开的绝对路径；
 * - Web 版：只能拿到用户选择/拖入的 File 对象（blob），没有路径，也无法按路径重新打开。
 */
export const capabilities = {
  /** 能拿到文件绝对路径并交由后端授权 */
  pathAccess: isTauri,
  /** 能按路径重新打开历史记录 */
  reopenByPath: isTauri,
  /** 能把导入的环境贴图复制进应用数据目录（跨会话引用）；Web 端只有当次会话有效的 blob */
  persistImportedEnvironment: isTauri,
  /** 持久化后端：桌面用 SQLite，Web 用 localStorage */
  persistence: isTauri ? 'sqlite' : 'localStorage',
  /** 原生（系统层）拖放事件 */
  nativeDragDrop: isTauri,
  runtimeLabel: isTauri ? '桌面版' : 'Web 预览',
}
