import { afterEach, describe, expect, it } from 'vitest'

import { createLoadingManager, disposeGltfDecoders, getGltfDecoders } from './ModelLoader.js'

/**
 * M6-3：MTL 绝对路径重写的**接线**测试。
 *
 * 为什么必须测到这里：纯函数单测（formatLoaders.test.js）只保证"给定请求字符串能算出正确 URL"，
 * 但真正的坑在于 URL 修饰器到底装没装、以及它在 MTL 场景下收到的到底是哪个字符串
 * （MTLLoader 会先自己 `baseUrl + url`）。因此这里直接调 `manager.resolveURL(...)`，
 * 复刻 three 各 loader 请求外部资源时走的那一步。
 */
describe('createLoadingManager 的 URL 修饰器', () => {
  // 与 Tauri convertFileSrc 的形态一致：整条路径百分号编码
  const toAssetUrl = (path) => `asset://localhost/${encodeURIComponent(path)}`

  it('桌面端：MTL 里被拼上 baseUrl 的盘符绝对路径被改写成 asset URL', () => {
    const manager = createLoadingManager({ assetMap: new Map(), toAssetUrl })

    // map_Kd C:\tex\a.png 经 MTLLoader 拼接后的真实形态
    expect(manager.resolveURL('asset://localhost/E%3A%5Cmodels%5CC:\\tex\\a.png')).toBe(
      toAssetUrl('C:\\tex\\a.png'),
    )
    // file:/// 形态同理（MTLLoader 会把它整个拼在 baseUrl 后面）
    expect(manager.resolveURL('asset://localhost/E%3A%5Cmodels%5Cfile:///E:/tex/b.png')).toBe(
      toAssetUrl('E:/tex/b.png'),
    )
  })

  it('桌面端：正常的 asset 请求与 http 资源一律原样通过（不能误判 scheme 里的 p:/）', () => {
    const manager = createLoadingManager({ assetMap: new Map(), toAssetUrl })

    const relative = 'asset://localhost/E%3A%5Cmodels%5Ctex.png'
    expect(manager.resolveURL(relative)).toBe(relative)

    const decoder = 'http://localhost/draco/draco_wasm_wrapper.js'
    expect(manager.resolveURL(decoder)).toBe(decoder)
  })

  it('Web 端：没有路径转换器时仍按 assetMap 重写相对引用', () => {
    const assetMap = new Map([
      ['tex.png', 'blob:http://localhost/tex'],
      ['textures/a.png', 'blob:http://localhost/a'],
    ])
    const manager = createLoadingManager({ assetMap, toAssetUrl: null })

    expect(manager.resolveURL('tex.png')).toBe('blob:http://localhost/tex')
    // 完整相对路径未命中时退回 basename
    expect(manager.resolveURL('other/dir/tex.png')).toBe('blob:http://localhost/tex')
    expect(manager.resolveURL('textures/a.png')).toBe('blob:http://localhost/a')
  })

  it('没有任何重写需求时请求原样通过（不装修饰器，零开销）', () => {
    const manager = createLoadingManager({})
    expect(manager.resolveURL('tex.png')).toBe('tex.png')
    expect(manager.resolveURL('C:\\tex\\a.png')).toBe('C:\\tex\\a.png')
  })
})

/**
 * 共享解码器：锁住"不再每次加载都重建 worker 池"这个保证。
 * 一旦退化回每次新建，连续打开压缩模型会静默变慢（功能仍然正常，所以只能靠测试拦）。
 */
describe('共享解码器缓存', () => {
  afterEach(() => {
    disposeGltfDecoders()
  })

  it('多次获取返回同一组实例', async () => {
    const first = await getGltfDecoders()
    const second = await getGltfDecoders()

    expect(second).toBe(first)
    expect(second.dracoLoader).toBe(first.dracoLoader)
    expect(second.ktx2Loader).toBe(first.ktx2Loader)
  })

  it('并发获取只创建一组（否则会泄漏多份 worker 池）', async () => {
    const [a, b, c] = await Promise.all([getGltfDecoders(), getGltfDecoders(), getGltfDecoders()])

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('释放后缓存清空，下一次重新建立；重复释放是空操作', async () => {
    const first = await getGltfDecoders()
    expect(disposeGltfDecoders()).toBe(true)
    expect(disposeGltfDecoders()).toBe(false)

    const second = await getGltfDecoders()
    expect(second).not.toBe(first)
  })

  it('首次拿不到 renderer 时，后续带上 renderer 会补做 KTX2 能力探测（且只做一次）', async () => {
    const decoders = await getGltfDecoders()
    expect(decoders.supportDetected).toBe(false)

    const renderer = {
      isWebGPURenderer: false,
      extensions: { has: () => false, get: () => null },
    }

    let detectCalls = 0
    const originalDetect = decoders.ktx2Loader.detectSupport.bind(decoders.ktx2Loader)
    decoders.ktx2Loader.detectSupport = (target) => {
      detectCalls += 1
      return originalDetect(target)
    }

    expect(await getGltfDecoders(renderer)).toBe(decoders)
    expect(detectCalls).toBe(1)
    expect(decoders.supportDetected).toBe(true)

    // 已探测过就不再重复：连续打开模型不该反复触发 GPU 能力探测
    await getGltfDecoders(renderer)
    expect(detectCalls).toBe(1)
  })
})
