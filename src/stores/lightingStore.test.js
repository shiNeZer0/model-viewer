import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 用内存假后端替换持久化门面（vi.hoisted 保证 mock 工厂能安全引用它）。
 * 这样就能在没有 SQLite/localStorage 的 Node 环境下验证主题的保存/应用链路。
 */
const storage = vi.hoisted(() => ({ settings: {}, themes: [] }))

vi.mock('../platform/storage/index.js', () => ({
  readAllSettings: vi.fn(async () => ({ ...storage.settings })),
  writeSetting: vi.fn(async (key, value) => {
    storage.settings[key] = value
  }),
  listLightingThemes: vi.fn(async () => [...storage.themes]),
  upsertLightingTheme: vi.fn(async ({ name, payload }) => {
    const existing = storage.themes.find((theme) => theme.name === name)
    if (existing) {
      existing.payload = payload
    } else {
      storage.themes.push({ id: storage.themes.length + 1, name, payload })
    }
  }),
  renameLightingTheme: vi.fn(async (id, name) => {
    const target = storage.themes.find((theme) => theme.id === id)
    if (target) target.name = name
  }),
  deleteLightingTheme: vi.fn(async (id) => {
    storage.themes = storage.themes.filter((theme) => theme.id !== id)
  }),
}))

const { useLightingStore } = await import('./lightingStore.js')
const { useDisplayStore } = await import('./displayStore.js')

beforeEach(() => {
  storage.settings = {}
  storage.themes = []
  setActivePinia(createPinia())
})

describe('lightingStore 初始状态', () => {
  it('默认等于「影棚」预设（三点光源 + RoomEnvironment）', () => {
    const lighting = useLightingStore()
    expect(lighting.lighting.presetId).toBe('studio')
    expect(lighting.lighting.lights.map((light) => light.role)).toEqual(['key', 'fill', 'rim'])
    expect(lighting.lighting.environment.source).toBe('room')
    expect(lighting.matchedPresetId).toBe('studio')
  })

  it('引擎快照是纯数据且含三盏灯', () => {
    const lighting = useLightingStore()
    const snapshot = lighting.toEngineSettings
    expect(snapshot.lights).toHaveLength(3)
    expect(snapshot.environment.source).toBe('room')
    expect(Object.keys(snapshot).sort()).toEqual(['ambient', 'environment', 'lights', 'presetId'])
  })
})

describe('lightingStore 实时调节', () => {
  it('updateLight 收敛数值并写入设置', async () => {
    const lighting = useLightingStore()
    await lighting.updateLight('key', { intensity: 999, elevation: 400 })

    const key = lighting.lighting.lights.find((light) => light.role === 'key')
    expect(key.intensity).toBeLessThanOrEqual(10)
    expect(key.elevation).toBeLessThanOrEqual(90)
    expect(storage.settings['lighting.state'].lights).toHaveLength(3)
  })

  it('persist=false 时只改内存不落库（滑杆拖动过程）', async () => {
    const lighting = useLightingStore()
    await lighting.updateLight('fill', { intensity: 1.23 }, { persist: false })
    expect(lighting.lighting.lights.find((light) => light.role === 'fill').intensity).toBeCloseTo(1.23, 5)
    expect(storage.settings['lighting.state']).toBeUndefined()
  })

  it('updateEnvironment 非法来源被回退，强度被夹取', async () => {
    const lighting = useLightingStore()
    await lighting.updateEnvironment({ source: 'space', intensity: 99 })
    expect(lighting.lighting.environment.source).toBe('gradient')
    expect(lighting.lighting.environment.intensity).toBeLessThanOrEqual(5)
  })

  it('updateAmbient 可开关并调强度', async () => {
    const lighting = useLightingStore()
    await lighting.updateAmbient({ enabled: false, intensity: 0.5 })
    expect(lighting.lighting.ambient.enabled).toBe(false)
    expect(lighting.lighting.ambient.intensity).toBeCloseTo(0.5, 5)
  })
})

describe('lightingStore 预设', () => {
  it('applyPreset 同时套用光照、背景与色调', async () => {
    const lighting = useLightingStore()
    const display = useDisplayStore()

    await lighting.applyPreset('none')
    expect(lighting.lighting.presetId).toBe('none')
    expect(lighting.lighting.environment.source).toBe('none')
    expect(lighting.matchedPresetId).toBe('none')

    // 预设携带的背景与色调必须一起生效（否则"整体观感"会串）
    expect(display.background).toBe('solid')
    expect(display.toneMapping).toBe('none')

    await lighting.applyPreset('panorama')
    expect(display.background).toBe('environment')
  })

  it('未知预设不改变当前状态', async () => {
    const lighting = useLightingStore()
    await lighting.applyPreset('not-exist')
    expect(lighting.lighting.presetId).toBe('studio')
  })
})

describe('lightingStore 主题', () => {
  it('保存主题会写入存储并记录 activeThemeId', async () => {
    const lighting = useLightingStore()
    await lighting.updateLight('key', { intensity: 4.25 })
    const saved = await lighting.saveTheme('我的打光')

    expect(saved?.name).toBe('我的打光')
    expect(lighting.themes).toHaveLength(1)
    expect(lighting.activeThemeId).toBe(saved.id)

    const payload = storage.themes[0].payload
    expect(payload.schemaVersion).toBe(1)
    expect(payload.lighting.lights).toHaveLength(3)
    expect(payload.background).toBeTruthy()
    expect(payload.render).toBeTruthy()
  })

  it('保存同名主题视为覆盖，不产生重复项', async () => {
    const lighting = useLightingStore()
    await lighting.saveTheme('t1')
    await lighting.updateLight('key', { intensity: 7 })
    await lighting.saveTheme('t1')

    expect(lighting.themes).toHaveLength(1)
    expect(storage.themes[0].payload.lighting.lights.find((l) => l.role === 'key').intensity).toBe(7)
  })

  it('空名称被拒绝', async () => {
    const lighting = useLightingStore()
    await expect(lighting.saveTheme('   ')).rejects.toThrow()
  })

  it('applyTheme 完整恢复光照与背景', async () => {
    const lighting = useLightingStore()
    const display = useDisplayStore()

    await lighting.applyPreset('sunset')
    const sunsetKeyIntensity = lighting.lighting.lights.find((l) => l.role === 'key').intensity
    const sunsetBackground = display.backgroundSnapshot
    await lighting.saveTheme('黄昏存档')

    // 切到完全不同的观感
    await lighting.applyPreset('none')
    expect(display.background).toBe('solid')

    await lighting.applyTheme(lighting.themes[0].id)
    expect(lighting.lighting.lights.find((l) => l.role === 'key').intensity).toBeCloseTo(sunsetKeyIntensity, 5)
    expect(display.background).toBe(sunsetBackground.mode)
    expect(activeThemeIdOf(lighting)).toBe(lighting.themes[0].id)
  })

  it('applyTheme 对不存在的主题抛错', async () => {
    const lighting = useLightingStore()
    await expect(lighting.applyTheme(999)).rejects.toThrow()
  })

  it('损坏的主题数据被拒绝并给出原因', async () => {
    const lighting = useLightingStore()
    storage.themes.push({ id: 7, name: '坏的', payload: '{not json' })
    await lighting.refreshThemes()
    await expect(lighting.applyTheme(7)).rejects.toThrow(/JSON/)
  })

  it('删除主题后 activeThemeId 被清空', async () => {
    const lighting = useLightingStore()
    const saved = await lighting.saveTheme('t2')
    await lighting.removeTheme(saved.id)
    expect(lighting.themes).toHaveLength(0)
    expect(lighting.activeThemeId).toBe(null)
  })

  it('重命名主题', async () => {
    const lighting = useLightingStore()
    const saved = await lighting.saveTheme('old-name')
    await lighting.renameTheme(saved.id, 'new-name')
    expect(lighting.themes[0].name).toBe('new-name')
    await expect(lighting.renameTheme(saved.id, '  ')).rejects.toThrow()
  })

  it('load 会读回上次保存的光照状态与主题列表', async () => {
    storage.settings['lighting.state'] = { presetId: 'forest', lights: [], environment: { source: 'none' } }
    storage.settings['lighting.activeThemeId'] = 3
    storage.themes.push({ id: 3, name: '历史主题', payload: { schemaVersion: 1, lighting: {} } })

    const lighting = useLightingStore()
    await lighting.load()

    expect(lighting.lighting.presetId).toBe('forest')
    // 状态里缺字段时由规范化补齐三盏灯
    expect(lighting.lighting.lights).toHaveLength(3)
    expect(lighting.activeThemeId).toBe(3)
    expect(lighting.themes).toHaveLength(1)
    expect(lighting.loaded).toBe(true)
  })
})

function activeThemeIdOf(lighting) {
  return lighting.activeThemeId
}
