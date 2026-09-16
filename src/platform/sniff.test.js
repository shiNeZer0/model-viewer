import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { hexToBytes, isZipContainer, sniffFormat } from './sniff.js'

// 与 Rust 共享同一份测试向量：任何一侧的规则漂移都会在这里暴露
const fixturePath = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  'tests',
  'fixtures',
  'format-sniff-cases.json',
)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

describe('sniffFormat（与 Rust 共享测试向量）', () => {
  for (const testCase of fixture.cases) {
    it(`${testCase.name} → ${testCase.expected ?? 'null'}`, () => {
      const head = hexToBytes(testCase.hex)
      expect(sniffFormat(head, testCase.fileLen)).toBe(testCase.expected)
    })
  }

  it('空输入与 null 不抛错', () => {
    expect(sniffFormat(null, 0)).toBe(null)
    expect(sniffFormat(new Uint8Array(0), 0)).toBe(null)
  })

  it('isZipContainer 只认 ZIP 头', () => {
    expect(isZipContainer(hexToBytes('504b0304'))).toBe(true)
    expect(isZipContainer(hexToBytes('676c5446'))).toBe(false)
    expect(isZipContainer(null)).toBe(false)
  })
})
