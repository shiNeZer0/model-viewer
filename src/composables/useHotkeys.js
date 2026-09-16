/**
 * 键盘快捷键（M1：视图与显示相关的常用操作）。
 *
 * 纯逻辑（按键判定与映射）抽成可单测的函数，组合式只负责挂/卸监听。
 */

import { onBeforeUnmount, onMounted } from 'vue'

/** 焦点在输入类控件里时不应触发快捷键 */
export function isTypingTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tagName = String(target.tagName ?? '').toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

/**
 * 从事件里解析出要执行的处理器。
 * @param {Record<string, Function>} handlers 形如 { f: fn, '1': fn }
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, target?: object}} event
 * @returns {Function|null}
 */
export function resolveHotkey(handlers, event) {
  if (!handlers || !event || typeof event.key !== 'string') return null
  // 带修饰键的组合留给系统/浏览器，避免抢占 Ctrl+F 这类原生快捷键
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (isTypingTarget(event.target)) return null

  const key = event.key
  return handlers[key] ?? handlers[key.toLowerCase()] ?? null
}

/**
 * 注册全局快捷键。
 * @param {Record<string, Function>} handlers 键名（小写即可）→ 处理函数
 * @param {{enabled?: () => boolean}} options
 */
export function useHotkeys(handlers, { enabled = () => true } = {}) {
  function onKeydown(event) {
    if (!enabled()) return
    const handler = resolveHotkey(handlers, event)
    if (!handler) return
    event.preventDefault()
    handler(event)
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
