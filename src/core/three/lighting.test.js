import { Box3, Group, Line, Mesh, Points, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  LIGHT_LIMITS,
  LIGHT_ROLES,
  SCHEMA_VERSION,
  LightingRig,
  computeLightPosition,
  createDefaultLightingState,
  createThemePayload,
  degradeStaleImportedEnvironment,
  describeLightPositions,
  enableModelShadows,
  normalizeColor,
  normalizeLight,
  normalizeLightingState,
  parseThemePayload,
} from './lighting.js'

describe('computeLightPosition', () => {
  it('方位角 0°/仰角 0° 落在 +Z 轴上', () => {
    const [x, y, z] = computeLightPosition({ azimuth: 0, elevation: 0, radius: 10 })
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(10, 6)
  })

  it('方位角 90° 落在 +X 轴上', () => {
    const [x, , z] = computeLightPosition({ azimuth: 90, elevation: 0, radius: 10 })
    expect(x).toBeCloseTo(10, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('仰角 90° 在正上方，负仰角在下方', () => {
    const [topX, topY, topZ] = computeLightPosition({ azimuth: 0, elevation: 90, radius: 5 })
    expect(topY).toBeCloseTo(5, 6)
    expect(Math.hypot(topX, topZ)).toBeLessThan(1e-6)

    const [, belowY] = computeLightPosition({ azimuth: 0, elevation: -45, radius: 5 })
    expect(belowY).toBeLessThan(0)
  })

  it('到原点的距离恒等于半径', () => {
    for (const config of [
      { azimuth: 35, elevation: 40, radius: 10 },
      { azimuth: -120, elevation: 12, radius: 3 },
      { azimuth: 175, elevation: -60, radius: 40 },
    ]) {
      const position = computeLightPosition(config)
      expect(Math.hypot(...position)).toBeCloseTo(config.radius, 6)
    }
  })

  it('越界与非数值输入被收敛，不产生 NaN', () => {
    const clamped = computeLightPosition({ azimuth: 9999, elevation: -400, radius: -5 })
    expect(clamped.every((value) => Number.isFinite(value))).toBe(true)

    const fallback = computeLightPosition({ azimuth: Number.NaN, elevation: undefined, radius: 'x' })
    expect(fallback.every((value) => Number.isFinite(value))).toBe(true)
    expect(Math.hypot(...fallback)).toBeCloseTo(10, 6)
  })
})

describe('normalizeColor / normalizeLight', () => {
  it('非法颜色回退', () => {
    expect(normalizeColor('#ff8800')).toBe('#ff8800')
    expect(normalizeColor('red')).toBe('#ffffff')
    expect(normalizeColor(undefined, '#123456')).toBe('#123456')
  })

  it('光源字段被补全与夹取', () => {
    const light = normalizeLight({ intensity: 999, elevation: 400, color: 'bad' }, 'key')
    expect(light.role).toBe('key')
    expect(light.intensity).toBe(LIGHT_LIMITS.intensity.max)
    expect(light.elevation).toBe(LIGHT_LIMITS.elevation.max)
    expect(light.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(light.enabled).toBe(true)
  })
})

describe('normalizeLightingState', () => {
  it('固定补齐 key/fill/rim 三盏灯', () => {
    const state = normalizeLightingState({ lights: [{ role: 'rim', intensity: 3 }] })
    expect(state.lights.map((light) => light.role)).toEqual(LIGHT_ROLES.map((role) => role.id))
    expect(state.lights.find((light) => light.role === 'rim').intensity).toBe(3)
    // 未提供的灯沿用该角色在内置预设里的取值
    expect(state.lights.find((light) => light.role === 'key').intensity).toBeGreaterThan(0)
  })

  it('环境 source 非法时回退为 gradient，强度被夹取', () => {
    const state = normalizeLightingState({ environment: { source: 'space', intensity: 99 } })
    expect(state.environment.source).toBe('gradient')
    expect(state.environment.intensity).toBe(LIGHT_LIMITS.environmentIntensity.max)
  })

  it('默认状态等于影棚预设', () => {
    const state = createDefaultLightingState()
    expect(state.presetId).toBe('studio')
    expect(state.environment.source).toBe('room')
    expect(state.lights).toHaveLength(3)
  })

  it('保留未知的 presetId（用户自定义主题用）', () => {
    expect(normalizeLightingState({ presetId: 'custom-1' }).presetId).toBe('custom-1')
  })

  it('M6-5：imported 是合法的环境来源，导入贴图的四个字段都被保留', () => {
    const state = normalizeLightingState({
      environment: {
        source: 'imported',
        customHdrName: 'studio.hdr',
        customHdrUrl: 'asset://localhost/env/studio-abc.hdr',
        customHdrPath: 'C:\\Users\\me\\.model-viewer\\app\\env\\studio-abc.hdr',
        customHdrExtension: 'hdr',
      },
    })
    expect(state.environment.source).toBe('imported')
    expect(state.environment.customHdrName).toBe('studio.hdr')
    expect(state.environment.customHdrPath).toContain('studio-abc.hdr')
    expect(state.environment.customHdrExtension).toBe('hdr')
  })

  it('M6-5：导入字段的空值/非字符串一律收敛成 null', () => {
    const state = normalizeLightingState({
      environment: { source: 'imported', customHdrName: '', customHdrUrl: 42, customHdrPath: null },
    })
    expect(state.environment.customHdrName).toBeNull()
    expect(state.environment.customHdrUrl).toBeNull()
    expect(state.environment.customHdrPath).toBeNull()
    expect(state.environment.customHdrExtension).toBeNull()
  })
})

describe('degradeStaleImportedEnvironment（启动时的降级规则）', () => {
  it('有应用数据目录副本 → 保持不变（可跨会话复现）', () => {
    const environment = {
      source: 'imported',
      customHdrName: 'studio.hdr',
      customHdrUrl: 'asset://localhost/x.hdr',
      customHdrPath: 'C:\\app\\env\\studio-abc.hdr',
    }
    expect(degradeStaleImportedEnvironment(environment)).toEqual(environment)
  })

  it('没有副本（Web 端 blob 或副本被删）→ 退回渐变并清掉导入信息', () => {
    const degraded = degradeStaleImportedEnvironment({
      source: 'imported',
      customHdrName: 'studio.hdr',
      customHdrUrl: 'blob:http://localhost/dead',
      customHdrPath: null,
    })
    expect(degraded.source).toBe('gradient')
    expect(degraded.customHdrName).toBeNull()
    expect(degraded.customHdrUrl).toBeNull()
  })

  it('非 imported 来源原样返回', () => {
    const environment = { source: 'room' }
    expect(degradeStaleImportedEnvironment(environment)).toBe(environment)
    expect(degradeStaleImportedEnvironment(null)).toBeNull()
  })
})

describe('主题载荷', () => {
  it('createThemePayload 规范化光照并带上背景与渲染设置', () => {
    const payload = createThemePayload({
      lighting: { presetId: 'x', lights: [{ role: 'key', intensity: 5 }] },
      background: { mode: 'gradient', gradientTop: '#111111' },
      render: { exposure: 1.2 },
    })
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION)
    expect(payload.lighting.lights).toHaveLength(3)
    expect(payload.background.mode).toBe('gradient')
    expect(payload.render.exposure).toBe(1.2)
  })

  it('parseThemePayload 支持 JSON 字符串与对象', () => {
    const payload = createThemePayload({ lighting: { presetId: 'p1' } })
    const fromString = parseThemePayload(JSON.stringify(payload))
    const fromObject = parseThemePayload(payload)
    expect(fromString.ok).toBe(true)
    expect(fromObject.ok).toBe(true)
    expect(fromString.payload.lighting.presetId).toBe('p1')
  })

  it('拒绝垃圾数据并给出原因（不抛错）', () => {
    expect(parseThemePayload('{not json').ok).toBe(false)
    expect(parseThemePayload('{not json').error).toContain('JSON')
    expect(parseThemePayload(null).ok).toBe(false)
    expect(parseThemePayload([1, 2, 3]).ok).toBe(false)
    expect(parseThemePayload(42).ok).toBe(false)
  })

  it('拒绝来自更高版本的主题', () => {
    const result = parseThemePayload({ schemaVersion: SCHEMA_VERSION + 1, lighting: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('更高版本')
  })

  it('兼容没有 schemaVersion 的历史数据', () => {
    const result = parseThemePayload({ lights: [{ role: 'key', intensity: 2 }] })
    expect(result.ok).toBe(true)
    expect(result.payload.lighting.lights).toHaveLength(3)
  })
})

describe('LightingRig', () => {
  it('按状态摆好三盏平行光与半球光', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)

    const state = normalizeLightingState({
      presetId: 'none',
      ambient: { enabled: true, intensity: 0.5, skyColor: '#ff0000', groundColor: '#0000ff' },
      lights: [
        { role: 'key', enabled: true, intensity: 2, color: '#ffffff', azimuth: 90, elevation: 0, radius: 4 },
        { role: 'fill', enabled: false, intensity: 1, azimuth: 0, elevation: 0, radius: 4 },
        { role: 'rim', enabled: true, intensity: 3, azimuth: 0, elevation: 90, radius: 6 },
      ],
    })
    rig.apply(state)

    const key = rig.lights.get('key')
    expect(key.visible).toBe(true)
    expect(key.intensity).toBe(2)
    expect(key.position.x).toBeCloseTo(4, 5)
    expect(scene.children).toContain(key)

    const fill = rig.lights.get('fill')
    // 关闭的灯必须**留在场景里**（visible 保持 true）、只把强度归零：
    // 这样 three 算出的 numDirLights 恒定，拨开关不会触发全材质 shader 重编译
    expect(fill.visible).toBe(true)
    expect(fill.intensity).toBe(0)

    const rim = rig.lights.get('rim')
    expect(rim.position.y).toBeCloseTo(6, 5)

    expect(rig.hemisphere.intensity).toBe(0.5)
    expect(rig.hemisphere.visible).toBe(true)
    // 计数按"真的在发光"算，因此被关掉的 fill 不计入
    expect(rig.enabledCount).toBe(2)

    rig.dispose()
    expect(scene.children).toHaveLength(0)
  })

  it('开关光源只改强度、不改 visible（否则 numDirLights 变化会让全部材质重编译）', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)

    rig.apply(
      normalizeLightingState({ lights: [{ role: 'fill', enabled: true, intensity: 1 }] }),
    )
    const visibleWhileOn = [...rig.lights.values()].map((light) => light.visible)
    expect(rig.lights.get('fill').intensity).toBe(1)

    rig.apply(
      normalizeLightingState({ lights: [{ role: 'fill', enabled: false, intensity: 1 }] }),
    )
    expect(rig.lights.get('fill').intensity).toBe(0)
    // 关键保证：可见性序列完全没变 → program cache key 稳定
    expect([...rig.lights.values()].map((light) => light.visible)).toEqual(visibleWhileOn)
    expect(visibleWhileOn).toEqual([true, true, true])

    // 半球光同理：关掉环境光也只归零强度
    rig.apply(normalizeLightingState({ ambient: { enabled: false, intensity: 0.5 } }))
    expect(rig.hemisphere.visible).toBe(true)
    expect(rig.hemisphere.intensity).toBe(0)

    rig.dispose()
  })

  it('dispose 后场景里不残留光源', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)
    expect(scene.children.length).toBeGreaterThan(0)
    rig.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

describe('LightingRig 阴影', () => {
  it('默认不投影；开启后只有主光投影（三盏都投会互相干扰，反而看不清形体）', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)

    expect(rig.shadowEnabled).toBe(false)
    expect(rig.lights.get('key').castShadow).toBe(false)

    expect(rig.setShadowEnabled(true)).toBe(true)
    expect(rig.lights.get('key').castShadow).toBe(true)
    expect(rig.lights.get('fill').castShadow).toBe(false)
    expect(rig.lights.get('rim').castShadow).toBe(false)

    expect(rig.setShadowEnabled(false)).toBe(false)
    expect(rig.lights.get('key').castShadow).toBe(false)

    rig.dispose()
  })

  it('阴影相机是正交范围且覆盖包围球（含球心偏离原点的量）', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)
    rig.apply(normalizeLightingState({ lights: [{ role: 'key', enabled: true, radius: 10 }] }))

    const box = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 4, 2))
    expect(rig.fitShadowCamera(box)).not.toBe(null)

    const camera = rig.lights.get('key').shadow.camera
    // 包围球半径约 3.46、球心(0,2,0)偏离原点 2 → 范围必须比包围球本身更大
    expect(camera.right).toBeGreaterThan(3.46)
    expect(camera.left).toBeCloseTo(-camera.right, 10)
    expect(camera.top).toBeCloseTo(camera.right, 10)
    expect(camera.bottom).toBeCloseTo(-camera.right, 10)
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.far).toBeGreaterThan(camera.near)

    rig.dispose()
  })

  it('空包围盒/空值时不动相机参数（无模型时不该乱设）', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)

    expect(rig.fitShadowCamera(new Box3())).toBe(null)
    expect(rig.fitShadowCamera(null)).toBe(null)

    rig.dispose()
  })

  it('光源拉远后 near/far 随距离变宽（否则影子会被裁掉）', () => {
    const scene = new Scene()
    const rig = new LightingRig(scene)
    const box = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
    const camera = rig.lights.get('key').shadow.camera

    rig.apply(normalizeLightingState({ lights: [{ role: 'key', enabled: true, radius: 4 }] }))
    rig.fitShadowCamera(box)
    const farWhenNear = camera.far

    rig.apply(normalizeLightingState({ lights: [{ role: 'key', enabled: true, radius: 20 }] }))
    rig.fitShadowCamera(box)

    expect(camera.far).toBeGreaterThan(farWhenNear)
    expect(camera.near).toBeGreaterThan(0)

    rig.dispose()
  })
})

describe('enableModelShadows', () => {
  it('给所有网格打开投影与接收（three 的默认值都是 false）', () => {
    const root = new Group()
    const mesh = new Mesh()
    // 先钉住 three 的默认值：这条断言本身就是"为什么必须显式打开"的说明
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)

    root.add(mesh)
    const nested = new Group()
    const deep = new Mesh()
    nested.add(deep)
    root.add(nested)

    expect(enableModelShadows(root)).toEqual({ meshes: 2 })
    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(true)
    expect(deep.castShadow).toBe(true)
    expect(deep.receiveShadow).toBe(true)
  })

  it('不动点云与线（"仅线框"的覆盖层不该参与阴影）', () => {
    const root = new Group()
    const points = new Points()
    const line = new Line()
    root.add(points)
    root.add(line)

    expect(enableModelShadows(root)).toEqual({ meshes: 0 })
    expect(points.castShadow).toBe(false)
    expect(line.castShadow).toBe(false)
  })

  it('空输入不抛错（清空模型时会走到这里）', () => {
    expect(enableModelShadows(null)).toEqual({ meshes: 0 })
    expect(enableModelShadows(undefined)).toEqual({ meshes: 0 })
  })
})

describe('describeLightPositions', () => {
  it('给出三盏灯的世界坐标与颜色', () => {
    const described = describeLightPositions({ presetId: 'none' })
    expect(described).toHaveLength(3)
    expect(described[0].position.length()).toBeCloseTo(10, 5)
    expect(described.every((item) => item.color.isColor)).toBe(true)
  })
})
