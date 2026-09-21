import { AgXToneMapping, NeutralToneMapping, NoToneMapping, PerspectiveCamera, Scene } from 'three'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHANNELS,
  DEFAULT_EXPOSURE,
  DEFAULT_POSTFX_SAMPLES,
  DEFAULT_SATURATION,
  DEFAULT_TONE_MAPPING,
  EXPOSURE_RANGE,
  PostFx,
  SATURATION_RANGE,
  SaturationShader,
  TONE_MAPPINGS,
  clampExposure,
  clampSaturation,
  normalizePostFxSettings,
  resolveToneMapping,
  saturationChannel,
} from './postfx.js'

describe('TONE_MAPPINGS', () => {
  it('id 唯一且能被解析成 three 常量', () => {
    const ids = TONE_MAPPINGS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolveToneMapping('none')).toBe(NoToneMapping)
    expect(resolveToneMapping('agx')).toBe(AgXToneMapping)
    expect(resolveToneMapping('neutral')).toBe(NeutralToneMapping)
  })

  it('未知 id 返回 null（由调用方决定回退值）', () => {
    expect(resolveToneMapping('nope')).toBe(null)
    expect(resolveToneMapping(undefined)).toBe(null)
  })
})

describe('clampExposure / clampSaturation', () => {
  it('夹到合法区间', () => {
    expect(clampExposure(0)).toBe(EXPOSURE_RANGE.min)
    expect(clampExposure(99)).toBe(EXPOSURE_RANGE.max)
    expect(clampSaturation(-1)).toBe(SATURATION_RANGE.min)
    expect(clampSaturation(9)).toBe(SATURATION_RANGE.max)
  })

  it('非法输入回退到默认值', () => {
    expect(clampExposure(Number.NaN)).toBe(DEFAULT_EXPOSURE)
    expect(clampExposure(undefined)).toBe(DEFAULT_EXPOSURE)
    expect(clampSaturation(null)).toBe(DEFAULT_SATURATION)
    expect(clampSaturation('abc')).toBe(DEFAULT_SATURATION)
  })
})

describe('normalizePostFxSettings', () => {
  it('空输入给出默认设置', () => {
    expect(normalizePostFxSettings()).toEqual({
      toneMapping: DEFAULT_TONE_MAPPING,
      exposure: DEFAULT_EXPOSURE,
      saturation: DEFAULT_SATURATION,
      enabled: true,
    })
  })

  it('非法色调映射回退，数值被夹紧，enabled 仅在显式 false 时关闭', () => {
    expect(normalizePostFxSettings({ toneMapping: 'bad' }).toneMapping).toBe(DEFAULT_TONE_MAPPING)
    expect(normalizePostFxSettings({ exposure: 100, saturation: -3 })).toMatchObject({
      exposure: EXPOSURE_RANGE.max,
      saturation: SATURATION_RANGE.min,
    })
    expect(normalizePostFxSettings({ enabled: false }).enabled).toBe(false)
    expect(normalizePostFxSettings({ enabled: 0 }).enabled).toBe(true)
  })
})

describe('SaturationShader', () => {
  it('具备 ShaderPass 需要的 uniforms 与着色器源码', () => {
    expect(Object.keys(SaturationShader.uniforms)).toEqual(['tDiffuse', 'saturation'])
    expect(SaturationShader.vertexShader).toContain('gl_Position')
    expect(SaturationShader.fragmentShader).toContain('tDiffuse')
    expect(SaturationShader.fragmentShader).toContain('saturation')
  })
})

/**
 * PostFx 的这两条行为都直接影响每帧开销，且都不会让画面出错（只影响快慢），
 * 所以它们退化了也不会有人报 BUG —— 必须靠单测拦。
 * 渲染器用替身：这里不碰 GPU，只验证 pass 开关与资源重建的时机。
 */
function createRendererStub() {
  return {
    toneMapping: NeutralToneMapping,
    toneMappingExposure: 1,
    render() {},
    getPixelRatio: () => 1,
    getSize: (target) => target.set(800, 600),
  }
}

function createConfiguredPostFx(options = {}) {
  /*
   * 只装饱和度通道：这组用例测的是"恒等跳过"与"MSAA 重建"这两条管线行为，
   * 而其它内置通道（AO/描边/泛光/景深）要真实相机与 GPU 资源，Node 下建不出来
   * —— 它们由文件末尾的冒烟测试单独覆盖。
   */
  const postFx = new PostFx(createRendererStub(), {}, {}, {
    channels: [saturationChannel],
    ...options,
  })
  postFx.setSize(800, 600, 1)
  postFx.ensureComposer()
  return postFx
}

describe('PostFx 的 pass 跳过与 MSAA 档位', () => {
  it('饱和度 = 1 时跳过恒等 pass，非 1 时恢复', () => {
    const postFx = createConfiguredPostFx()

    postFx.setSaturation(1)
    expect(postFx.saturationPass.enabled).toBe(false)
    expect(postFx.describe().saturationPassSkipped).toBe(true)

    postFx.setSaturation(1.5)
    expect(postFx.saturationPass.enabled).toBe(true)
    expect(postFx.describe().saturationPassSkipped).toBe(false)
    expect(postFx.saturationPass.uniforms.saturation.value).toBe(1.5)
  })

  it('samples 默认 4；降到 0 时丢掉旧 composer（samples 只能在创建 render target 时定）', () => {
    const postFx = createConfiguredPostFx()
    expect(postFx.samples).toBe(DEFAULT_POSTFX_SAMPLES)
    const first = postFx.composer

    expect(postFx.setSamples(0)).toBe(true)
    expect(postFx.composer).toBe(null)

    const second = postFx.ensureComposer()
    expect(second).not.toBe(first)
    expect(postFx.samples).toBe(0)
  })

  it('samples 未变化时不重建（避免白丢一遍 GPU 资源）', () => {
    const postFx = createConfiguredPostFx()
    const composer = postFx.composer
    expect(postFx.setSamples(DEFAULT_POSTFX_SAMPLES)).toBe(false)
    expect(postFx.composer).toBe(composer)

    // 非法值按 0 处理；已经是 0 时同样不重建
    expect(postFx.setSamples(0)).toBe(true)
    expect(postFx.setSamples(-1)).toBe(false)
    expect(postFx.samples).toBe(0)
  })

  it('describe 报告生效的 pass 与色调映射 id（供性能快照回显）', () => {
    const postFx = createConfiguredPostFx({ toneMapping: 'aces', exposure: 1.2 })

    const info = postFx.describe()
    expect(info.toneMapping).toBe('aces')
    expect(info.exposure).toBe(1.2)
    expect(info.samples).toBe(DEFAULT_POSTFX_SAMPLES)
    expect(info.passes.map((pass) => pass.name)).toEqual([
      'RenderPass',
      'ShaderPass',
      'OutputPass',
    ])
  })

  it('像素比未变化时不再重复调 composer.setPixelRatio', () => {
    const postFx = new PostFx(createRendererStub(), {}, {}, { channels: [saturationChannel] })
    postFx.setSize(800, 600, 2)
    postFx.ensureComposer()

    let calls = 0
    const original = postFx.composer.setPixelRatio.bind(postFx.composer)
    postFx.composer.setPixelRatio = (value) => {
      calls += 1
      return original(value)
    }

    postFx.setSize(800, 600, 2)
    expect(calls).toBe(0)

    postFx.setSize(800, 600, 1)
    expect(calls).toBe(1)
  })
})

/**
 * 通道架构：后续每个效果都是一个通道定义，这几条保证是它们共同依赖的地基。
 * 用替身通道（不是真 pass）来测，是为了让"顺序/开关/恒等跳过"这些管线自身的行为可独立验证。
 */
function createStubChannel(id, overrides = {}) {
  return {
    id,
    label: `通道-${id}`,
    order: 50,
    defaultEnabled: true,
    defaultSettings: { amount: 1 },
    ranges: { amount: { min: 0, max: 2, step: 0.1 } },
    create: () => ({ name: `pass-${id}`, enabled: true, setSize() {} }),
    update: (pass, settings) => {
      pass.amount = settings.amount
    },
    isIdentity: (settings) => settings.amount === 0,
    ...overrides,
  }
}

function createPostFxWith(channels, options = {}) {
  const postFx = new PostFx(createRendererStub(), {}, {}, { channels, ...options })
  postFx.setSize(800, 600, 1)
  postFx.ensureComposer()
  return postFx
}

describe('PostFx 通道架构', () => {
  it('按 order 升序组装，RenderPass 在最前、OutputPass 在最后', () => {
    const postFx = createPostFxWith([
      createStubChannel('late', { order: 90 }),
      createStubChannel('early', { order: 10 }),
    ])

    const names = postFx.composer.passes.map((pass) => pass.constructor?.name)
    expect(names).toEqual(['RenderPass', 'Object', 'Object', 'OutputPass'])
    // 中间两趟的顺序必须按 order：错的顺序会让效果叠加出完全不同的画面
    expect(postFx.composer.passes[1].name).toBe('pass-early')
    expect(postFx.composer.passes[2].name).toBe('pass-late')
  })

  it('开关通道只改 pass.enabled，不重建 composer（重建 render target 才是大开销）', () => {
    const postFx = createPostFxWith([createStubChannel('ao')])
    const composer = postFx.composer
    const pass = postFx.channels.get('ao').pass

    expect(postFx.setChannelEnabled('ao', false)).toBe(true)
    expect(pass.enabled).toBe(false)
    expect(postFx.composer).toBe(composer)

    expect(postFx.setChannelEnabled('ao', true)).toBe(true)
    expect(pass.enabled).toBe(true)

    // 值没变时不算"发生变化"
    expect(postFx.setChannelEnabled('ao', true)).toBe(false)
  })

  it('恒等变换的通道即使开着也不渲染（"跳过白跑一趟"的通用实现）', () => {
    const postFx = createPostFxWith([createStubChannel('ao')])
    const pass = postFx.channels.get('ao').pass

    expect(pass.enabled).toBe(true)

    postFx.setChannelSettings('ao', { amount: 0 })
    expect(pass.enabled).toBe(false)
    expect(postFx.describeChannels()[0].identity).toBe(true)

    postFx.setChannelSettings('ao', { amount: 1.5 })
    expect(pass.enabled).toBe(true)
    expect(pass.amount).toBe(1.5)
  })

  it('通道关闭时恒等与否都不渲染', () => {
    const postFx = createPostFxWith([createStubChannel('ao')], {
      channelEnabled: { ao: false },
    })
    const pass = postFx.channels.get('ao').pass

    expect(pass.enabled).toBe(false)
    postFx.setChannelSettings('ao', { amount: 1.5 })
    expect(pass.enabled).toBe(false)
  })

  it('describeChannels 给出 UI 需要的开关、参数与取值范围', () => {
    const postFx = createPostFxWith([createStubChannel('ao', { defaultSettings: { amount: 1.5 } })])

    expect(postFx.describeChannels()).toEqual([
      {
        id: 'ao',
        label: '通道-ao',
        enabled: true,
        identity: false,
        heavy: false,
        settings: { amount: 1.5 },
        ranges: { amount: { min: 0, max: 2, step: 0.1 } },
      },
    ])
  })

  it('操作未注册的通道返回 false 而不是抛错（设置里可能残留旧通道的键）', () => {
    const postFx = createPostFxWith([createStubChannel('ao')])
    expect(postFx.setChannelEnabled('nope', true)).toBe(false)
    expect(postFx.setChannelSettings('nope', { amount: 1 })).toBe(false)
    expect(postFx.setChannelSettings('ao', null)).toBe(false)
  })

  it('通道在当前环境创建失败时被跳过，管线仍可用', () => {
    const postFx = createPostFxWith([
      createStubChannel('broken', { create: () => null }),
      createStubChannel('ok', { order: 60 }),
    ])

    expect(postFx.channels.get('broken').pass).toBe(null)
    expect(postFx.composer.passes.map((pass) => pass.constructor?.name)).toEqual([
      'RenderPass',
      'Object',
      'OutputPass',
    ])
    expect(postFx.channels.get('ok').pass).not.toBe(null)
  })

  it('重建 composer（如切 MSAA）后通道被重新创建，且参数与开关保持', () => {
    const postFx = createPostFxWith([createStubChannel('ao')], {
      channelSettings: { ao: { amount: 1.5 } },
    })
    const firstPass = postFx.channels.get('ao').pass
    postFx.setChannelEnabled('ao', false)

    expect(postFx.setSamples(0)).toBe(true)
    expect(postFx.channels.get('ao').pass).toBe(null)

    postFx.ensureComposer()
    const secondPass = postFx.channels.get('ao').pass
    expect(secondPass).not.toBe(firstPass)
    // 参数与开关必须跟着走，否则切换 MSAA 会静默重置用户设置
    expect(secondPass.amount).toBe(1.5)
    expect(secondPass.enabled).toBe(false)
  })

  it('dispose 会调用通道自己的释放钩子（通道可能持有额外 render target）', () => {
    let disposed = 0
    const postFx = createPostFxWith([
      createStubChannel('ao', { dispose: () => { disposed += 1 } }),
    ])

    postFx.dispose()
    expect(disposed).toBe(1)
    expect(postFx.channels.get('ao').pass).toBe(null)
  })
})

/**
 * 内置通道的冒烟测试。
 *
 * 为什么必须有：通道文件里的 three API 用法（构造参数、uniform 名、setSize 行为）只有真正
 * 构造一次才能发现写错 —— 管线只管组装，不会替你验证这些。这里用真实的 Scene +
 * PerspectiveCamera（Node 下可创建），只跳过需要 GPU 的实际渲染。
 */
describe('内置通道冒烟测试', () => {
  const createContext = () => ({
    renderer: null,
    scene: new Scene(),
    camera: new PerspectiveCamera(50, 4 / 3, 0.1, 100),
    width: 320,
    height: 240,
    pixelRatio: 1,
  })

  it('每个内置通道都能创建、按尺寸同步、并干净释放', () => {
    expect(DEFAULT_CHANNELS.length).toBeGreaterThan(0)

    for (const definition of DEFAULT_CHANNELS) {
      const context = createContext()
      const pass = definition.create(context)
      expect(pass, `通道 ${definition.id} 应当能创建`).toBeTruthy()
      // EffectComposer.addPass 会立刻调一次 setSize，很多 pass 的 render target 在这里分配
      expect(() => pass.setSize(320, 240), `通道 ${definition.id} 的 setSize 不应抛错`).not.toThrow()
      expect(() => definition.dispose?.(pass), `通道 ${definition.id} 的释放不应抛错`).not.toThrow()
    }
  })

  it('通道 id 与 order 都唯一，且带 UI 需要的元信息', () => {
    const ids = DEFAULT_CHANNELS.map((item) => item.id)
    const orders = DEFAULT_CHANNELS.map((item) => item.order)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(orders).size).toBe(orders.length)

    for (const definition of DEFAULT_CHANNELS) {
      expect(typeof definition.label).toBe('string')
      expect(definition.label.length).toBeGreaterThan(0)
      expect(typeof definition.create).toBe('function')
    }
  })

  it('组装全部内置通道时 RenderPass 在最前、OutputPass 在最后（顺序错会让色调映射失效）', () => {
    const context = createContext()
    const postFx = new PostFx(createRendererStub(), context.scene, context.camera, {
      channels: DEFAULT_CHANNELS,
    })
    postFx.setSize(320, 240, 1)
    const passes = postFx.ensureComposer().passes

    expect(passes[0].constructor?.name).toBe('RenderPass')
    expect(passes[passes.length - 1].constructor?.name).toBe('OutputPass')
  })

  it('低性能模式只关「重」通道，轻量通道不受影响', () => {
    const context = createContext()
    const postFx = new PostFx(createRendererStub(), context.scene, context.camera, {
      channels: DEFAULT_CHANNELS,
    })
    postFx.setSize(320, 240, 1)
    postFx.ensureComposer()

    const heavy = postFx.heavyChannelIds()
    expect(heavy.length).toBeGreaterThan(0)
    // 描边/调色/饱和度是轻量的，没理由为了省性能牺牲它们
    expect(heavy).not.toContain('outline')
    expect(heavy).not.toContain('grade')
    expect(heavy).not.toContain('saturation')

    expect(postFx.setHeavyChannelsEnabled(false)).toBe(true)
    for (const id of heavy) expect(postFx.channels.get(id).enabled).toBe(false)
    expect(postFx.channels.get('grade').enabled).toBe(true)

    expect(postFx.setHeavyChannelsEnabled(true)).toBe(true)
    for (const id of heavy) expect(postFx.channels.get(id).enabled).toBe(true)
  })

  it('描边通道在未选中任何对象时自报恒等（跳过那一趟），选中后恢复', () => {
    const context = createContext()
    const postFx = new PostFx(createRendererStub(), context.scene, context.camera, {
      channels: DEFAULT_CHANNELS,
    })
    postFx.setSize(320, 240, 1)
    postFx.ensureComposer()

    const outline = postFx.channels.get('outline')
    expect(outline.enabled).toBe(true)
    expect(outline.pass.enabled).toBe(false)

    // 引擎写入选中对象后必须重新同步，否则描边永远不出现
    outline.pass.selectedObjects = [context.scene]
    postFx.refreshChannel('outline')
    expect(outline.pass.enabled).toBe(true)
  })
})
