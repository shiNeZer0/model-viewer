import { describe, expect, it } from 'vitest'

import { describeError, rawErrorMessage, splitErrorCode } from './error-messages.js'

describe('splitErrorCode', () => {
  it('解析 CODE: 详情', () => {
    expect(splitErrorCode('UNSUPPORTED_FORMAT: .txt')).toEqual({
      code: 'UNSUPPORTED_FORMAT',
      detail: '.txt',
    })
  })

  it('详情里可包含冒号（Windows 路径）', () => {
    expect(splitErrorCode('FILE_NOT_FOUND: E:\\m\\a.glb')).toEqual({
      code: 'FILE_NOT_FOUND',
      detail: 'E:\\m\\a.glb',
    })
  })

  it('普通句子不被误判为错误码', () => {
    expect(splitErrorCode('加载失败了，请重试')).toBe(null)
    expect(splitErrorCode('some thing: else')).toBe(null)
    expect(splitErrorCode('')).toBe(null)
    expect(splitErrorCode(null)).toBe(null)
  })
})

describe('rawErrorMessage', () => {
  it('兼容字符串 / Error / 普通对象', () => {
    expect(rawErrorMessage('boom')).toBe('boom')
    expect(rawErrorMessage(new Error('boom'))).toBe('boom')
    expect(rawErrorMessage({ message: 'boom' })).toBe('boom')
    expect(rawErrorMessage(undefined)).toBe('')
  })
})

describe('describeError', () => {
  it('已知错误码翻译为中文提示', () => {
    expect(describeError('UNSUPPORTED_FORMAT: .exe')).toBe('不支持的文件格式：.exe')
    expect(describeError('GRANT_LIMIT_EXCEEDED: 32')).toContain('上限（32）')
    expect(describeError(new Error('FORMAT_NOT_IMPLEMENTED: fbx'))).toContain('尚未实现')
  })

  it('未知错误码原样返回，避免吞掉信息', () => {
    expect(describeError('WEIRD_CODE: x')).toBe('WEIRD_CODE: x')
  })

  it('非错误码文案原样返回，空值给出兜底', () => {
    expect(describeError('随便一句报错')).toBe('随便一句报错')
    expect(describeError('')).toBe('未知错误')
  })
})
