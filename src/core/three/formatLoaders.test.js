import { describe, expect, it } from 'vitest'

import { extractLocalPath, nameOfUrl, normalizeReferenceUrl, siblingUrl } from './formatLoaders.js'

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
})
