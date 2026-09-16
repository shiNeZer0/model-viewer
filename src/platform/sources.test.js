import { describe, expect, it } from 'vitest'

import {
  createModelSource,
  extensionMismatchWarning,
  fileNameOf,
  preferredFormatId,
  syntheticId,
} from './sources.js'

describe('fileNameOf', () => {
  it('兼容 Windows 与 POSIX 分隔符', () => {
    expect(fileNameOf('E:\\models\\robot.glb')).toBe('robot.glb')
    expect(fileNameOf('/home/me/robot.stl')).toBe('robot.stl')
    expect(fileNameOf('robot.obj')).toBe('robot.obj')
    expect(fileNameOf('')).toBe('')
    expect(fileNameOf(undefined)).toBe('')
  })
})

describe('extensionMismatchWarning', () => {
  it('格式一致或无法嗅探时不提示', () => {
    expect(extensionMismatchWarning({ formatId: 'glb', sniffedFormatId: 'glb' })).toBe(null)
    expect(extensionMismatchWarning({ formatId: 'glb', sniffedFormatId: null })).toBe(null)
    expect(extensionMismatchWarning({ formatId: null, sniffedFormatId: 'glb' })).toBe(null)
  })

  it('不一致时给出可读提示', () => {
    const warning = extensionMismatchWarning({ formatId: 'gltf', sniffedFormatId: 'glb' })
    expect(warning).toContain('gltf')
    expect(warning).toContain('glb')
  })
})

describe('preferredFormatId', () => {
  it('嗅探优先，失败回退扩展名', () => {
    expect(preferredFormatId('gltf', 'glb')).toBe('glb')
    expect(preferredFormatId('gltf', null)).toBe('gltf')
  })
})

describe('syntheticId', () => {
  it('用文件名与大小合成稳定键', () => {
    expect(syntheticId('robot.glb', 1024)).toBe('robot.glb::1024')
    expect(syntheticId('robot.glb')).toBe('robot.glb::0')
  })
})

describe('createModelSource', () => {
  const base = {
    id: 'E:\\models\\robot.glb',
    name: 'robot.glb',
    sizeBytes: 2048,
    formatId: 'glb',
    url: 'asset://localhost/E%3A/models/robot.glb',
  }

  it('输出可供 loader 使用的统一结构', () => {
    const source = createModelSource(base)
    expect(source.loadFormatId).toBe('glb')
    expect(source.warnings).toEqual([])
    expect(source.assetMap.size).toBe(0)
    expect(source.isZipContainer).toBe(false)
  })

  it('格式不一致时写入提示，并按真实格式加载', () => {
    const source = createModelSource({ ...base, formatId: 'gltf', sniffedFormatId: 'glb' })
    expect(source.loadFormatId).toBe('glb')
    expect(source.warnings).toHaveLength(1)
  })

  it('合并后端补充的提示，并过滤空值', () => {
    const source = createModelSource({
      ...base,
      formatId: 'gltf',
      sniffedFormatId: 'glb',
      extraWarnings: ['已退化为仅授权该文件', null, undefined, ''],
    })
    expect(source.warnings).toEqual([
      expect.stringContaining('不一致'),
      '已退化为仅授权该文件',
    ])
  })

  it('保留 assetMap 引用（Web 多文件格式依赖它重写外部资源）', () => {
    const assetMap = new Map([['robot.bin', 'blob:http://localhost/1']])
    const source = createModelSource({ ...base, assetMap })
    expect(source.assetMap.get('robot.bin')).toBe('blob:http://localhost/1')
  })
})
