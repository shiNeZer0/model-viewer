import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, watch } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDisplayStore } from './displayStore.js'

/**
 * 这些用例复刻 ModelCanvas 里的真实接线：
 *   computed(() => display.toEngineSettings) → watch → engine.applyDisplaySettings(...)
 * 「点了开关没反应」这类问题最常见的原因就出在这条链上，所以必须直接测它。
 *
 * 注意：所有 update 都传 { persist: false }，避免依赖存储后端（Node 下没有 localStorage/SQLite）。
 */
beforeEach(() => {
  setActivePinia(createPinia())
})

describe('displayStore 快照', () => {
  it('update 后快照反映新值', async () => {
    const display = useDisplayStore()
    await display.update('showGrid', true, { persist: false })
    expect(display.toEngineSettings.showGrid).toBe(true)

    await display.update('showAxes', false, { persist: false })
    expect(display.toEngineSettings.showAxes).toBe(false)
  })

  it('布尔类设置会把真值统一成 boolean（模板里 $event 可能是 string）', async () => {
    const display = useDisplayStore()
    await display.update('showGrid', 'yes', { persist: false })
    expect(display.toEngineSettings.showGrid).toBe(true)
    await display.update('showAxes', 0, { persist: false })
    expect(display.toEngineSettings.showAxes).toBe(false)
  })

  it('快照身份会变化，watch 能观察到（ModelCanvas 靠这个把设置推给引擎）', async () => {
    const display = useDisplayStore()
    const seen = []
    const snapshot = computed(() => display.toEngineSettings)
    watch(snapshot, (value) => seen.push({ grid: value.showGrid, axes: value.showAxes }))

    await display.update('showGrid', true, { persist: false })
    await nextTick()
    await display.update('showAxes', false, { persist: false })
    await nextTick()

    expect(seen).toEqual([
      { grid: true, axes: true },
      { grid: true, axes: false },
    ])
  })

  it('非法值被拒绝或收敛，不会把引擎带进坏状态', async () => {
    const display = useDisplayStore()
    const before = display.toEngineSettings.shadingMode
    await display.update('shadingMode', 'not-a-mode', { persist: false })
    expect(display.toEngineSettings.shadingMode).toBe(before)

    await display.update('exposure', 999, { persist: false })
    expect(display.toEngineSettings.exposure).toBeLessThanOrEqual(3)
    await display.update('exposure', Number.NaN, { persist: false })
    expect(Number.isFinite(display.toEngineSettings.exposure)).toBe(true)

    await display.update('saturation', -5, { persist: false })
    expect(display.toEngineSettings.saturation).toBe(0)

    await display.update('idleMs', -1, { persist: false })
    expect(display.toEngineSettings.idleMs).toBeGreaterThanOrEqual(0)

    await display.update('backgroundColor', 'not-a-color', { persist: false })
    expect(display.toEngineSettings.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('模型摆放开关默认开启，可单独关闭', async () => {
    const display = useDisplayStore()
    expect(display.toEngineSettings.centerModel).toBe(true)
    expect(display.toEngineSettings.alignToGround).toBe(true)

    await display.update('centerModel', false, { persist: false })
    expect(display.toEngineSettings.centerModel).toBe(false)
    expect(display.toEngineSettings.alignToGround).toBe(true)

    await display.update('alignToGround', false, { persist: false })
    expect(display.toEngineSettings.alignToGround).toBe(false)
  })

  it('摆放开关变化同样会让快照变化（引擎据此重新归一化并重算相机）', async () => {
    const display = useDisplayStore()
    const seen = []
    const snapshot = computed(() => display.toEngineSettings)
    watch(snapshot, (value) => seen.push([value.centerModel, value.alignToGround]))

    await display.update('alignToGround', false, { persist: false })
    await nextTick()
    expect(seen).toEqual([[true, false]])
  })

  it('M2：边界框与单位设置的默认值与更新', async () => {
    const display = useDisplayStore()
    expect(display.toEngineSettings.showBoundingBox).toBe(false)
    expect(display.toEngineSettings.sourceUnit).toBe('raw')
    expect(display.toEngineSettings.displayUnit).toBe('auto')

    await display.update('showBoundingBox', true, { persist: false })
    await display.update('sourceUnit', 'mm', { persist: false })
    await display.update('displayUnit', 'cm', { persist: false })
    expect(display.toEngineSettings).toMatchObject({
      showBoundingBox: true,
      sourceUnit: 'mm',
      displayUnit: 'cm',
    })
  })

  it('M2：非法单位被拒绝，不会污染引擎快照', async () => {
    const display = useDisplayStore()
    await display.update('sourceUnit', 'lightyear', { persist: false })
    expect(display.toEngineSettings.sourceUnit).toBe('raw')
    await display.update('displayUnit', 'furlong', { persist: false })
    expect(display.toEngineSettings.displayUnit).toBe('auto')
    await display.update('sourceUnit', 'in', { persist: false })
    expect(display.toEngineSettings.sourceUnit).toBe('in')
  })

  it('setNotes 去重并过滤空值', () => {
    const display = useDisplayStore()
    display.setNotes(['a', 'a', '', null, undefined, 'b'])
    expect(display.notes).toEqual(['a', 'b'])
    display.setNotes(null)
    expect(display.notes).toEqual([])
  })

  it('resetToDefaults 回到出厂设置', async () => {
    const display = useDisplayStore()
    await display.update('showGrid', true, { persist: false })
    await display.update('showAxes', false, { persist: false })
    display.resetToDefaults()
    expect(display.toEngineSettings.showGrid).toBe(false)
    expect(display.toEngineSettings.showAxes).toBe(true)
  })
})
