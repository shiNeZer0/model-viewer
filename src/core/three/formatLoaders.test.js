import { describe, expect, it } from 'vitest'

import {
  extractEmbeddedLocalPath,
  extractLocalPath,
  nameOfUrl,
  normalizeReferenceUrl,
  siblingUrl,
} from './formatLoaders.js'

describe('nameOfUrl', () => {
  it('从 URL 取文件名并解码', () => {
    expect(nameOfUrl('http://asset.localhost/E%3A%5Cmodels%5Ccube.mtl')).toBe('cube.mtl')
    expect(nameOfUrl('blob:http://localhost/a/b/c.obj?v=1')).toBe('c.obj')
    expect(nameOfUrl('')).toBe('')
  })
})

describe('siblingUrl', () => {
  it('替换扩展名推导兄弟文件', () => {
    expect(siblingUrl('http://asset.localhost/E%3A%5Cm%5Ccube.obj', 'mtl')).toBe(
      'http://asset.localhost/E%3A%5Cm%5Ccube.mtl',
    )
    expect(siblingUrl('/models/cube.obj', '.mtl')).toBe('/models/cube.mtl')
  })

  it('保留 query / hash', () => {
    expect(siblingUrl('/m/cube.obj?v=2', 'mtl')).toBe('/m/cube.mtl?v=2')
    expect(siblingUrl('/m/cube.obj#frag', 'mtl')).toBe('/m/cube.mtl#frag')
  })

  it('无扩展名时追加；非法输入返回 null', () => {
    expect(siblingUrl('/m/cube', 'mtl')).toBe('/m/cube.mtl')
    expect(siblingUrl('', 'mtl')).toBe(null)
    expect(siblingUrl(null, 'mtl')).toBe(null)
    expect(siblingUrl('/m/cube.obj', '')).toBe(null)
  })

  it('目录名里的点不会被误当成扩展名', () => {
    expect(siblingUrl('/m/v1.2/cube', 'mtl')).toBe('/m/v1.2/cube.mtl')
  })
})

describe('extractLocalPath', () => {
  it('识别 Windows 盘符路径', () => {
    expect(extractLocalPath('E:\\models\\tex.png')).toBe('E:\\models\\tex.png')
    expect(extractLocalPath('C:/models/tex.png')).toBe('C:/models/tex.png')
  })

  it('识别 file:// URL：Windows 去掉盘符前斜杠，POSIX 保留前导斜杠', () => {
    expect(extractLocalPath('file:///E:/models/tex.png')).toBe('E:/models/tex.png')
    // POSIX 下 /home/... 本身就是绝对路径，前导斜杠必须保留
    expect(extractLocalPath('file:///home/u/tex.png')).toBe('/home/u/tex.png')
    expect(extractLocalPath('file:///E:/a%20b/tex.png')).toBe('E:/a b/tex.png')
  })

  it('相对路径与普通 URL 返回 null（交回常规解析）', () => {
    expect(extractLocalPath('textures/tex.png')).toBe(null)
    expect(extractLocalPath('../tex.png')).toBe(null)
    expect(extractLocalPath('http://example.com/tex.png')).toBe(null)
    expect(extractLocalPath('')).toBe(null)
    expect(extractLocalPath(null)).toBe(null)
  })
})

describe('normalizeReferenceUrl', () => {
  const assetMap = new Map([['tex.png', 'blob:http://localhost/tex']])

  it('优先走 assetMap（完整路径 → basename 兜底）', () => {
    expect(normalizeReferenceUrl('tex.png', { assetMap })).toBe('blob:http://localhost/tex')
    expect(normalizeReferenceUrl('other/dir/tex.png', { assetMap })).toBe('blob:http://localhost/tex')
  })

  it('绝对本地路径用转换器改写成 asset URL', () => {
    const toAssetUrl = (path) => `asset://localhost/${encodeURIComponent(path)}`
    expect(normalizeReferenceUrl('E:\\m\\tex.png', { toAssetUrl })).toBe(
      `asset://localhost/${encodeURIComponent('E:\\m\\tex.png')}`,
    )
  })

  it('未命中且无转换器时原样返回（保证缺失资源能被正常上报）', () => {
    expect(normalizeReferenceUrl('missing.png', { assetMap })).toBe('missing.png')
    expect(normalizeReferenceUrl('E:\\m\\tex.png', {})).toBe('E:\\m\\tex.png')
    const broken = () => null
    expect(normalizeReferenceUrl('E:\\m\\tex.png', { toAssetUrl: broken })).toBe('E:\\m\\tex.png')
  })

  it('空输入安全返回', () => {
    expect(normalizeReferenceUrl('')).toBe('')
    expect(normalizeReferenceUrl(null)).toBe(null)
    expect(normalizeReferenceUrl(undefined)).toBe(undefined)
  })

  it('MTL 场景：请求已被 MTLLoader 拼上 baseUrl 时也能救回绝对路径', () => {
    const toAssetUrl = (path) => `asset://localhost/${encodeURIComponent(path)}`
    // MTLLoader 自己只认 http(s) 为绝对地址，其余一律 baseUrl + url
    expect(
      normalizeReferenceUrl('asset://localhost/E%3A%5Cmodels%5CC:\\tex\\a.png', { toAssetUrl }),
    ).toBe(toAssetUrl('C:\\tex\\a.png'))
    // 原始形态（loader 直接给绝对路径）同样支持
    expect(normalizeReferenceUrl('C:\\tex\\a.png', { assetMap: new Map(), toAssetUrl })).toBe(
      toAssetUrl('C:\\tex\\a.png'),
    )
    // assetMap 优先级最高：Web 端相对引用走 blob，不会因为"顺手能转本地路径"就被改写
    expect(
      normalizeReferenceUrl('tex.png', {
        assetMap: new Map([['tex.png', 'blob:http://localhost/tex']]),
        toAssetUrl,
      }),
    ).toBe('blob:http://localhost/tex')
  })
})

describe('extractEmbeddedLocalPath', () => {
  it('从被拼过 baseUrl 的请求里救回盘符路径（取最后一个，前面的是 base 自身）', () => {
    expect(extractEmbeddedLocalPath('asset://localhost/E%3A%5Cmodels%5CC:\\tex\\a.png')).toBe(
      'C:\\tex\\a.png',
    )
    expect(extractEmbeddedLocalPath('asset://localhost/E:/models/C:/tex/a.png')).toBe(
      'C:/tex/a.png',
    )
  })

  it('file:/// 形态：从 file:/// 起截断而不是被后面的盘符带偏', () => {
    expect(extractEmbeddedLocalPath('asset://localhost/E%3A%5Cmodels%5Cfile:///E:/tex/a.png')).toBe(
      'E:/tex/a.png',
    )
  })

  it('不误判 scheme 里的 X:/（http:// 的 p:/、asset:// 的 t:/）', () => {
    expect(extractEmbeddedLocalPath('http://localhost/draco/draco_wasm_wrapper.js')).toBe(null)
    expect(extractEmbeddedLocalPath('blob:http://localhost/abc')).toBe(null)
    // 编码过的 baseUrl 里没有字面冒号，纯相对引用必须原样放行
    expect(extractEmbeddedLocalPath('asset://localhost/E%3A%5Cmodels%5Ctex.png')).toBe(null)
  })

  it('本身就是绝对路径时交给 extractLocalPath，不在这里重复处理', () => {
    expect(extractEmbeddedLocalPath('C:\\tex\\a.png')).toBe(null)
    expect(extractEmbeddedLocalPath('file:///E:/a.png')).toBe(null)
  })

  it('未编码的 asset base：还原出的路径仍指向同一个文件（无害）', () => {
    expect(extractEmbeddedLocalPath('asset://localhost/E:/models/tex.png')).toBe(
      'E:/models/tex.png',
    )
  })

  it('空输入返回 null', () => {
    expect(extractEmbeddedLocalPath('')).toBe(null)
    expect(extractEmbeddedLocalPath(null)).toBe(null)
    expect(extractEmbeddedLocalPath(undefined)).toBe(null)
  })
})
