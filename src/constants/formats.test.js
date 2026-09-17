import { describe, expect, it } from 'vitest'

import {
  ENVIRONMENT_ACCEPT_ATTRIBUTE,
  ENVIRONMENT_DIALOG_FILTERS,
  ENVIRONMENT_EXTENSIONS,
  MODEL_FORMATS,
  OPEN_DIALOG_FILTERS,
  SUPPORTED_EXTENSIONS,
  extensionOf,
  isLoadableFormat,
  isSupportedFileName,
  resolveFormatById,
  resolveFormatByName,
} from './formats.js'

describe('环境贴图扩展名（M6-5）', () => {
  it('与后端 asset_scope.rs 的 ENVIRONMENT_EXTENSIONS 一致', () => {
    // 后端改动时这里会先失败
    expect([...ENVIRONMENT_EXTENSIONS].sort()).toEqual(['exr', 'hdr'])
  })

  it('不与模型扩展名重叠（否则选取对话框会互相污染）', () => {
    for (const extension of ENVIRONMENT_EXTENSIONS) {
      expect(SUPPORTED_EXTENSIONS).not.toContain(extension)
    }
  })

  it('过滤器与 accept 都由同一份列表推导', () => {
    expect(ENVIRONMENT_DIALOG_FILTERS[0].extensions).toEqual(ENVIRONMENT_EXTENSIONS)
    expect(ENVIRONMENT_ACCEPT_ATTRIBUTE).toBe('.hdr,.exr')
  })
})

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

  it('M5 起七种格式全部可加载', () => {
    // M0 只支持 glb/gltf/stl；M5 补齐了 fbx/obj/ply/3mf
    for (const formatId of ['glb', 'gltf', 'stl', 'fbx', 'obj', 'ply', '3mf']) {
      expect(isLoadableFormat(formatId), formatId).toBe(true)
    }
    expect(isLoadableFormat('unknown')).toBe(false)
    // 每个格式都必须已实现 loader（ModelLoader 按 id 分派）
    expect(MODEL_FORMATS.every((format) => format.loadable)).toBe(true)
  })

  it('isSupportedFileName 覆盖授权与加载的交集', () => {
    expect(isSupportedFileName('E:\\a\\b.3mf')).toBe(true)
    expect(isSupportedFileName('E:\\a\\b.exe')).toBe(false)
  })
})
