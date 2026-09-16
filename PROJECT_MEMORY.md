# 项目持久记忆 Project Memory

> 本文件由 dsh-memoir 插件维护：记录本项目历次会话的工作归纳、经验教训与行动指南，
> 作为未来 AGENTS 接手本项目时的行动指南；它是人类可读的投影，不是 system prompt 的完整注入内容。
> 新会话只注入有界的 Hot Memory，完整历史通过 memoir_read 按需检索。

## 工作记录 Work Log

- [2026-09-16 14:27] [工作记录] model-viewer 可行性方案完成（设计文档已落盘 docs/设计文档.md） — 在 E:\AI-Coding\model-viewer（Tauri2+Vue3+ElementPlus 模板，含 tasks 示例与 tauri-plugin-sql fork）完成三维模型查看器方案，落盘 docs/设计文档.md（v1.0，含 mermaid 流程图、Command JSON 契约、SQL 表结构、边界情况、验收矩阵、M0~M6 约 27 人日）。核心结论：7 种格式（FBX/OBJ/STL/PLY/GLB/GLTF/3MF）Three.js 官方 loader 全覆盖，可行无阻塞。关键设计：文件读取走 Tauri asset 协议（不引 tauri-plugin-fs，不走 base64 IPC）；授权用 Rust command `allow_asset_paths` 运行时调 `app.asset_protocol_scope().allow_directory(dir, true)`（需 Cargo feature `protocol-asset`），grantMode 默认 parent-recursive 以覆盖 OBJ+MTL+贴图；拖放用 `getCurrentWebview().onDragDropEvent()`（默认 dragDropEnabled=true 会吞 HTML5 拖放）；魔数嗅探用 Rust `probe_model_file` 读前 16 字节而非 Range fetch；Draco/KTX2 wasm 由 scripts/copy-decoders.mjs 复制到 public/；环境贴图程序化 PMREM 生成（不打包 HDR，规避许可/体积）；饱和度靠 EffectComposer+ShaderPass。表结构四张：viewer_settings/lighting_themes/recent_files/granted_dirs（单个 migration version=2）。尚未写任何业务代码。
- [2026-09-16 14:48] [工作记录] model-viewer M0 完成：可打开 GLB/GLTF/STL 的最小闭环（测试全绿） — E:\AI-Coding\model-viewer 的 M0 里程碑已实施并验证完成（未提交 git——该目录不是 git 仓库）。

【交付】
- 配置：pnpm 单一事实源（删 package-lock.json；新增 pnpm-workspace.yaml 的 allowBuilds: esbuild false）、.nvmrc=22.22.1、vite strictPort 5173 + 忽略 src-tauri + clearScreen false、vitest.config.js、tauri.conf.json（assetProtocol.enable=true 且静态 scope 留空、窗口 1280×800「三维模型查看器」、beforeDev/BuildCommand 改 pnpm）、capabilities 加 dialog:allow-open、Cargo.toml 加 features=["protocol-asset"] + tauri-plugin-dialog。
- Rust（src-tauri/src/）：app_state.rs（GrantedDirs：幂等插入/覆盖判定含子树覆盖/清空）、asset_scope.rs（ModelFormat、魔数嗅探 sniff_format、GrantMode::parse、plan_grant、is_protected_dir、GrantError::code）、commands/asset.rs（probe_model_file / allow_asset_paths / list_asset_grants / revoke_asset_grants，全 async + spawn_blocking + 日志）、migrations/0001_viewer.sql（viewer_settings/lighting_themes/recent_files/granted_dirs，version=2）、lib.rs 装配。
- 前端：core/three/（ViewerEngine、ModelLoader 支持 glb/gltf/stl + Draco/KTX2/Meshopt + 取消令牌、disposal、stats、materialNormalizer、material-utils）、constants/formats.js、stores/（model、settings）、composables/（useViewerEngine、useAssetScope、useModelOpen）、components/（ModelCanvas、ViewerToolbar、ViewerStatusBar、EmptyDropHint、LoadingOverlay、ModelInfoPanel）、views/（Viewer、Settings）、utils/（tauri-io、db 重写为设置 KV + 最近文件、error-messages、format）、scripts/copy-decoders.mjs、router 改为 / 与 /settings。

【验证】cargo test 23/23 通过（0 警告）；pnpm test 30/30 通过（formats/stats/format/error-messages 四个纯函数模块）；pnpm build 成功（1660 模块，GLTFLoader/KTX2Loader/DRACOLoader/STLLoader/meshopt 各自独立 chunk，draco/basis 已复制进 dist）。GUI 级验收（真正打开 GLB/STL）需用户在自己终端执行 pnpm tauri dev 完成。

【契约修订】allow_asset_paths 返回 AllowReport{grants,errors}（单条失败仍 Err）；错误码 GRANT_REFUSED_DRIVE_ROOT → GRANT_REFUSED_PROTECTED_DIR（盘根+主目录）；前端遇到该错误码自动退化为「仅授权该文件」。M0 未写 granted_dirs（持久化+启动回灌需要新增 allow_asset_directories 命令，放 M6）。模板 demo（TaskList.vue/HelloWorld.vue/tasks 表）暂未清理，属破坏性操作待用户确认。
- [2026-09-16 15:23] [工作记录] model-viewer 双端适配（Web 预览 + 桌面打包）完成：平台适配层 + 共享测试向量 — 在 M0 基础上完成「同一份代码同时支持 Web 预览与桌面打包」的平台适配改造（E:\AI-Coding\model-viewer），未新增 Tauri-only 分支到业务层。

【架构】新增 src/platform/ 一层：
- runtime.js：detectRuntime()（检测 __TAURI_INTERNALS__）+ capabilities 能力矩阵（pathAccess/reopenByPath/persistence/nativeDragDrop/runtimeLabel）
- tauri.js / web.js 两个后端（都是被 index.js **动态 import** 的，所以 Web 包不含 @tauri-apps/*，桌面包不加载 blob 逻辑）
- index.js 门面：openModelSources / sourcesFromPaths / sourcesFromFiles / subscribeModelDrop / listGrants / revokeGrants
- sources.js：统一的 ModelSource 数据模型（id/name/sizeBytes/formatId/sniffedFormatId/loadFormatId/url/assetMap/warnings）+ 纯函数（fileNameOf / extensionMismatchWarning / preferredFormatId / syntheticId）
- sniff.js：Rust sniff_format 的前端等价实现（Web 端读 File.slice(0,512) 自己嗅探）
- storage/{index,tauri-sqlite,web-local}.js：持久化门面（桌面 SQLite / Web localStorage），API 完全一致
- core/three/url-rewrite.js：assetMap 的 URL 重写（完整相对路径优先，退回 basename）

【删除/迁移】utils/tauri-io.js、utils/db.js、composables/useAssetScope.js 已删除（职责并入 platform 层）；useModelOpen 改为只依赖 platform 门面。

【防漂移机制】魔数嗅探有两份实现（Rust + JS），用例抽到 tests/fixtures/format-sniff-cases.json，Rust（include_str! + serde_json）与 JS（vitest）读同一份向量；首次运行该机制就同时抓出了两端失败——是我写的向量里二进制 STL 头写成 85 字节（应为 84），证明它有效。

【构建】package.json 新增 build:web（vite build --base=./，可部署到子目录）；桌面仍用 pnpm build（base '/'）。路由改 createWebHashHistory，静态托管无需 history fallback。解码器路径改为由 document.baseURI 推导的绝对 URL。

【验证】pnpm test 61/61（7 个文件）；cargo test 24/24（含共享向量用例）；pnpm build 与 pnpm build:web 均成功，两种 base 的 dist/index.html 资源路径已核对。

## 经验教训 Lessons Learned

- [2026-09-16 14:27] [经验教训] Tauri2 asset 协议与图形栈：源码级事实与开发机环境坑 — Tauri asset 协议实测/源码结论（crates/tauri/src/protocol/asset.rs，dev 分支）：1) 响应带 `Access-Control-Allow-Origin: <window_origin>`，故 dev（http://localhost:5173）与生产（http://tauri.localhost）跨源 fetch 均不被 CORS 拦；2) 支持 Range（单/多段 206，单段上限 1000KB）；3) 越权 403 / 不存在 404；4) scope 可在运行时扩展：`app.asset_protocol_scope().allow_file/allow_directory(path, recursive)`（官方 persisted-scope 插件即此法），但必须开启 Cargo feature `protocol-asset`；5) convertFileSrc 需 CSP 白名单 `asset:` 与 `http://asset.localhost`（csp=null 时不用管）。拖放：Tauri2 默认 dragDropEnabled=true 吞掉 HTML5 拖放，须用 getCurrentWebview().onDragDropEvent()（@tauri-apps/api/webview.d.ts 的 DragDropEvent：enter/over/drop/leave，drop 带 paths）。开发机（DSH 沙箱）环境坑：rustc/cargo 在 D:\Environment\Scoop\persist\rustup\.cargo\bin 且 CARGO_HOME/RUSTUP_HOME 未设 → 直接跑 rustup 会尝试写 ~/.rustup 被拒（os error 5），构建前须显式设置这两个变量指向 scoop persist 目录；MSVC 是 VS2026 Community（D:\Program Files\...\18\Community，vswhere -requires VC.Tools.x86.x64 可验）；WebView2 153.0.4234.32；read-only 沙箱下 pwsh 为 ConstrainedLanguage 模式，某些 Cmdlet/类型构造会报 "Cannot create type"。
- [2026-09-16 14:48] [经验教训] 沙箱命名管道限制让 vite/vitest/cargo 全部 EPERM；pnpm allowBuilds 与 Tauri 参数 camelCase 的正确姿势 — 本机 DSH 沙箱与 Tauri/Vite 开发链的硬约束（本轮实测，务必先读再动手）：

1) 受限沙箱（read-only 或 workspace-write）下，任何“以管道方式启动子进程”的工具都不可用，报 `spawn EPERM`（命名管道限制）。已实测受影响：esbuild（vite/vitest 加载配置时）、vite 8 的 windowsSafeRealPathSync（内部 exec("net use")）、cargo（rustc/link.exe）、pnpm 的 postinstall。唯一出路是本次命令用 danger-full-access 升级（workspace-write 不够，两种受限模式都有该限制）。用户在自己终端跑 pnpm tauri dev / pnpm build 完全不受影响——排查时不要把沙箱限制误判为项目问题。

2) esbuild 的 postinstall（node install.js 自检）在该沙箱必然失败且会让 pnpm install 退出码为 1；平台二进制实际由可选依赖 @esbuild/win32-x64 提供（node_modules/.pnpm/@esbuild+win32-x64@*/node_modules/@esbuild/win32-x64/esbuild.exe），因此正确做法是在 pnpm-workspace.yaml 写 allowBuilds: esbuild: false（pnpm 11 的配置已从 package.json 的 "pnpm" 字段迁移到这里，旧字段只报 warning 不生效）。pnpm 11 在 CI 环境默认 frozen-lockfile，改过 package.json 后必须加 --no-frozen-lockfile。

3) 已从源码核实（tauri-macros-2.6.3/src/command/wrapper.rs:51,506）：Tauri 命令参数的默认命名转换是 camelCase（ArgumentCase::Camel，key.to_lower_camel_case()），即 Rust 参数 `grant_mode` 对应前端 `invoke('cmd', { grantMode })`；要改用方括号写 `#[tauri::command(rename_all = "snake_case")]`。

4) 开发机 rustc/cargo 在 D:\Environment\Scoop\persist\rustup\.cargo\bin，但 RUSTUP_HOME/CARGO_HOME 默认未设置 → 直接跑 rustup/cargo 会尝试写 C:\Users\<user>\.rustup 并被拒（os error 5）。构建前显式设置 $env:CARGO_HOME / $env:RUSTUP_HOME 指向 D:\Environment\Scoop\persist\rustup\{.cargo,.rustup}。

5) 本机沙箱下 pwsh 的 write 工具偶发报 “file changed since it was read”（内容其实未变），重新 read 一次再写即可。
- [2026-09-16 15:23] [经验教训] Web+Tauri 双端踩坑：blob 相对引用、绝对解码器路径、双 base 构建、拖放互斥、共享测试向量 — 三维查看器同时支持 Web 与 Tauri 桌面时的实操坑（本轮实测）：

1) **同一规则两份实现必须共享测试向量**：Rust 有 sniff_format，Web 端拿不到 Rust 只能 JS 再写一遍。把用例抽成 JSON（hex 头 + fileLen + 期望值），Rust 用 include_str! + serde_json、JS 用 vitest 读同一文件，任一侧漂移两端同时红。这套机制本轮立刻抓出了向量自身的错误（二进制 STL 头 85 字节 vs 84 字节），比人眼可靠。

2) **blob URL 无法解析相对引用**：Web 端一次选择的多个文件之间没有目录结构，.gltf 的 .bin / .mtl 的贴图路径取不到 → 必须建 assetMap（文件名与 basename 双键）并用 LoadingManager.setURLModifier 重写；桌面端不需要（整目录已授权，asset 协议自然解析相对路径）。

3) **解码器目录必须是绝对 URL**：DRACOLoader/KTX2Loader 在 blob URL 的 worker 里 importScripts/fetch，相对路径以 worker 自身为基准必然失败。用 new URL('draco/', document.baseURI).href 推导，可同时适配 tauri.localhost、根路径与子目录部署。

4) **构建 base 要分两套**：Tauri 用默认 base '/'；Web 静态托管（尤其子目录）用 vite build --base=./。路由用 hash 模式，静态托管无需 history fallback，桌面自定义协议也能直接刷新。

5) **Tauri 与 HTML5 拖放互斥**：Tauri 默认 dragDropEnabled=true 会在系统层拦截，HTML5 drop 根本不触发；因此 Web 端才注册 dragover/drop，桌面端用 onDragDropEvent 拿绝对路径——两端各注册一个，不要试图统一。

6) **Web 端 input[type=file] 必须监听 cancel 事件**：用户取消选择时 change 不触发，只监听 change 会让 Promise 永远挂着（并泄漏 DOM 节点）。

7) **两个后端都用动态 import**：platform/index.js 里 await import('./tauri.js') 与 import('./web.js')，否则 Web 包会把 @tauri-apps/* 与 plugin-sql 打进首屏。
