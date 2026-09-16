/**
 * 引擎的挂载/卸载生命周期。
 * 组件卸载时务必销毁，否则 WebGL 上下文与显存资源会残留（热更新时尤其明显）。
 */

import { onBeforeUnmount, shallowRef } from 'vue'

import { ViewerEngine } from '../core/three/ViewerEngine.js'

export function useViewerEngine() {
  const engine = shallowRef(null)

  function mount(container, options) {
    unmount()
    engine.value = new ViewerEngine(container, options)
    return engine.value
  }

  function unmount() {
    if (engine.value) {
      engine.value.dispose()
      engine.value = null
    }
  }

  onBeforeUnmount(unmount)

  return { engine, mount, unmount }
}
