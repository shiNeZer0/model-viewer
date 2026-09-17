#!/usr/bin/env node
/**
 * 静态检查 .vue 组件的模板-脚本绑定一致性。
 *
 * 为什么需要它：当 <script setup> 的作用域被意外破坏（例如某个函数被嵌套进另一个函数里），
 * Vue 编译器就不会把该声明识别为 setup 绑定，模板会退化成 `_ctx.foo` 访问，
 * 运行时只给一条 "Property foo was accessed during render but is not defined on instance" 警告。
 * 这类问题**构建不会报错、单元测试也测不到**，只能靠编译器级别的检查。
 *
 * 用法：
 *   node scripts/diagnose-sfc.cjs                 # 检查 src 下全部 .vue
 *   node scripts/diagnose-sfc.cjs src/views/Viewer.vue
 *
 * 判定依据：把 compileScript 得到的绑定名集合与 compileTemplate 产物里的 `_ctx.<name>` 做交集——
 * 命中的名字说明"脚本里明明有顶层声明，模板却当成实例属性访问"，即为绑定丢失。
 */
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

/** 在 pnpm 的 .pnpm 目录里定位 @vue/compiler-sfc（它不是直接依赖，无法直接 require） */
function resolveCompilerSfc() {
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmDir)) return null
  const candidate = fs
    .readdirSync(pnpmDir)
    .filter((name) => name.startsWith('@vue+compiler-sfc@'))
    .sort()
    .pop()
  if (!candidate) return null
  const entry = path.join(pnpmDir, candidate, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
  return fs.existsSync(entry) ? entry : null
}

function collectVueFiles(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]

  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.vue')) found.push(full)
    }
  }
  walk(target)
  return found
}

function main() {
  const compilerPath = resolveCompilerSfc()
  if (!compilerPath) {
    console.error('未找到 @vue/compiler-sfc，请先执行 pnpm install')
    process.exit(1)
  }
  const { parse, compileScript, compileTemplate } = require(compilerPath)

  const target = path.resolve(projectRoot, process.argv[2] ?? 'src')
  const files = collectVueFiles(target)
  let problems = 0

  for (const filename of files) {
    const source = fs.readFileSync(filename, 'utf8')
    const relative = path.relative(projectRoot, filename)
    const { descriptor, errors } = parse(source, { filename })

    if (errors.length) {
      problems += 1
      console.log(`✗ ${relative}: SFC 解析错误 ${errors.length} 处`)
      for (const error of errors) console.log(`    - ${error.message}`)
      continue
    }
    if (!descriptor.scriptSetup) continue

    const script = compileScript(descriptor, { id: relative })
    const bindings = new Set(Object.keys(script.bindings ?? {}))

    const template = compileTemplate({
      source: descriptor.template?.content ?? '',
      filename,
      id: relative,
      compilerOptions: { bindingMetadata: script.bindings },
    })

    // 脚本里有顶层声明、模板却通过实例属性访问 → 绑定丢失
    const lost = new Set()
    for (const match of template.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
      if (bindings.has(match[1])) lost.add(match[1])
    }

    if (lost.size) {
      problems += 1
      console.log(`✗ ${relative}: 有 ${lost.size} 个顶层绑定在模板里退化成实例属性访问`)
      console.log(`    ${[...lost].join(', ')}`)
    } else {
      console.log(`✓ ${relative}（绑定 ${bindings.size} 个，无退化访问）`)
    }
  }

  console.log(problems ? `\n发现 ${problems} 个组件有问题` : `\n全部通过（共 ${files.length} 个组件）`)
  process.exit(problems ? 1 : 0)
}

main()
