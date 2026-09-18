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
  EquirectangularReflectionMapping,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import { resolveExportRatio } from '../screenshot.js'
import { BoundingBoxOverlay } from './boundingBox.js'
import { AnimationController, MAX_FRAME_DELTA } from './animation.js'
import {
  CameraTween,
  DEFAULT_TWEEN_MS,
  ENTRANCE_LIFT_FACTOR,
  ENTRANCE_START_FACTOR,
  ENTRANCE_TWEEN_MS,
  computeEntranceStartPose,
  normalizePose,
} from './cameraTween.js'
import { disposeObject3D } from './disposal.js'
import { EnvironmentManager, loadEquirectangularTexture } from './environment.js'
import { buildHierarchy } from './hierarchy.js'
import { DEFAULT_IDLE_MS, createIdlePolicy, hasContinuousWork } from './idlePolicy.js'
import { LightingRig, createDefaultLightingState, normalizeLightingState } from './lighting.js'
import { LightGizmos } from './lightGizmos.js'
import { ModelPlacement } from './modelPlacement.js'
import { ModelOrientation } from './orientation.js'
import { PostFx, normalizePostFxSettings } from './postfx.js'
import { createRenderLoop } from './renderLoop.js'
import { DEFAULT_SHADE_MODE, ShadeController, hidesSolid } from './shadeModes.js'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_GRADIENT_BOTTOM,
  DEFAULT_GRADIENT_TOP,
  Stage,
} from './stage.js'
import { DEFAULT_DISPLAY_UNIT, DEFAULT_SOURCE_UNIT } from './units.js'
import { DEFAULT_VIEW_PRESET, computeCameraPlacement } from './viewPresets.js'
import { applyVisibility, captureVisibility } from './visibility.js'

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
    /** 当前模型的摆放控制器（居中/贴地），随模型切换而重建 */
    this.placement = null
    /** 当前模型的轴向修正器：记住模型自带姿态，用户切换 upAxis 时从原始值重算 */
    this.orientation = null
    /** 当前模型的格式 id（auto 模式判断是否按 Z-up 处理时要用） */
    this.formatId = ''
    /** 最近一次 fitToObject 算出的相机目标位姿 —— 模型入场动画的终点（见 playEntranceAnimation） */
    this.lastCameraDestination = null
    /** 用户通过层级树手动设置的可见性（覆盖模型原始值） */
    this.visibilityOverrides = new Map()
    /** 模型自带的原始可见性 */
    this.originalVisibility = new Map()
    /** 层级数据（纯数据树 + id→对象 映射，映射不进响应式） */
    this.hierarchy = { nodes: [], nodeById: new Map(), count: 0, truncated: false }
    /** 边界框标注（M2） */
    this.bbox = null
    /** 动画控制器（M4）：只有带动画的模型才创建 */
    this.animation = null
    /** 上一帧时间戳（用于把帧间隔喂给动画，并夹取上限防空闲唤醒后跳帧） */
    this.lastFrameTime = 0
    this.lastDisposal = null
    this.lastBox = null
    this.lastPresetId = DEFAULT_VIEW_PRESET
    this.animationPlaying = false
    /** 相机平滑过渡（视角切换用，见 cameraTween.js） */
    this.cameraTween = new CameraTween()
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
      // 模型摆放：默认居中到世界原点并把底部贴到地面
      centerModel: options.centerModel ?? true,
      alignToGround: options.alignToGround ?? true,
      // M2：边界框标注与单位
      showBoundingBox: options.showBoundingBox ?? false,
      // 光源可视化（默认关：它是调光时的辅助，不该默认出现在查看器里）
      showLightGizmos: options.showLightGizmos ?? false,
      sourceUnit: options.sourceUnit ?? DEFAULT_SOURCE_UNIT,
      displayUnit: options.displayUnit ?? DEFAULT_DISPLAY_UNIT,
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
    // 用户一上手就打断相机补间：否则补间会与鼠标拖动抢控制权，表现为"拖动被拽回去"
    this.controls.addEventListener('start', () => this.cancelCameraTween())

    // M3：三点光源装置接管照明（主光/补光/轮廓光 + 半球环境光）；
    // 环境贴图由 EnvironmentManager 生成（程序化渐变 / RoomEnvironment / 导入的 HDR）
    this.lightingRig = new LightingRig(this.scene)
    this.environment = new EnvironmentManager(this.renderer, this.scene)
    this.lightingState = createDefaultLightingState()

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

    // M2：边界框与尺寸标注（CSS2D 标签复用引擎里的 CSS2D 渲染层）
    this.bbox = new BoundingBoxOverlay(this.scene)

    // 光源可视化：把三盏灯的位置/朝向/颜色画出来（初始可见性跟着显示设置走）
    this.lightGizmos = new LightGizmos(this.scene)
    this.lightGizmos.setVisible(this.display.showLightGizmos)

    // M3：应用初始光照（默认影棚预设），保证首屏就有正确的打光
    this.applyLighting(this.lightingState)

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
    // 帧间隔夹取上限：从空闲状态唤醒时 delta 可能很大，直接喂 mixer 会跳帧
    const delta = this.lastFrameTime
      ? Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_DELTA)
      : 0
    this.lastFrameTime = now

    /*
     * 顺序很关键：先推进相机补间（它直接写 camera.position / controls.target），
     * 再调 controls.update() —— 后者每帧从"当前相机位置 - target"重算球坐标，
     * 阻尼增量为 0 时不会覆盖我们刚写入的位姿。反过来写就会被 controls 抹掉。
     */
    const cameraMoving = this.advanceCameraTween(delta * 1000)

    // 补间期间暂停转盘：两者都在改相机，同时生效会让相机"到不了目标视角"
    const autoRotateEnabled = this.controls.autoRotate
    if (cameraMoving) this.controls.autoRotate = false
    const controlsChanged = this.controls.update()
    if (cameraMoving) this.controls.autoRotate = autoRotateEnabled

    // 动画推进：只有播放中才真正改变姿势；同时把状态回写给 UI
    const animationState = this.updateAnimation(delta)
    this.animationPlaying = Boolean(animationState?.playing)

    const continuous = hasContinuousWork({
      autoRotate: this.controls.autoRotate,
      animationPlaying: this.animationPlaying,
      cameraMoving,
    })

    if (!controlsChanged && !continuous && !this.idle.shouldRender(now)) return

    this.renderFrame()
    // 继续排帧；若期间进入空闲，下一帧的决策会再次把它停掉
    this.loop.start()
  }

  /* --------------------------- 相机平滑过渡 --------------------------- */

  /**
   * 系统级「减少动效」偏好。
   * 这类偏好下相机直接落位：动画对前庭敏感人群是负面体验，也违背用户显式设置。
   */
  prefersReducedMotion() {
    return Boolean(
      typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )
  }

  /** 把补间算出的位姿写给相机与控制器 */
  applyCameraPose({ position, target }) {
    this.camera.position.set(position[0], position[1], position[2])
    this.controls.target.set(target[0], target[1], target[2])
  }

  /** 每帧推进补间，返回本帧相机是否仍在移动 */
  advanceCameraTween(deltaMs) {
    if (!this.cameraTween.active) return false
    const sample = this.cameraTween.update(deltaMs)
    if (!sample) return false

    this.applyCameraPose(sample)
    // 收尾后仍然记一次活动：让最后一帧稳稳画出来，而不是刚好在空闲边界上被丢掉
    if (sample.done) this.noteActivity()
    return this.cameraTween.active
  }

  /**
   * 启动一段相机补间（视角切换与模型入场共用）。
   *
   * 把"唤醒循环 + 清帧时间基准"收在这一处：两者都是补间能正常播放的前提，
   * 分开写迟早会漏掉一处（曾经踩过"命令改了状态但没有帧渲染"的坑）。
   * @returns {boolean} 是否真的进入动画状态（起点终点相同则为 false）
   */
  startCameraTween({ from, to }, { durationMs }) {
    if (!this.cameraTween.start({ from, to }, { durationMs })) return false

    /*
     * 清掉帧时间基准：从空闲唤醒时第一帧的 delta 会被夹到 MAX_FRAME_DELTA（100ms），
     * 对 320ms 的补间等于"起步就跳掉近 1/3"，看起来像卡了一下。清空后第一帧 delta=0。
     */
    this.lastFrameTime = 0
    // 视角多由面板/快捷键触发（加载也可能已超过 idleMs），循环当时往往是停的，必须自己唤醒
    this.noteActivity()
    return true
  }

  /**
   * 平滑移动到目标位姿（视角切换用）。
   * @returns {boolean} 是否真的启动了动画（false = 已瞬时落位：起点终点相同 / 减少动效 / 位姿非法）
   */
  animateCameraTo(pose, { durationMs = DEFAULT_TWEEN_MS } = {}) {
    const destination = normalizePose(pose)
    if (!destination) return false

    const applyInstantly = () => {
      this.applyCameraPose(destination)
      this.controls.update()
      this.noteActivity()
    }

    if (this.prefersReducedMotion()) {
      applyInstantly()
      return false
    }

    const started = this.startCameraTween(
      {
        from: { position: this.camera.position.toArray(), target: this.controls.target.toArray() },
        to: destination,
      },
      { durationMs },
    )
    if (!started) applyInstantly()
    return started
  }

  /**
   * 模型入场动画：从"更远、略高处的同一视角"平滑推到最近一次适配好的位姿。
   *
   * 起点由**终点**推导（见 computeEntranceStartPose），因此与"上一个相机停在哪"无关，
   * 每次加载的表现一致。返回 false 表示没播（无模型 / 无已适配位姿 / 系统「减少动效」），
   * 此时相机保持在 setModel 已瞬时摆好的适配位姿上，不会出现半个动画。
   */
  playEntranceAnimation({ durationMs = ENTRANCE_TWEEN_MS } = {}) {
    if (this.disposed || !this.currentRoot || !this.lastCameraDestination) return false
    if (this.prefersReducedMotion()) return false

    const from = computeEntranceStartPose(this.lastCameraDestination, {
      factor: ENTRANCE_START_FACTOR,
      lift: ENTRANCE_LIFT_FACTOR,
    })
    if (!from) return false

    return this.startCameraTween({ from, to: this.lastCameraDestination }, { durationMs })
  }

  /** 打断补间（用户接管相机 / 模型被替换），就停在当前位置 */
  cancelCameraTween() {
    if (!this.cameraTween.active) return false
    this.cameraTween.cancel()
    this.noteActivity()
    return true
  }

  /**
   * 推进动画并（节流地）把状态回写给 UI。
   * 节流原因：播放中每帧回写会让 Vue 每秒重渲染 60 次时间轴，纯属浪费；
   * 但"播放/暂停/片段切换/播完"这类离散变化必须立刻回写。
   */
  updateAnimation(delta = 0) {
    if (!this.animation) return null
    const state = this.animation.update(this.animation.playing ? delta : 0)

    const now = performance.now()
    const discreteChanged =
      state.playing !== this.animationState?.playing ||
      state.finished !== this.animationState?.finished ||
      state.clipId !== this.animationState?.clipId

    // 100ms ≈ 10Hz，够时间轴平滑又不至于每帧触发 Vue 更新
    if (discreteChanged || now - (this.lastAnimationTickAt ?? 0) >= 100) {
      this.lastAnimationTickAt = now
      this.animationState = state
      this.onAnimationTick?.(state)
    }
    return state
  }

  /** 用户操作后立即回写一次（不等节流） */
  emitAnimationState() {
    const state = this.getAnimationState()
    this.lastAnimationTickAt = performance.now()
    this.animationState = state
    this.onAnimationTick?.(state)
    /*
     * 必须显式唤醒渲染循环。
     * 引擎的 activity 监听只挂在 canvas 上（pointerdown/wheel/keydown…），
     * 而面板里的点击根本不经过 canvas；若循环已因空闲停掉，这里不唤醒就会出现
     * "点了播放/切了片段却毫无反应"——状态变了但没有任何一帧被渲染。
     */
    this.noteActivity()
    return state
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

  /**
   * 截图：按导出倍数重渲一帧并立刻读回像素，返回 data URL（失败返回 null）。
   *
   * 两个"必须这么写"的理由：
   * 1. 渲染器没有开 `preserveDrawingBuffer`（开了会持续占用一份额外缓冲），
   *    浏览器可能在合成之后清空绘制缓冲区，因此「渲染」与「toDataURL」必须在**同一个同步任务**里完成；
   * 2. 通过临时调高像素比来提分辨率，后处理（EffectComposer）会一起按新尺寸出图，
   *    不必再写一条离屏读取逻辑——否则直渲与后处理两条路径很容易出图不一致。
   *
   * 注意：CSS2D 的尺寸标注、信息 HUD、动画控制条都是 DOM 覆盖层，**不会**出现在截图里
   * （截图是纯 3D 画面，这也是导出图片时通常期望的行为）。
   */
  captureImage({ scale = 2, type = 'image/png', quality } = {}) {
    if (this.disposed || !this.canvas) return null

    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)
    const baseRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio)
    const exportRatio = resolveExportRatio({ baseRatio, scale, width, height })

    try {
      if (exportRatio !== baseRatio) {
        this.renderer.setPixelRatio(exportRatio)
        this.renderer.setSize(width, height, false)
        this.postFx.setSize(width, height, exportRatio)
      }
      this.renderFrame()
      const dataUrl = this.canvas.toDataURL(type, quality)
      console.info(
        `[ViewerEngine] 截图完成: ${width}×${height} @${exportRatio}x → ${Math.round(dataUrl.length / 1024)} KB`,
      )
      return dataUrl
    } catch (error) {
      console.error('[ViewerEngine] 截图失败', error)
      return null
    } finally {
      // 恢复显示用的像素比并立刻重绘：否则画布会停在导出分辨率上
      if (exportRatio !== baseRatio) {
        this.handleResize()
        this.renderFrame()
      }
      this.noteActivity()
    }
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
    const previous = this.display
    this.display = { ...previous, ...partial }
    const warnings = []

    if (this.shadeController && this.display.shadingMode !== this.shadeController.currentMode) {
      warnings.push(...this.shadeController.apply(this.display.shadingMode))
      // 模式变化会影响"实体是否该隐藏"，可见性统一重算
      this.applyVisibilityNow()
    }

    // 摆放设置变化 → 重新归一化（网格与相机一并刷新）
    const layoutChanged =
      this.display.centerModel !== previous.centerModel ||
      this.display.alignToGround !== previous.alignToGround
    // 轴向覆盖变化：姿态必须先改，再统一重做摆放 —— 包围盒、尺寸标注与相机都依赖姿态
    const orientationChanged = this.display.upAxis !== previous.upAxis

    if (this.currentRoot && orientationChanged && this.orientation) {
      this.orientation.apply({ upAxis: this.display.upAxis, formatId: this.formatId })
    }
    if (this.currentRoot && (layoutChanged || orientationChanged)) {
      this.reapplyPlacement()
    }

    // 边界框开关 / 单位变化 → 重画标注（尺寸文本随单位换算）
    if (
      this.display.showBoundingBox !== previous.showBoundingBox ||
      this.display.sourceUnit !== previous.sourceUnit ||
      this.display.displayUnit !== previous.displayUnit
    ) {
      this.refreshBoundsOverlay()
    }

    this.stage.setBackground({
      mode: this.display.background,
      color: this.display.backgroundColor,
      gradientTop: this.display.gradientTop,
      gradientBottom: this.display.gradientBottom,
    })
    this.container.classList.toggle('mv-transparent-stage', this.display.background === 'transparent')
    this.stage.setHelpers({ showGrid: this.display.showGrid, showAxes: this.display.showAxes })
    // 光源可视化开关（只在变化时动作，避免每帧重设）
    if (this.display.showLightGizmos !== previous.showLightGizmos) {
      this.lightGizmos.setVisible(this.display.showLightGizmos)
    }

    this.postFx.setEnabled(this.display.postFxEnabled)
    this.postFx.setToneMapping(this.display.toneMapping)
    this.postFx.setExposure(this.display.exposure)
    this.postFx.setSaturation(this.display.saturation)

    this.idle.setIdleMs(this.display.idleMs)
    this.noteActivity()

    return warnings
  }

  /**
   * 应用光照状态：三点光源 + 环境贴图（+ 环境贴图作为背景）。
   * 幂等，可反复调用；环境贴图只在来源/颜色变化时重新生成（EnvironmentManager 内部有缓存键）。
   */
  applyLighting(lightingState) {
    this.lightingState = normalizeLightingState(lightingState ?? this.lightingState)
    this.lightingRig.apply(this.lightingState)
    // 光源示意图跟着光照状态一起刷新（拖滑杆时高频调用，内部是就地改属性）
    this.lightGizmos.update(this.lightingState)

    const texture = this.environment.apply(this.lightingState.environment)
    // 环境贴图既提供 IBL，也可以在 background=environment 时直接当背景（全景预设）
    this.stage.setEnvironmentBackground(texture, {
      intensity: this.lightingState.environment.intensity,
      blurriness: 0.25,
    })
    if (this.display.background === 'environment') {
      this.stage.setBackground({ mode: 'environment' })
    }

    this.noteActivity()
    return this.lightingState
  }

  /* ------------------------------- 动画（M4） ------------------------------- */

  /** 片段描述列表（纯数据，供 UI 下拉） */
  getAnimationClips() {
    return this.animation?.descriptions ?? []
  }

  /** 当前动画状态（无动画时返回 hasClips:false 的状态） */
  getAnimationState() {
    return (
      this.animation?.getState() ?? {
        hasClips: false,
        clipId: null,
        clipName: '',
        playing: false,
        finished: false,
        speed: this.animationPrefs?.speed ?? 1,
        loopMode: this.animationPrefs?.loopMode ?? 'repeat',
        time: 0,
        duration: 0,
        normalized: 0,
      }
    )
  }

  selectAnimationClip(target) {
    if (!this.animation?.selectClip(target)) return this.getAnimationState()
    return this.emitAnimationState()
  }

  playAnimation() {
    this.animation?.play()
    return this.emitAnimationState()
  }

  pauseAnimation() {
    this.animation?.pause()
    return this.emitAnimationState()
  }

  stopAnimation() {
    this.animation?.stop()
    return this.emitAnimationState()
  }

  /** 拖动时间轴；persist 语义由调用方决定（拖动过程不落库） */
  seekAnimation(normalized) {
    this.animation?.seekNormalized(normalized)
    return this.emitAnimationState()
  }

  /** 倍速：记进偏好，模型切换后会套用到新的控制器上 */
  setAnimationSpeed(speed) {
    this.animationPrefs = { ...(this.animationPrefs ?? {}), speed }
    this.animation?.setSpeed(speed)
    return this.emitAnimationState()
  }

  setAnimationLoopMode(loopMode) {
    this.animationPrefs = { ...(this.animationPrefs ?? {}), loopMode }
    this.animation?.setLoopMode(loopMode)
    return this.emitAnimationState()
  }

  /* --------------------------- 导入的环境贴图（M6-5） --------------------------- */

  /** 当前光照状态是否指向一张**尚未登记**的导入贴图（需要先去读文件） */
  needsImportedEnvironment(environment = this.lightingState?.environment) {
    if (environment?.source !== 'imported') return false
    const url = environment.customHdrUrl
    return Boolean(url) && !this.environment.hasImportedTexture(url)
  }

  /**
   * 读取导入的 HDR/EXR、登记到环境管理器，然后重新套用光照。
   *
   * 刻意**不抛错**：导入失败只意味着"退回程序化环境"，返回 { ok:false, error } 让调用方提示一句，
   * 若抛出去会中断调用链，用户看到的是画面停在旧环境上一句话都没有。
   */
  async loadImportedEnvironment(environment) {
    const url = environment?.customHdrUrl
    if (!url) return { ok: false, error: '缺少环境贴图地址' }

    try {
      const texture = await loadEquirectangularTexture(url, {
        extension: environment.customHdrExtension || 'hdr',
      })
      if (this.disposed) {
        texture.dispose?.()
        return { ok: false, error: '引擎已销毁' }
      }
      // 等距柱状映射：PMREM 转换与"环境贴图当背景"都依赖它
      texture.mapping = EquirectangularReflectionMapping
      texture.needsUpdate = true

      this.environment.registerImportedTexture(url, texture)
      this.applyLighting(this.lightingState)
      console.info(`[ViewerEngine] 环境贴图已载入并应用: ${environment.customHdrName ?? url}`)
      return { ok: true, name: environment.customHdrName ?? '' }
    } catch (error) {
      console.warn('[ViewerEngine] 环境贴图读取失败，已退回程序化环境', error)
      return { ok: false, error: error?.message ?? String(error) }
    }
  }

  /* ------------------------------- 模型与相机 ------------------------------- */

  /**
   * 替换当前模型，并释放上一个模型占用的 GPU 资源。
   * @returns {{disposal: object|null, fit: object|null, shadeWarnings: string[]}}
   */
  setModel(root, { fit = true, presetId, animations = [], formatId = '' } = {}) {
    // 换模型时旧的补间终点已经失效：不取消的话相机会继续飞向"上一个模型"的视角
    this.cancelCameraTween()

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
    // 动画控制器必须先于旧对象树释放，否则 mixer 会继续引用已销毁的节点
    if (this.animation) {
      this.animation.dispose()
      this.animation = null
    }

    this.currentRoot = root ?? null
    let fitResult = null
    let shadeWarnings = []

    if (this.currentRoot) {
      this.scene.add(this.currentRoot)
      // 轴向修正必须在"量包围盒"之前：否则尺寸、贴地与相机适配会全部跟着错
      // （3MF 规范是 Z-up；其它格式按 auto 保持原样）。
      // 用 ModelOrientation 记住模型自带的原始姿态：之后用户在显示面板切换轴向时从原始值重算，不累积旋转。
      this.formatId = formatId
      this.orientation = new ModelOrientation(this.currentRoot)
      this.orientation.apply({ upAxis: this.display.upAxis, formatId })
      this.placement = new ModelPlacement(this.currentRoot)
      this.shadeController = new ShadeController(this.currentRoot)
      this.originalVisibility = captureVisibility(this.currentRoot)
      this.visibilityOverrides = new Map()

      shadeWarnings = this.shadeController.apply(this.display.shadingMode)
      this.applyVisibilityNow()
      // 层级数据只抽一次：纯数据给 UI，id→对象 映射留在引擎侧（非响应式）
      this.hierarchy = buildHierarchy(this.currentRoot)

      // M4：有动画才创建控制器，默认选中第一段（停在 0 帧）并套用用户偏好
      const clipList = (Array.isArray(animations) ? animations : []).filter(Boolean)
      if (clipList.length) {
        this.animation = new AnimationController(this.currentRoot, clipList)
        this.animation.selectClip(0)
        if (this.animationPrefs?.speed !== undefined) {
          this.animation.setSpeed(this.animationPrefs.speed)
        }
        if (this.animationPrefs?.loopMode !== undefined) {
          this.animation.setLoopMode(this.animationPrefs.loopMode)
        }
      }

      // 归一化摆放（居中 + 贴地），再按摆放后的包围盒调整网格尺度与相机
      this.lastBox =
        this.placement.apply({
          center: this.display.centerModel,
          ground: this.display.alignToGround,
        }) ?? new Box3().setFromObject(this.currentRoot)
      this.stage.fitToBox(this.lastBox)
      this.refreshBoundsOverlay()
      if (fit) fitResult = this.fitToObject(this.currentRoot, { presetId, box: this.lastBox })
    } else {
      this.lastBox = null
      // 没有模型就没有"适配位姿"：清掉它，入场动画自然不会误播（playEntranceAnimation 也会判 currentRoot）
      this.lastCameraDestination = null
      this.placement = null
      this.orientation = null
      this.formatId = ''
      this.hierarchy = { nodes: [], nodeById: new Map(), count: 0, truncated: false }
      this.visibilityOverrides = new Map()
      this.originalVisibility = new Map()
      this.bbox?.update(null)
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
   * @param {object} [options.box] 已知的包围盒（避免重复计算）
   * @param {boolean} [options.animate] 是否平滑过渡。**默认瞬时**：加载模型、
   *   重新摆放、尺寸变化等程序化路径需要立刻到位；只有用户点"切视角"才传 true。
   */
  fitToObject(
    object = this.currentRoot,
    { padding = 1.25, presetId, box = null, animate = false } = {},
  ) {
    if (!object) return null

    const targetBox = box ?? new Box3().setFromObject(object)
    if (targetBox.isEmpty()) return null

    const sphere = targetBox.getBoundingSphere(new Sphere())
    const placement = computeCameraPlacement({
      center: sphere.center,
      radius: Math.max(sphere.radius, 1e-6),
      fovDeg: this.camera.fov,
      aspect: this.camera.aspect,
      presetId: presetId ?? this.lastPresetId ?? DEFAULT_VIEW_PRESET,
      padding,
    })

    // near/far 立刻按**目标**距离设定：near 极小、far 很大，对补间的起点与终点都安全，
    // 不会出现"飞过去的过程中被裁切"
    this.camera.near = Math.max(placement.distance / 1000, 1e-4)
    this.camera.far = placement.distance + sphere.radius * 20
    this.camera.updateProjectionMatrix()

    const destination = { position: placement.position, target: sphere.center.toArray() }
    // 记下"适配后的目标位姿"：入场动画（playEntranceAnimation）要用它推导入场起点，
    // 这样不必重算一遍 computeCameraPlacement，也不必改动 fitToObject 的签名与返回结构
    this.lastCameraDestination = destination

    if (animate) {
      this.animateCameraTo(destination)
    } else {
      this.applyCameraPose(destination)
      this.controls.update()
    }

    this.lastBox = targetBox
    this.lastPresetId = placement.presetId
    this.noteActivity()

    return { box, sphere, distance: placement.distance, presetId: placement.presetId }
  }

  /**
   * 切到某个标准视图（前/后/左/右/上/下/等轴测）。
   * 默认平滑过渡：这是用户主动"换一个观察方向"，瞬移会让人失去空间方位感。
   */
  setViewPreset(presetId, { animate = true } = {}) {
    return this.fitToObject(this.currentRoot, { presetId, animate })
  }

  /**
   * 重新执行模型摆放归一化（用户切换"居中/贴地"开关时调用），
   * 因为摆放变了，网格尺度与相机也要跟着重算。
   */
  reapplyPlacement() {
    if (!this.currentRoot || !this.placement) return null

    const box = this.placement.apply({
      center: this.display.centerModel,
      ground: this.display.alignToGround,
    })
    if (!box) return null

    this.lastBox = box
    this.stage.fitToBox(box)
    this.refreshBoundsOverlay()
    this.fitToObject(this.currentRoot, { presetId: this.lastPresetId, box })
    return box
  }

  /* --------------------------- 可见性 / 层级 / 边界框 --------------------------- */

  /** 按「用户开关 + 模型原始值 + 当前模式是否隐藏实体」重算所有节点可见性 */
  applyVisibilityNow() {
    if (!this.currentRoot) return 0
    const changed = applyVisibility(this.currentRoot, {
      overrides: this.visibilityOverrides,
      originals: this.originalVisibility,
      hideSolids: hidesSolid(this.display.shadingMode),
    })
    if (changed) this.noteActivity()
    return changed
  }

  /** 重画边界框：开关与单位都从这里生效 */
  refreshBoundsOverlay() {
    if (!this.bbox) return
    this.bbox.setUnits({
      sourceUnit: this.display.sourceUnit,
      displayUnit: this.display.displayUnit,
    })
    this.bbox.setVisible(this.display.showBoundingBox)
    this.bbox.update(this.display.showBoundingBox ? this.lastBox : null)
  }

  /** 层级数据（纯数据，供 UI 渲染 el-tree） */
  getHierarchy() {
    return {
      nodes: this.hierarchy.nodes,
      count: this.hierarchy.count,
      truncated: this.hierarchy.truncated,
    }
  }

  /** 手动显示/隐藏某个节点（记入 overrides，不会被模式切换覆盖） */
  setNodeVisible(nodeId, visible) {
    const node = this.hierarchy.nodeById.get(nodeId)
    if (!node) return false
    this.visibilityOverrides.set(node, Boolean(visible))
    this.applyVisibilityNow()
    return true
  }

  /** 批量显示/隐藏（层级树工具栏） */
  setAllNodesVisible(visible) {
    for (const node of this.hierarchy.nodeById.values()) {
      this.visibilityOverrides.set(node, Boolean(visible))
    }
    this.applyVisibilityNow()
  }

  /** 清空用户覆盖，回到模型自带的可见性；返回各节点的权威可见性供 UI 回显 */
  resetNodeVisibility() {
    this.visibilityOverrides.clear()
    this.applyVisibilityNow()
    return this.collectVisibilityFlags()
  }

  /** 当前每个节点的真实可见性（id → boolean），用于回填层级树 */
  collectVisibilityFlags() {
    const flags = new Map()
    for (const [id, node] of this.hierarchy.nodeById) {
      flags.set(id, node.visible !== false)
    }
    return flags
  }

  /** 聚焦某个节点：把相机对准它的包围盒中心（层级树双击/按钮） */
  focusNode(nodeId) {
    const node = this.hierarchy.nodeById.get(nodeId)
    if (!node) return null
    const box = new Box3().setFromObject(node)
    if (box.isEmpty()) return null
    return this.fitToObject(node, { box, presetId: this.lastPresetId })
  }

  /** 当前模型摆放后的包围盒（尺寸面板 / 边界框标注使用） */
  getModelBounds() {
    if (!this.lastBox || this.lastBox.isEmpty()) return null
    return {
      box: this.lastBox.clone(),
      size: this.lastBox.getSize(new Vector3()),
      center: this.lastBox.getCenter(new Vector3()),
      min: this.lastBox.min.clone(),
      max: this.lastBox.max.clone(),
    }
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
    // 直接 cancel 而不是 cancelCameraTween()：后者会 noteActivity 重新排帧，在销毁路径上是错的
    this.cameraTween.cancel()
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
    this.bbox?.dispose()
    this.lightGizmos?.dispose()
    this.animation?.dispose()
    this.lightingRig?.dispose()
    this.environment?.dispose()
    this.cssRenderer.domElement.remove()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
