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
 *
 * 另外还查一类**更容易漏掉**的问题：模板里引用了**根本没声明**的名字（例如只 import 了
 * `useDisplayStore` 却忘了写 `const display = useDisplayStore()`）。这类错误构建不报错、
 * 单测测不到、原先这里也查不到（它只判断"是不是已声明的绑定"），只有真跑起来才在渲染时报
 * `Cannot read properties of undefined`。现在这类名字也会被报出来（Vue 内置实例属性与
 * JS 全局放在允许列表里）。
 */
const fs = require('node:fs')
const path = require('node:path')

/** 模板里合法出现的 Vue 内置实例属性与 JS 全局，不算"未声明" */
const ALLOWED_CONTEXT_NAMES = new Set([
  '$attrs',
  '$data',
  '$el',
  '$emit',
  '$options',
  '$parent',
  '$props',
  '$refs',
  '$root',
  '$slots',
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'RegExp',
  'Set',
  'String',
  'console',
  'isNaN',
  'null',
  'parseFloat',
  'parseInt',
  'undefined',
])

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

    // ① 脚本里有顶层声明、模板却通过实例属性访问 → 绑定丢失
    // ② 模板引用的名字在脚本里根本没声明 → 运行时必然是 undefined
    const lost = new Set()
    const undeclared = new Set()
    for (const match of template.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
      const name = match[1]
      if (bindings.has(name)) lost.add(name)
      else if (!ALLOWED_CONTEXT_NAMES.has(name)) undeclared.add(name)
    }

    if (lost.size || undeclared.size) {
      problems += 1
      if (lost.size) {
        console.log(`✗ ${relative}: 有 ${lost.size} 个顶层绑定在模板里退化成实例属性访问`)
        console.log(`    ${[...lost].join(', ')}`)
      }
      if (undeclared.size) {
        console.log(
          `✗ ${relative}: 模板引用了 ${undeclared.size} 个未声明的名字（构建不报错，渲染时才是 undefined）`,
        )
        console.log(`    ${[...undeclared].join(', ')}`)
      }
    } else {
      console.log(`✓ ${relative}（绑定 ${bindings.size} 个，无退化访问）`)
    }
  }
  console.log(problems ? `\n发现 ${problems} 个组件有问题` : `\n全部通过（共 ${files.length} 个组件）`)
  process.exit(problems ? 1 : 0)
}

main()
