/**
 * Three.js 渲染引擎封装（纯 JS 类，刻意不放进 Vue 响应式系统）。
 *
 * 为什么要独立成类：
 * 1. renderer / scene / camera 都是重对象，被 Vue 深度代理后性能会明显下降；
 * 2. 生命周期（创建、resize、销毁、上下文丢失）需要集中管理，避免组件里散落副作用；
 * 3. 便于在 Node 之外用真实浏览器做冒烟验证。
 */

import {
  Box3,
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { disposeObject3D } from './disposal.js'

export const DEFAULT_BACKGROUND = 0x1b1e24
const FPS_SAMPLE_INTERVAL_MS = 500

export class ViewerEngine {
  constructor(container, { maxPixelRatio = 2, onFps, onContextLost } = {}) {
    if (!container) throw new Error('ViewerEngine 需要一个容器元素')

    this.container = container
    this.maxPixelRatio = maxPixelRatio
    this.onFps = onFps
    this.onContextLost = onContextLost

    this.currentRoot = null
    this.lastDisposal = null
    this.disposed = false
    this.frameHandle = null
    this.fps = 0

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.canvas = this.renderer.domElement
    this.canvas.classList.add('mv-canvas')

    this.scene = new Scene()
    this.scene.background = new Color(DEFAULT_BACKGROUND)

    this.camera = new PerspectiveCamera(50, 1, 0.01, 1000)
    this.camera.position.set(3, 2.2, 3.4)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.autoRotateSpeed = 2

    // M0 的最小照明：没有它，自带材质的 GLB 会一片黑。
    // M3 的光照模块会接管这里（三点光源 + 环境贴图 + 预设）。
    this.lights = []
    const hemisphere = new HemisphereLight(0xffffff, 0x333344, 1.6)
    const keyLight = new DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 6, 5)
    const fillLight = new DirectionalLight(0xcfe3ff, 0.8)
    fillLight.position.set(-5, 1.5, -3)
    this.lights.push(hemisphere, keyLight, fillLight)
    this.lights.forEach((light) => this.scene.add(light))

    container.appendChild(this.canvas)

    this.fpsSampleStart = performance.now()
    this.fpsFrameCount = 0

    // 全屏切换改变的是容器尺寸而非 window，只看 window.resize 会导致画布不铺满
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)
    this.handleResize()

    this.contextLostHandler = (event) => {
      // 阻止默认行为才能拿到「可恢复」的上下文
      event.preventDefault()
      console.error('[ViewerEngine] WebGL 上下文丢失')
      this.onContextLost?.()
    }
    this.canvas.addEventListener('webglcontextlost', this.contextLostHandler, false)

    this.clock = new Clock()
    this.start()
  }

  start() {
    if (this.disposed || this.frameHandle !== null) return
    const tick = () => {
      this.frameHandle = requestAnimationFrame(tick)
      this.clock.getDelta()
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
      this.sampleFps()
    }
    this.frameHandle = requestAnimationFrame(tick)
  }

  stop() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle)
      this.frameHandle = null
    }
  }

  renderOnce() {
    if (this.disposed) return
    this.renderer.render(this.scene, this.camera)
  }

  sampleFps() {
    this.fpsFrameCount += 1
    const now = performance.now()
    const elapsed = now - this.fpsSampleStart
    if (elapsed < FPS_SAMPLE_INTERVAL_MS) return
    this.fps = Math.round((this.fpsFrameCount * 1000) / elapsed)
    this.fpsSampleStart = now
    this.fpsFrameCount = 0
    this.onFps?.(this.fps)
  }

  handleResize() {
    if (this.disposed) return
    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio))
    // updateStyle=false：画布尺寸交给 CSS（100%/100%），避免内联样式与布局打架
    this.renderer.setSize(width, height, false)
  }

  setMaxPixelRatio(maxPixelRatio) {
    this.maxPixelRatio = maxPixelRatio
    this.handleResize()
  }

  setAutoRotate(enabled, speed) {
    this.controls.autoRotate = Boolean(enabled)
    if (typeof speed === 'number') this.controls.autoRotateSpeed = speed
  }

  /**
   * 替换当前模型，并释放上一个模型占用的 GPU 资源。
   * @returns {{disposal: object|null, fit: object|null}}
   */
  setModel(root, { fit = true } = {}) {
    let disposal = null
    if (this.currentRoot) {
      this.scene.remove(this.currentRoot)
      disposal = disposeObject3D(this.currentRoot)
      this.lastDisposal = disposal
      console.info('[ViewerEngine] 已释放上一个模型', disposal)
    }

    this.currentRoot = root ?? null
    if (this.currentRoot) this.scene.add(this.currentRoot)

    const fitResult = fit && this.currentRoot ? this.fitToObject(this.currentRoot) : null
    this.renderOnce()
    return { disposal, fit: fitResult }
  }

  clearModel() {
    return this.setModel(null, { fit: false })
  }

  /**
   * 把相机拉到能完整看到对象的距离。
   * 距离按包围球半径与竖直视角的一半计算，再乘 1.25 留出边距。
   */
  fitToObject(object = this.currentRoot, { padding = 1.25 } = {}) {
    if (!object) return null

    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return null

    const sphere = box.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 1e-6)
    const verticalFov = (this.camera.fov * Math.PI) / 180
    // 水平方向更窄时以水平视角为准，宽高比 < 1 的窗口才不会被裁切
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect)
    const limitingFov = Math.min(verticalFov, horizontalFov)
    const distance = (radius / Math.sin(limitingFov / 2)) * padding

    const direction = new Vector3(1, 0.62, 1).normalize()
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance)
    this.camera.near = Math.max(distance / 1000, 1e-4)
    this.camera.far = distance + radius * 20
    this.camera.updateProjectionMatrix()

    this.controls.target.copy(sphere.center)
    this.controls.update()

    return { box, sphere, distance }
  }

  /** 渲染器与 GPU 信息，供状态栏与排障使用 */
  getRendererInfo() {
    const context = this.renderer.getContext()
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info')
    return {
      gpu: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '未知',
      webglVersion: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.contextLostHandler)
    this.controls.dispose()

    if (this.currentRoot) {
      this.scene.remove(this.currentRoot)
      disposeObject3D(this.currentRoot)
      this.currentRoot = null
    }

    this.renderer.dispose()
    this.canvas.remove()
  }
}
