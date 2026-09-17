import { describe, expect, it } from 'vitest'

import {
  buildHeightFieldTriangles,
  encodeBinaryStl,
  heightAt,
  segmentsForTriangles,
} from '../scripts/make-benchmark-model.mjs'

/**
 * 性能基准模型生成器的自检。
 *
 * 为什么值得测：基准的可比性完全取决于"每次生成的模型都一样、三角面数与报告一致"。
 * 一旦 STL 头里的面数与实际载荷不符，查看器可能只读到一部分三角形，
 * 于是"性能回归"就变成了在测一个比预期小得多的模型（而且不报错）。
 */
describe('segmentsForTriangles', () => {
  it('反解出接近目标面数的网格边长（面数 = 边长² × 2）', () => {
    for (const segments of [1, 8, 64, 224]) {
      const triangles = segments * segments * 2
      expect(segmentsForTriangles(triangles)).toBe(segments)
    }
  })

  it('十万级目标落在 224×224（100,352 面）', () => {
    expect(segmentsForTriangles(100_000)).toBe(224)
  })

  it('非法输入不会产生零/负边长', () => {
    expect(segmentsForTriangles(0)).toBeGreaterThanOrEqual(1)
    expect(segmentsForTriangles(-100)).toBeGreaterThanOrEqual(1)
    expect(segmentsForTriangles(Number.NaN)).toBeGreaterThanOrEqual(1)
  })
})

describe('buildHeightFieldTriangles', () => {
  it('三角面数与顶点数据长度自洽', () => {
    const { triangles, count } = buildHeightFieldTriangles(16)
    expect(count).toBe(16 * 16 * 2)
    expect(triangles).toHaveLength(count * 9)
    expect(triangles.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('确定性：同样参数生成完全相同的数据（基准可比的前提）', () => {
    const first = buildHeightFieldTriangles(8)
    const second = buildHeightFieldTriangles(8)
    expect(Array.from(first.triangles)).toEqual(Array.from(second.triangles))
  })

  it('高度函数有实际起伏（不是一块平板）', () => {
    const heights = [heightAt(0, 0), heightAt(0.25, 0.25), heightAt(0.5, 0.5)]
    expect(new Set(heights).size).toBeGreaterThan(1)
  })
})

describe('encodeBinaryStl', () => {
  it('结构符合二进制 STL：80 字节头 + uint32 面数 + 每面 50 字节', () => {
    const { triangles, count } = buildHeightFieldTriangles(4)
    const buffer = encodeBinaryStl(triangles, count)

    expect(buffer).toHaveLength(84 + count * 50)
    // 文件头里的面数必须与载荷一致，否则查看器只会读到一部分
    expect(buffer.readUInt32LE(80)).toBe(count)
  })

  it('法线是单位向量（否则查看器要自己补算，基准会多出额外开销）', () => {
    const { triangles, count } = buildHeightFieldTriangles(4)
    const buffer = encodeBinaryStl(triangles, count)

    for (let face = 0; face < count; face += 1) {
      const base = 84 + face * 50
      const [nx, ny, nz] = [
        buffer.readFloatLE(base),
        buffer.readFloatLE(base + 4),
        buffer.readFloatLE(base + 8),
      ]
      const length = Math.hypot(nx, ny, nz)
      expect(length).toBeCloseTo(1, 5)
    }
  })

  it('零面数也不崩（边界输入）', () => {
    const buffer = encodeBinaryStl(new Float32Array(0), 0)
    expect(buffer).toHaveLength(84)
    expect(buffer.readUInt32LE(80)).toBe(0)
  })
})
