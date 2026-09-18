import { Color, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'

import {
  LIGHT_GIZMO_AIM,
  LIGHT_GIZMO_DISABLED_COLOR,
  LIGHT_MARKER_SIZE,
  LightGizmos,
  describeLightGizmos,
} from './lightGizmos.js'
import { LIGHT_ROLES, computeLightPosition, createDefaultLightingState } from './lighting.js'

/** 取默认光照状态并把某一盏灯改成指定属性 */
function stateWithLight(role, patch) {
  const base = createDefaultLightingState()
  return {
    ...base,
    lights: base.lights.map((light) => (light.role === role ? { ...light, ...patch } : light)),
  }
}

describe('describeLightGizmos（纯函数）', () => {
  it('按 key/fill/rim 固定顺序给出三盏灯，位置来自 computeLightPosition', () => {
    const state = createDefaultLightingState()
    const gizmos = describeLightGizmos(state)

    expect(gizmos.map((item) => item.role)).toEqual(LIGHT_ROLES.map((role) => role.id))
    gizmos.forEach((item) => {
      const light = state.lights.find((entry) => entry.role === item.role)
      expect(item.position).toEqual(computeLightPosition(light))
      expect(item.label).toBe(LIGHT_ROLES.find((role) => role.id === item.role).label)
      // 朝向目标固定在原点：与 DirectionalLight 的默认 target 一致
      expect(item.aim).toEqual(LIGHT_GIZMO_AIM)
    })
  })

  it('标签文案带角色名与强度（两位小数）', () => {
    const gizmos = describeLightGizmos(stateWithLight('key', { intensity: 2.5 }))
    const key = gizmos.find((item) => item.role === 'key')
    expect(key.text).toBe(`${key.label} 2.50`)
  })

  it('开启的灯用自身颜色，关闭的用灰色并标注「已关闭」，但位置照旧画出来', () => {
    const state = stateWithLight('rim', { enabled: false, color: '#ff0000' })
    const gizmos = describeLightGizmos(state)
    const rim = gizmos.find((item) => item.role === 'rim')

    expect(rim.markerColor).toBe(LIGHT_GIZMO_DISABLED_COLOR)
    expect(rim.text).toContain('（已关闭）')
    // 关闭也要有位置：调参时看得出它本来在哪
    expect(rim.position).toEqual(computeLightPosition(state.lights.find((l) => l.role === 'rim')))
    expect(rim.position.some((value) => value !== 0)).toBe(true)
  })

  it('输入被规范化：非法状态也能给出三盏灯，强度会被夹取', () => {
    const gizmos = describeLightGizmos({ lights: [{ role: 'key', intensity: 999 }] })
    expect(gizmos).toHaveLength(3)
    const key = gizmos.find((item) => item.role === 'key')
    expect(Number(key.text.split(' ').pop())).toBeLessThan(999)
  })
})

describe('LightGizmos（Node 下只画点与线，标签自动退化）', () => {
  it('需要一个 Scene，否则立即报错', () => {
    expect(() => new LightGizmos(null)).toThrow()
  })

  it('默认不可见，且已挂到场景里（开关只切 visible）', () => {
    const scene = new Scene()
    const gizmos = new LightGizmos(scene)

    expect(gizmos.visible).toBe(false)
    expect(gizmos.root.parent).toBe(scene)
    expect(gizmos.root.visible).toBe(false)

    gizmos.setVisible(true)
    expect(gizmos.visible).toBe(true)
    expect(gizmos.root.visible).toBe(true)
    gizmos.setVisible(false)
    expect(gizmos.root.visible).toBe(false)
  })

  it('update 把标记点与方向线按状态写进去', () => {
    const scene = new Scene()
    const gizmos = new LightGizmos(scene)
    const descriptors = gizmos.update(stateWithLight('fill', { enabled: false }))

    const positions = gizmos.markerGeometry.getAttribute('position')
    descriptors.forEach((item, index) => {
      expect(positions.getX(index)).toBeCloseTo(item.position[0], 6)
      expect(positions.getY(index)).toBeCloseTo(item.position[1], 6)
      expect(positions.getZ(index)).toBeCloseTo(item.position[2], 6)

      const line = gizmos.lines.get(item.role).line
      expect(line.geometry.attributes.position.getX(0)).toBeCloseTo(item.position[0], 6)
      expect(line.geometry.attributes.position.getY(1)).toBeCloseTo(LIGHT_GIZMO_AIM[1], 6)
    })

    // 关闭的那盏用灰色
    const fill = descriptors.find((item) => item.role === 'fill')
    expect(new Color(fill.markerColor).getHexString()).toBe(
      new Color(LIGHT_GIZMO_DISABLED_COLOR).getHexString(),
    )
    expect(gizmos.markers.material.size).toBe(LIGHT_MARKER_SIZE)
    expect(gizmos.markers.material.sizeAttenuation).toBe(false)
    // 必须画在模型之上：光源位置不是几何体，被包住也要看得见
    expect(gizmos.markers.material.depthTest).toBe(false)
  })

  it('反复 update 不会重复创建方向线（拖滑杆时高频调用）', () => {
    const scene = new Scene()
    const gizmos = new LightGizmos(scene)
    gizmos.update(createDefaultLightingState())
    const firstLines = [...gizmos.lines.values()].map((entry) => entry.line)

    gizmos.update(stateWithLight('key', { azimuth: 120 }))
    expect(gizmos.lines.size).toBe(3)
    expect([...gizmos.lines.values()].map((entry) => entry.line)).toEqual(firstLines)
  })

  it('Node 环境（无 document）没有标签，也不抛错', () => {
    const scene = new Scene()
    const gizmos = new LightGizmos(scene)
    expect(() => gizmos.update(createDefaultLightingState())).not.toThrow()
    expect(gizmos.labels.size).toBe(0)
  })

  it('dispose 释放几何体/材质并摘出场景', () => {
    const scene = new Scene()
    const gizmos = new LightGizmos(scene)
    gizmos.update(createDefaultLightingState())

    const markerDispose = vi.spyOn(gizmos.markers.material, 'dispose')
    const lineDispose = vi.spyOn([...gizmos.lines.values()][0].line.material, 'dispose')

    gizmos.dispose()

    expect(markerDispose).toHaveBeenCalledTimes(1)
    expect(lineDispose).toHaveBeenCalledTimes(1)
    expect(gizmos.root.parent).toBeNull()
    expect(gizmos.lines.size).toBe(0)
  })
})
