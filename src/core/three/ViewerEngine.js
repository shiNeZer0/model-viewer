/**
 * Three.js 渲染引擎封装（纯 JS 类，刻意不放进 Vue 响应式系统）。
 *
 * M1 起它同时承担：渲染循环与空闲停渲染、相机控制与视图预设、着色模式、
 * 背景/网格/坐标轴、后处理（色调映射/曝光/饱和度）。所有可测的算法都抽到了
 * 独立模块（viewPresets / shadeModes / postfx / idlePolicy / stage），这里只做编排。
 */

import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import { disposeObject3D } from './disposal.js'
import { DEFAULT_IDLE_MS, createIdlePolicy, hasContinuousWork } from './idlePolicy.js'
import { PostFx, normalizePostFxSettings } from './postfx.js'
import { createRenderLoop } from './renderLoop.js'
import { DEFAULT_SHADE_MODE, ShadeController } from './shadeModes.js'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_GRADIENT_BOTTOM,
  DEFAULT_GRADIENT_TOP,
  Stage,
} from './stage.js'
import { DEFAULT_VIEW_PRESET, computeCameraPlacement } from './viewPresets.js'

const FPS_SAMPLE_INTERVAL_MS = 500

export class ViewerEngine {
  constructor(container, options = {}) {
    if (!container) throw new Error('ViewerEngine 需要一个容器元素')

    this.container = container
    this.maxPixelRatio = options.maxPixelRatio ?? 2
    this.onFps = options.onFps
    this.onContextLost = options.onContextLost

    this.currentRoot = null
    this.shadeController = null
    this.lastDisposal = null
    this.lastBox = null
    this.lastPresetId = DEFAULT_VIEW_PRESET
    this.animationPlaying = false
    this.disposed = false
    this.fps = 0
    this.onRenderError = options.onRenderError
    /** 渲染失败信息（非空表示画面可能不完整，UI 需要展示） */
    this.renderError = null
    /** 成功渲染的帧数：0 表示渲染循环从未真正出图，是排障的关键指标 */
    this.renderedFrames = 0

    const postFxSettings = normalizePostFxSettings(options)

    /** 当前显示设置（由 UI 通过 applyDisplaySettings 同步） */
    this.display = {
      shadingMode: DEFAULT_SHADE_MODE,
      background: DEFAULT_BACKGROUND_MODE,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      gradientTop: DEFAULT_GRADIENT_TOP,
      gradientBottom: DEFAULT_GRADIENT_BOTTOM,
      // 默认显示坐标轴、不显示网格（对齐 M0 观感）
      showGrid: options.showGrid ?? false,
      showAxes: options.showAxes ?? true,
      toneMapping: postFxSettings.toneMapping,
      exposure: postFxSettings.exposure,
      saturation: postFxSettings.saturation,
      postFxEnabled: postFxSettings.enabled,
      idleMs: options.idleMs ?? DEFAULT_IDLE_MS,
    }

    this.renderer = new WebGLRenderer({
      antialias: true,
      // 透明背景模式需要 canvas 带 alpha
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.canvas = this.renderer.domElement
    this.canvas.classList.add('mv-canvas')

    this.scene = new Scene()
    this.camera = new PerspectiveCamera(50, 1, 0.01, 1000)
    this.camera.position.set(3, 2.2, 3.4)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.autoRotateSpeed = 2
    // 相机被程序化改动（视图预设/适配）也要唤醒渲染循环
    this.controls.addEventListener('change', () => this.noteActivity())

    // M0 的最小照明：没有它，自带材质的模型会一片黑。
    // M3 的三点光源 + 环境贴图模块会接管这里。
    this.lights = []
    const hemisphere = new HemisphereLight(0xffffff, 0x333344, 1.6)
    const keyLight = new DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 6, 5)
    const fillLight = new DirectionalLight(0xcfe3ff, 0.8)
    fillLight.position.set(-5, 1.5, -3)
    this.lights.push(hemisphere, keyLight, fillLight)
    this.lights.forEach((light) => this.scene.add(light))

    container.appendChild(this.canvas)

    // CSS2D 覆盖层：坐标轴标签（M2 的边界框尺寸标注复用同一层）
    this.cssRenderer = new CSS2DRenderer()
    const cssElement = this.cssRenderer.domElement
    cssElement.style.position = 'absolute'
    cssElement.style.top = '0'
    cssElement.style.left = '0'
    cssElement.style.pointerEvents = 'none'
    container.appendChild(cssElement)

    this.postFx = new PostFx(this.renderer, this.scene, this.camera, {
      samples: 4,
      toneMapping: this.display.toneMapping,
      exposure: this.display.exposure,
      saturation: this.display.saturation,
      enabled: this.display.postFxEnabled,
    })

    this.stage = new Stage(this.scene)
    this.stage.setBackground({
      mode: this.display.background,
      color: this.display.backgroundColor,
      gradientTop: this.display.gradientTop,
      gradientBottom: this.display.gradientBottom,
    })
    this.stage.setHelpers({ showGrid: this.display.showGrid, showAxes: this.display.showAxes })

    this.idle = createIdlePolicy({ idleMs: this.display.idleMs })

    // 循环用「闭包 + 不可变句柄」实现（见 renderLoop.js）：
    // 不依赖 this 绑定时机，也不会因回调抛错而留下僵尸句柄。
    this.loop = createRenderLoop({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onFrame: () => this.onFrame(),
    })

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

    // 任何用户输入都唤醒渲染循环（空闲时 rAF 已被停掉）
    this.activityEvents = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']
    this.activityHandler = () => this.noteActivity()
    for (const eventName of this.activityEvents) {
      this.canvas.addEventListener(eventName, this.activityHandler, { passive: true })
    }

    this.noteActivity()
  }

  /* ------------------------------- 渲染循环 ------------------------------- */

  noteActivity() {
    // 构造期（this.loop 还没建立）或已销毁时调用都必须是安全的：
    // 这个函数会被 controls 的 change 事件、ResizeObserver、设置变更多处触发。
    if (this.disposed || !this.loop) return
    this.idle.noteActivity(performance.now())
    this.start()
  }

  start() {
    if (this.disposed) return
    this.loop.start()
  }

  stop() {
    this.loop.stop()
  }

  get isRunning() {
    return this.loop.running
  }

  /**
   * 每帧的调度决策：只有「相机在动 ∪ 有持续工作 ∪ 仍处于活动窗口」才继续排帧，
   * 否则不再排帧，让循环自然停下（rAF 归零、CPU 占用为 0）。
   */
  onFrame() {
    const now = performance.now()
    const controlsChanged = this.controls.update()
    const continuous = hasContinuousWork({
      autoRotate: this.controls.autoRotate,
      animationPlaying: this.animationPlaying,
    })

    if (!controlsChanged && !continuous && !this.idle.shouldRender(now)) return

    this.renderFrame()
    // 继续排帧；若期间进入空闲，下一帧的决策会再次把它停掉
    this.loop.start()
  }

  /**
   * 渲染一帧。整帧用 try/catch 包住不是防御性编程的洁癖：
   * 抛在 rAF 回调里的异常不会冒泡到任何 UI，现象就是「画布全黑但界面一切正常」，
   * 极难排查。这里捕获后自动降级并把原因交给 UI 展示。
   */
  renderFrame() {
    if (this.disposed) return
    try {
      this.postFx.render()
      this.cssRenderer.render(this.scene, this.camera)
      this.renderedFrames += 1
      this.sampleFps()
    } catch (error) {
      this.handleRenderError(error)
    }
  }

  handleRenderError(error) {
    const message = error?.message ?? String(error)
    console.error('[ViewerEngine] 渲染失败', error)

    // 已经退化到直渲路径仍然失败 → 停止循环，避免每帧刷屏（用户可以再操作触发重试）
    if (!this.display.postFxEnabled) {
      this.stop()
      if (this.renderError?.level !== 'stopped') {
        this.renderError = { message, level: 'stopped' }
        this.onRenderError?.({ ...this.renderError, hint: '渲染已停止，请把控制台日志反馈给开发者' })
      }
      return
    }

    // 第一步降级：关掉后处理直渲（后处理是链路上变量最多的一环）
    this.display.postFxEnabled = false
    this.postFx.setEnabled(false)
    this.renderError = { message, level: 'postFx-disabled' }
    this.onRenderError?.({ ...this.renderError, hint: '已自动关闭后处理并改用直渲路径重试' })
    this.noteActivity()
  }

  /** 立即渲染一帧（截图、设置预览等一次性需求） */
  renderNow() {
    if (!this.loop.running) this.renderFrame()
    this.noteActivity()
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio)

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.renderer.setPixelRatio(pixelRatio)
    // updateStyle=false：画布尺寸交给 CSS（100%/100%），避免内联样式与布局打架
    this.renderer.setSize(width, height, false)
    this.cssRenderer.setSize(width, height)
    this.postFx.setSize(width, height, pixelRatio)

    this.noteActivity()
  }

  setMaxPixelRatio(maxPixelRatio) {
    if (Number.isFinite(maxPixelRatio) && maxPixelRatio > 0) this.maxPixelRatio = maxPixelRatio
    this.handleResize()
  }

  setAutoRotate(enabled, speed) {
    this.controls.autoRotate = Boolean(enabled)
    if (typeof speed === 'number') this.controls.autoRotateSpeed = speed
    this.noteActivity()
  }

  /** M4 的动画模块用它告诉引擎「有持续工作，别进空闲」 */
  setAnimationPlaying(playing) {
    this.animationPlaying = Boolean(playing)
    this.noteActivity()
  }

  /* ------------------------------- 显示设置 ------------------------------- */

  /**
   * 应用显示设置（与引擎当前状态做增量合并）。
   * @returns {string[]} 需要展示给用户的提示（例如线框被跳过）
   */
  applyDisplaySettings(partial = {}) {
    this.display = { ...this.display, ...partial }
    const warnings = []

    if (this.shadeController && this.display.shadingMode !== this.shadeController.currentMode) {
      warnings.push(...this.shadeController.apply(this.display.shadingMode))
    }

    this.stage.setBackground({
      mode: this.display.background,
      color: this.display.backgroundColor,
      gradientTop: this.display.gradientTop,
      gradientBottom: this.display.gradientBottom,
    })
    this.container.classList.toggle('mv-transparent-stage', this.display.background === 'transparent')
    this.stage.setHelpers({ showGrid: this.display.showGrid, showAxes: this.display.showAxes })

    this.postFx.setEnabled(this.display.postFxEnabled)
    this.postFx.setToneMapping(this.display.toneMapping)
    this.postFx.setExposure(this.display.exposure)
    this.postFx.setSaturation(this.display.saturation)

    this.idle.setIdleMs(this.display.idleMs)
    this.noteActivity()

    return warnings
  }

  /* ------------------------------- 模型与相机 ------------------------------- */

  /**
   * 替换当前模型，并释放上一个模型占用的 GPU 资源。
   * @returns {{disposal: object|null, fit: object|null, shadeWarnings: string[]}}
   */
  setModel(root, { fit = true, presetId } = {}) {
    let disposal = null
    if (this.currentRoot) {
      this.scene.remove(this.currentRoot)
      disposal = disposeObject3D(this.currentRoot)
      this.lastDisposal = disposal
      console.info('[ViewerEngine] 已释放上一个模型的资源', disposal)
    }
    if (this.shadeController) {
      this.shadeController.dispose()
      this.shadeController = null
    }

    this.currentRoot = root ?? null
    let fitResult = null
    let shadeWarnings = []

    if (this.currentRoot) {
      this.scene.add(this.currentRoot)
      this.shadeController = new ShadeController(this.currentRoot)
      shadeWarnings = this.shadeController.apply(this.display.shadingMode)

      this.lastBox = new Box3().setFromObject(this.currentRoot)
      this.stage.fitToBox(this.lastBox)
      if (fit) fitResult = this.fitToObject(this.currentRoot, { presetId })
    } else {
      this.lastBox = null
    }

    this.noteActivity()
    return { disposal, fit: fitResult, shadeWarnings }
  }

  clearModel() {
    return this.setModel(null, { fit: false })
  }

  /**
   * 把相机拉到能完整看到对象的距离，并按预设方向摆放。
   * 距离按包围球半径与视角计算（取水平/垂直中较小者），padding 留出边距。
   */
  fitToObject(object = this.currentRoot, { padding = 1.25, presetId } = {}) {
    if (!object) return null

    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return null

    const sphere = box.getBoundingSphere(new Sphere())
    const placement = computeCameraPlacement({
      center: sphere.center,
      radius: Math.max(sphere.radius, 1e-6),
      fovDeg: this.camera.fov,
      aspect: this.camera.aspect,
      presetId: presetId ?? this.lastPresetId ?? DEFAULT_VIEW_PRESET,
      padding,
    })

    this.camera.position.set(...placement.position)
    this.camera.near = Math.max(placement.distance / 1000, 1e-4)
    this.camera.far = placement.distance + sphere.radius * 20
    this.camera.updateProjectionMatrix()

    this.controls.target.copy(sphere.center)
    this.controls.update()

    this.lastBox = box
    this.lastPresetId = placement.presetId
    this.noteActivity()

    return { box, sphere, distance: placement.distance, presetId: placement.presetId }
  }

  /** 切到某个标准视图（前/后/左/右/上/下/等轴测） */
  setViewPreset(presetId) {
    return this.fitToObject(this.currentRoot, { presetId })
  }

  /** 重置视图：回到等轴测并重新适配 */
  resetView() {
    return this.setViewPreset(DEFAULT_VIEW_PRESET)
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
      postFx: this.display.postFxEnabled,
      renderedFrames: this.renderedFrames,
      renderError: this.renderError,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.contextLostHandler)
    for (const eventName of this.activityEvents) {
      this.canvas.removeEventListener(eventName, this.activityHandler)
    }
    this.controls.dispose()

    if (this.shadeController) {
      this.shadeController.dispose()
      this.shadeController = null
    }
    if (this.currentRoot) {
      this.scene.remove(this.currentRoot)
      disposeObject3D(this.currentRoot)
      this.currentRoot = null
    }

    this.postFx.dispose()
    this.stage.dispose()
    this.cssRenderer.domElement.remove()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
