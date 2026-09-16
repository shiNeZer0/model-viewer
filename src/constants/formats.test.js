import { describe, expect, it } from 'vitest'

import {
  MODEL_FORMATS,
  OPEN_DIALOG_FILTERS,
  SUPPORTED_EXTENSIONS,
  extensionOf,
  isLoadableFormat,
  isSupportedFileName,
  resolveFormatById,
  resolveFormatByName,
} from './formats.js'

describe('formats 注册表', () => {
  it('扩展名列表与后端 asset_scope.rs 的 SUPPORTED_EXTENSIONS 一致', () => {
    // 顺序无关，集合必须一致；后端改动时这里会先失败
    expect([...SUPPORTED_EXTENSIONS].sort()).toEqual(
      ['3mf', 'fbx', 'glb', 'gltf', 'obj', 'ply', 'stl'].sort(),
    )
  })

  it('每个格式 id 唯一且扩展名不重复', () => {
    const ids = MODEL_FORMATS.map((format) => format.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(SUPPORTED_EXTENSIONS).size).toBe(SUPPORTED_EXTENSIONS.length)
  })

  it('对话框过滤器首项包含全部受支持扩展名', () => {
    expect(OPEN_DIALOG_FILTERS[0].extensions).toEqual(SUPPORTED_EXTENSIONS)
  })
})

describe('extensionOf', () => {
  it('大小写不敏感，支持完整路径', () => {
    expect(extensionOf('robot.GLB')).toBe('glb')
    expect(extensionOf('E:\\models\\robot.stl')).toBe('stl')
    expect(extensionOf('/home/me/robot.3MF')).toBe('3mf')
  })

  it('无扩展名 / 隐藏文件 / 末尾点返回空串', () => {
    expect(extensionOf('robot')).toBe('')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('robot.')).toBe('')
    expect(extensionOf(undefined)).toBe('')
  })

  it('多点文件名只取最后一段', () => {
    expect(extensionOf('robot.lod0.glb')).toBe('glb')
  })
})

describe('resolveFormat*', () => {
  it('按文件名解析', () => {
    expect(resolveFormatByName('robot.glb')?.id).toBe('glb')
    expect(resolveFormatByName('notes.txt')).toBe(null)
    expect(resolveFormatByName('')).toBe(null)
  })

  it('按 id 解析（大小写不敏感）', () => {
    expect(resolveFormatById('GLTF')?.label).toContain('glTF')
    expect(resolveFormatById(undefined)).toBe(null)
    expect(resolveFormatById('unknown')).toBe(null)
  })

  it('M0 只声明 glb/gltf/stl 可加载', () => {
    expect(isLoadableFormat('glb')).toBe(true)
    expect(isLoadableFormat('gltf')).toBe(true)
    expect(isLoadableFormat('stl')).toBe(true)
    // M5 补齐后用例会随之更新
    expect(isLoadableFormat('fbx')).toBe(false)
    expect(isLoadableFormat('obj')).toBe(false)
    expect(isLoadableFormat('ply')).toBe(false)
    expect(isLoadableFormat('3mf')).toBe(false)
  })

  it('isSupportedFileName 覆盖授权与加载的交集', () => {
    expect(isSupportedFileName('E:\\a\\b.3mf')).toBe(true)
    expect(isSupportedFileName('E:\\a\\b.exe')).toBe(false)
  })
})
