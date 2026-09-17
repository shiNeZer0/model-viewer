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
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import { BoundingBoxOverlay } from './boundingBox.js'
import { AnimationController, MAX_FRAME_DELTA } from './animation.js'
import { disposeObject3D } from './disposal.js'
import { EnvironmentManager } from './environment.js'
import { buildHierarchy } from './hierarchy.js'
import { DEFAULT_IDLE_MS, createIdlePolicy, hasContinuousWork } from './idlePolicy.js'
import { LightingRig, createDefaultLightingState, normalizeLightingState } from './lighting.js'
import { ModelPlacement } from './modelPlacement.js'
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

    const controlsChanged = this.controls.update()

    // 动画推进：只有播放中才真正改变姿势；同时把状态回写给 UI
    const animationState = this.updateAnimation(delta)
    this.animationPlaying = Boolean(animationState?.playing)

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
    if (
      this.currentRoot &&
      (this.display.centerModel !== previous.centerModel ||
        this.display.alignToGround !== previous.alignToGround)
    ) {
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

  /* ------------------------------- 模型与相机 ------------------------------- */

  /**
   * 替换当前模型，并释放上一个模型占用的 GPU 资源。
   * @returns {{disposal: object|null, fit: object|null, shadeWarnings: string[]}}
   */
  setModel(root, { fit = true, presetId, animations = [] } = {}) {
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
      this.placement = null
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
   */
  fitToObject(object = this.currentRoot, { padding = 1.25, presetId, box = null } = {}) {
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

    this.camera.position.set(...placement.position)
    this.camera.near = Math.max(placement.distance / 1000, 1e-4)
    this.camera.far = placement.distance + sphere.radius * 20
    this.camera.updateProjectionMatrix()

    this.controls.target.copy(sphere.center)
    this.controls.update()

    this.lastBox = targetBox
    this.lastPresetId = placement.presetId
    this.noteActivity()

    return { box, sphere, distance: placement.distance, presetId: placement.presetId }
  }

  /** 切到某个标准视图（前/后/左/右/上/下/等轴测） */
  setViewPreset(presetId) {
    return this.fitToObject(this.currentRoot, { presetId })
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
    this.animation?.dispose()
    this.lightingRig?.dispose()
    this.environment?.dispose()
    this.cssRenderer.domElement.remove()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
