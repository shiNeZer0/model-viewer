/**
 * 光源可视化：在视口里把三盏平行光画出来（位置、朝向、颜色、强度）。
 *
 * 为什么需要：光照面板调的是"方位角/仰角/半径"这种抽象参数，不看视口根本不知道灯在哪、
 * 朝哪打、哪盏被关掉了 —— 调参基本靠猜。
 *
 * 分两部分（与 boundingBox.js 同一套路）：
 * 1. **纯函数** `describeLightGizmos`：把光照状态翻译成"要画什么"，可在 Node 下单测；
 * 2. `LightGizmos`：真正建 three 对象（Points 标记点 + 方向线 + CSS2D 文字标签）。
 *    标签依赖 DOM，Node 环境下自动退化为"只画点与线"，不抛错。
 *
 * 关键取舍：
 * - 标记点用 `sizeAttenuation:false` 的 Points：**屏幕像素大小恒定**，无论模型大小、相机远近都看得清；
 * - `depthTest:false` + 高 renderOrder：光源位置只是"方向来源"、不是几何体，被模型包住时也必须可见；
 * - 方向线画到原点：`DirectionalLight` 的 target 默认就在原点（LightingRig 没有改过），
 *   所以线指向原点才与实际打光方向一致（不是指向模型中心）。
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { LIGHT_ROLES, computeLightPosition, normalizeLightingState } from './lighting.js'

/** 已关闭光源的标记颜色（与面板里的「已关闭」语义一致） */
export const LIGHT_GIZMO_DISABLED_COLOR = '#9aa4b2'
/** 标记点的屏幕像素直径 */
export const LIGHT_MARKER_SIZE = 14
/** 方向线不透明度：能看清朝向又不至于压过模型 */
export const LIGHT_LINE_OPACITY = 0.5
/** 平行光的朝向目标（three 的 DirectionalLight.target 默认在原点，LightingRig 未改） */
export const LIGHT_GIZMO_AIM = [0, 0, 0]

/**
 * 把光照状态翻译成一组"光源示意"（纯函数）。
 * @param {object} state 光照状态（会先过一遍 normalizeLightingState）
 * @returns {Array<{role: string, label: string, enabled: boolean, intensity: number,
 *   color: string, markerColor: string, position: number[], aim: number[], text: string}>}
 */
export function describeLightGizmos(state) {
  const normalized = normalizeLightingState(state)

  return normalized.lights.map((light) => {
    const role = LIGHT_ROLES.find((item) => item.id === light.role)
    const label = role?.label ?? light.role
    return {
      role: light.role,
      label,
      enabled: light.enabled,
      intensity: light.intensity,
      color: light.color,
      // 关闭的光源用灰色标记，位置仍然画出来（调参时能看出"它本来在哪"）
      markerColor: light.enabled ? light.color : LIGHT_GIZMO_DISABLED_COLOR,
      position: computeLightPosition(light),
      aim: [...LIGHT_GIZMO_AIM],
      text: `${label} ${light.intensity.toFixed(2)}${light.enabled ? '' : '（已关闭）'}`,
    }
  })
}

function createLabelElement() {
  if (typeof document === 'undefined') return null
  const element = document.createElement('div')
  element.className = 'mv-light-label'
  element.style.font = '600 11px system-ui, sans-serif'
  element.style.padding = '1px 5px'
  element.style.borderRadius = '3px'
  element.style.background = 'rgba(15, 17, 21, 0.72)'
  element.style.whiteSpace = 'nowrap'
  element.style.userSelect = 'none'
  // 标签不能拦截鼠标，否则会挡住轨道控制
  element.style.pointerEvents = 'none'
  return element
}

export class LightGizmos {
  /** @param {object} scene three 的 Scene */
  constructor(scene) {
    if (!scene) throw new Error('LightGizmos 需要 Scene')
    this.scene = scene
    this.visible = false

    this.root = new Group()
    this.root.name = 'mv-light-gizmos'
    this.root.visible = false
    scene.add(this.root)

    // 三个标记点合成一个 Points：一次 draw call，屏幕像素大小恒定，永远画在模型之上
    this.markerGeometry = new BufferGeometry()
    this.markerGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3))
    this.markerGeometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(9), 3))
    this.markers = new Points(
      this.markerGeometry,
      new PointsMaterial({
        size: LIGHT_MARKER_SIZE,
        sizeAttenuation: false,
        vertexColors: true,
        depthTest: false,
        transparent: true,
      }),
    )
    this.markers.name = 'mv-light-gizmo-markers'
    this.markers.renderOrder = 3
    this.markers.frustumCulled = false
    this.root.add(this.markers)

    /** role → { line, geometry } */
    this.lines = new Map()
    /** role → CSS2DObject（Node 环境下为空，退化为只画点与线） */
    this.labels = new Map()
  }

  setVisible(visible) {
    this.visible = Boolean(visible)
    this.root.visible = this.visible
    /*
     * CSS2DRenderer 只看对象自身的 visible、不看父级：必须逐个设置标签的可见性，
     * 否则关掉「显示光源」后文字标签仍然挂在视口里（boundingBox.js 的 setVisible 同理）。
     */
    for (const label of this.labels.values()) label.visible = this.visible
  }

  /**
   * 按光照状态刷新（幂等，可反复调用）。
   * three 对象只创建一次，之后就地改属性 —— 光照面板拖动滑杆会高频调用它。
   */
  update(state) {
    const descriptors = describeLightGizmos(state)
    const positionAttr = this.markerGeometry.getAttribute('position')
    const colorAttr = this.markerGeometry.getAttribute('color')

    descriptors.forEach((item, index) => {
      positionAttr.setXYZ(index, item.position[0], item.position[1], item.position[2])
      const color = new Color(item.markerColor)
      colorAttr.setXYZ(index, color.r, color.g, color.b)

      this.updateLine(item)
      this.updateLabel(item)
    })

    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    this.markerGeometry.setDrawRange(0, descriptors.length)
    return descriptors
  }

  ensureLine(item) {
    let entry = this.lines.get(item.role)
    if (!entry) {
      const geometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()])
      const line = new Line(
        geometry,
        new LineBasicMaterial({ transparent: true, opacity: LIGHT_LINE_OPACITY, depthTest: false }),
      )
      line.name = `mv-light-gizmo-line-${item.role}`
      line.renderOrder = 3
      line.frustumCulled = false
      this.root.add(line)
      entry = { line, geometry }
      this.lines.set(item.role, entry)
    }
    return entry
  }

  updateLine(item) {
    const { line, geometry } = this.ensureLine(item)
    // 方向线：从光源位置画到它的朝向目标（原点）
    geometry.attributes.position.setXYZ(0, item.position[0], item.position[1], item.position[2])
    geometry.attributes.position.setXYZ(1, item.aim[0], item.aim[1], item.aim[2])
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
    line.material.color.set(item.markerColor)
    return line
  }

  updateLabel(item) {
    let label = this.labels.get(item.role)
    if (!label) {
      const element = createLabelElement()
      if (!element) return null // Node 环境：只画点与线
      label = new CSS2DObject(element)
      label.name = `mv-light-label-${item.role}`
      // 标签贴在标记点的右上角（center 是元素尺寸的比例，因此与缩放无关）
      label.center.set(-0.1, 1.15)
      this.root.add(label)
      this.labels.set(item.role, label)
    }
    label.element.textContent = item.text
    label.element.style.color = item.markerColor
    label.position.set(item.position[0], item.position[1], item.position[2])
    label.visible = this.visible
    return label
  }

  dispose() {
    // 逐个释放几何体/材质：removeFromParent 不会自动 dispose
    for (const { line, geometry } of this.lines.values()) {
      line.removeFromParent()
      geometry.dispose()
      line.material.dispose()
    }
    this.lines.clear()

    for (const label of this.labels.values()) label.removeFromParent()
    this.labels.clear()

    this.markers.removeFromParent()
    this.markerGeometry.dispose()
    this.markers.material.dispose()

    this.root.removeFromParent()
    this.scene = null
  }
}
