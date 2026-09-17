import { describe, expect, it } from 'vitest'

import { createLoadingManager } from './ModelLoader.js'

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
