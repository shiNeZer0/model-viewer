import { describe, expect, it } from 'vitest'

import { baseNameOfUrl, resolveAssetUrl } from './url-rewrite.js'

describe('baseNameOfUrl', () => {
  it('去掉目录、query 与 hash', () => {
    expect(baseNameOfUrl('textures/a.png')).toBe('a.png')
    expect(baseNameOfUrl('textures\\a.png')).toBe('a.png')
    expect(baseNameOfUrl('a.png?v=2')).toBe('a.png')
    expect(baseNameOfUrl('a.png#frag')).toBe('a.png')
    expect(baseNameOfUrl('')).toBe('')
  })
})

describe('resolveAssetUrl', () => {
  const assetMap = new Map([
    ['textures/a.png', 'blob:http://localhost/tex'],
    ['robot.bin', 'blob:http://localhost/bin'],
  ])

  it('完整相对路径优先', () => {
    expect(resolveAssetUrl('textures/a.png', assetMap)).toBe('blob:http://localhost/tex')
  })

  it('完整路径未命中时退回 basename', () => {
    // gltf/mtl 里常写相对路径，而用户选择的文件只有 basename，因此必须有这层兜底
    expect(resolveAssetUrl('other/dir/robot.bin', assetMap)).toBe('blob:http://localhost/bin')
  })

  it('basename 也不在映射里时原样返回', () => {
    expect(resolveAssetUrl('other/dir/a.png', assetMap)).toBe('other/dir/a.png')
  })

  it('未命中时原样返回（保留原始报错信息，便于定位缺失资源）', () => {
    expect(resolveAssetUrl('missing.png', assetMap)).toBe('missing.png')
  })

  it('assetMap 为空或非法时不做任何改写（桌面端路径）', () => {
    expect(resolveAssetUrl('robot.bin', new Map())).toBe('robot.bin')
    expect(resolveAssetUrl('robot.bin', null)).toBe('robot.bin')
    expect(resolveAssetUrl('', assetMap)).toBe('')
  })
})
