// 把 three 自带的 Draco / Basis(KTX2) 解码器复制到 public/，
// 供 DRACOLoader('/draco/') 与 KTX2Loader('/basis/') 以 URL 方式加载（完全离线）。
// 仅用 Node 自带 fs 实现，跨平台，且不引入额外构建插件。
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const threeLibsDir = join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs')

// 目标目录名被运行时代码写死（/draco/ 与 /basis/），不要随意改名
const jobs = [
  { from: join(threeLibsDir, 'draco'), to: join(projectRoot, 'public', 'draco') },
  { from: join(threeLibsDir, 'basis'), to: join(projectRoot, 'public', 'basis') },
]

async function main() {
  if (!existsSync(threeLibsDir)) {
    console.error(`[copy-decoders] 未找到 ${threeLibsDir}，请先安装依赖（pnpm install）`)
    process.exitCode = 1
    return
  }

  for (const { from, to } of jobs) {
    // 先删后拷，保证 public/ 下的产物与当前 three 版本一致
    await rm(to, { recursive: true, force: true })
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true })
    const count = (await readdir(to)).length
    console.log(`[copy-decoders] ${from} -> ${to}（${count} 个文件）`)
  }
}

await main()
