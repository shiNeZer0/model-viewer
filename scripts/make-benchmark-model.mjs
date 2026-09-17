#!/usr/bin/env node
/**
 * 生成性能回归用的大模型（默认十万级三角面）。
 *
 * 为什么要现成脚本：性能回归需要"每次都用同一个模型"才有可比性，
 * 而二进制 STL 又完全不需要依赖 —— 80 字节头 + 三角面数 + 每面 50 字节。
 * 生成物是构建产物，落在 `benchmark-models/`（已在 .gitignore 中），不入库。
 *
 * 用法：
 *   node scripts/make-benchmark-model.mjs              # 100k 三角面 → benchmark-models/large-100352.stl
 *   node scripts/make-benchmark-model.mjs 400000       # 约 40 万三角面
 *
 * 度量口径见 docs/设计文档.md §29：用信息 HUD（快捷键 I）读 FPS，
 * 记录"静止 5 秒后的稳定 FPS"与"转盘模式下的 FPS"，两次都取同一相机距离（按 F 适配后不再动）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 高度场一边的分段数：三角面数 = segments² × 2 */
export function segmentsForTriangles(triangles) {
  // 非有限/非正输入退回默认的十万级目标，避免 Math.max(2, NaN) 传播出 NaN 边长
  const safe = Number.isFinite(triangles) && triangles > 0 ? triangles : 100_000
  const wanted = Math.max(2, Math.floor(safe / 2))
  return Math.max(1, Math.round(Math.sqrt(wanted)))
}

/** 高度场高度函数（确定性的平滑曲面，任何机器上生成结果一致） */
export function heightAt(u, v) {
  return Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2) * 0.25
}

/**
 * 生成高度场三角面（纯函数，可复用/可测）。
 * @returns {{triangles: Float32Array, count: number}} 每面 9 个 float（3 个顶点 × xyz）
 */
export function buildHeightFieldTriangles(segments) {
  const size = 1
  const triangles = new Float32Array(segments * segments * 2 * 9)
  let offset = 0

  const point = (ix, iy) => {
    const u = ix / segments
    const v = iy / segments
    return [u * size - size / 2, v * size - size / 2, heightAt(u, v)]
  }

  for (let iy = 0; iy < segments; iy += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = point(ix, iy)
      const b = point(ix + 1, iy)
      const c = point(ix + 1, iy + 1)
      const d = point(ix, iy + 1)

      for (const vertex of [a, b, c, a, c, d]) {
        triangles[offset] = vertex[0]
        triangles[offset + 1] = vertex[1]
        triangles[offset + 2] = vertex[2]
        offset += 3
      }
    }
  }

  return { triangles, count: segments * segments * 2 }
}

/** 二进制 STL：80 字节头 + uint32 面数 + 每面 12 个 float32 + uint16 属性 */
export function encodeBinaryStl(triangles, count) {
  const buffer = Buffer.alloc(84 + count * 50)
  buffer.write('model-viewer benchmark height field (generated)', 0, 'ascii')
  buffer.writeUInt32LE(count, 80)

  let cursor = 84
  for (let face = 0; face < count; face += 1) {
    const base = face * 9
    const [ax, ay, az] = [triangles[base], triangles[base + 1], triangles[base + 2]]
    const [bx, by, bz] = [triangles[base + 3], triangles[base + 4], triangles[base + 5]]
    const [cx, cy, cz] = [triangles[base + 6], triangles[base + 7], triangles[base + 8]]

    // 法线：三点叉积后归一化（STL 里必须给，否则查看器要自己补算）
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length

    cursor = buffer.writeFloatLE(nx, cursor)
    cursor = buffer.writeFloatLE(ny, cursor)
    cursor = buffer.writeFloatLE(nz, cursor)
    for (const value of [ax, ay, az, bx, by, bz, cx, cy, cz]) {
      cursor = buffer.writeFloatLE(value, cursor)
    }
    cursor = buffer.writeUInt16LE(0, cursor)
  }

  return buffer
}

function main() {
  const requested = Number(process.argv[2] ?? 100_000)
  const target = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 100_000

  const segments = segmentsForTriangles(target)
  const { triangles, count } = buildHeightFieldTriangles(segments)
  const buffer = encodeBinaryStl(triangles, count)

  const outputDir = join(projectRoot, 'benchmark-models')
  mkdirSync(outputDir, { recursive: true })
  const outputPath = process.argv[3]
    ? resolve(process.argv[3])
    : join(outputDir, `large-${count}.stl`)
  writeFileSync(outputPath, buffer)

  console.log(`已生成 ${outputPath}`)
  console.log(`  三角面：${count.toLocaleString('en-US')}（${segments}×${segments} 网格）`)
  console.log(`  顶点（未索引）：${(count * 3).toLocaleString('en-US')}`)
  console.log(`  文件大小：${(buffer.length / 1024 / 1024).toFixed(1)} MiB`)
}

// 只在直接执行时生成文件；被 import 时只暴露纯函数（便于单测）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
