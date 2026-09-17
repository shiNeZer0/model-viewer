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
- [2026-09-16 15:35] [工作记录] model-viewer 四项待确认落地：模板清理/迁移v3删表/应用名中文/git 首次提交 — E:\AI-Coding\model-viewer 的四项待确认决策已全部落地（用户逐项选推荐方案）：

1) 模板残留清理：删除 src/views/Home.vue、src/components/TaskList.vue、HelloWorld.vue、src/assets/{hero.png,vite.svg,vue.svg}；删除前用 grep 确认无任何引用（src 已只剩查看器相关代码）。注意 public/ 下还有 dclaw.png 与 icons.svg 两个未被引用的模板资源（index.html 只引用 favicon.svg），未在确认清单内，暂留待用户决定。
2) 迁移 v3 删 tasks 表：新增 src-tauri/migrations/0002_drop_tasks.sql（DROP TABLE IF EXISTS tasks）+ lib.rs 注册 version:3，保持 append-only（0000 里建表的历史不动）。自验方法：用 miniconda 的 sqlite3.exe 在 src-tauri/target/ 下建 scratch 库，依次应用 0000/0001/0002，断言最终只剩 viewer_settings/lighting_themes/recent_files/granted_dirs 四表且 tasks 计数为 0（exit=0）。该迁移会在应用下次启动时对已有 ~/.model-viewer/app/app.db 生效。
3) productName 改为「三维模型查看器」（identifier 保持 com.model-viewer.app 不变，避免影响文件关联注册与数据目录）。
4) git 初始化：git init -b main + 首次提交 4eda0ff「feat(viewer): M0 骨架（Tauri 2 + Vue 3 + Three.js，Web/桌面双端）」，90 个文件，工作区干净。首次 add 时发现 .pnpm-store（pnpm 11 在项目根自建的本地包缓存，1.2 万文件）被裹进暂存区，已 git reset 后加入 .gitignore；同时新增 .gitattributes（* text=auto + png/ico/icns/wasm/字体等二进制标记，消除 autocrlf 的 LF→CRLF 噪声）；.gitignore 另外补了 src-tauri/gen/schemas（tauri-build 生成）。README.md 从模板文案重写为真实项目说明（双端形态、命令、结构、已实现/计划中、已知限制）。

回归：cargo test 24/24、vitest 61/61、pnpm build 与 pnpm build:web 均成功。
- [2026-09-16 17:17] [工作记录] model-viewer M1 完成：视图预设/8 种着色/背景与坐标轴/后处理/空闲停渲染（107 测试全绿） — E:\AI-Coding\model-viewer 的 M1 里程碑（相机与显示模式）已实施并提交（commit c493999，22 文件 +2448/-68，工作区干净）。

【新增纯逻辑模块（均带单测）】
- src/core/three/viewPresets.js：7 个标准视图（前/后/左/右/顶/底/等轴测）+ normalizeDirection + computeViewDistance + computeCameraPlacement。顶/底视图方向刻意带 0.0001 的 Z 偏移，避免与 up 平行导致 OrbitControls 万向锁。
- src/core/three/shadeModes.js：SHADE_MODES 共 8 种（实体/黏土/平面着色/实体+线框/仅线框/顶点色/法线/UV 棋盘格）+ ShadeController。核心约束=只换材质引用不改几何，切回时原始材质 100% 还原；记录原始 visible 状态（模型自带隐藏节点不会被切模式暴露）；线框双阈值（WIREFRAME_TRIANGLE_LIMIT=30 万 → EdgesGeometry(30°) 结构边；HARD_LIMIT=200 万 → 跳过并提示）；线框挂在 mesh 父节点并复制其局部矩阵（这样「仅线框」隐藏 mesh 时线仍在）；flat 模式克隆材质后设 flatShading，克隆材质放 transientMaterials 集合统一 dispose。
- src/core/three/postfx.js：TONE_MAPPINGS（none/linear/aces/agx/neutral，默认 neutral）+ clamp + normalizePostFxSettings + SaturationShader（Rec.709 亮度 mix）+ PostFx 类（惰性创建 EffectComposer；自建 HalfFloatType+samples=4 的 MSAA render target；双路径 render：开启走 composer，关闭走 renderer.render）。
- src/core/three/idlePolicy.js：createIdlePolicy（noteActivity/shouldRender/goIdle/setIdleMs）+ hasContinuousWork。

【其他】src/core/three/stage.js（背景纯色/渐变/真透明棋盘 + niceGridSize 自适应网格 + CSS2D 坐标轴标签）、ViewerEngine 整合（applyDisplaySettings/setViewPreset/resetView/renderNow/setAnimationPlaying；rAF 循环按「相机变化 ∪ 持续工作 ∪ 空闲窗口」决定渲染，空闲时彻底 stop()）、src/stores/displayStore.js（12 个显示设置持久化到 viewer_settings）、DisplayPanel.vue、useHotkeys.js（1-7/F/R/T/W，抽 isTypingTarget/resolveHotkey 为纯函数）、工具栏视图与着色下拉、ModelCanvas 增加透明棋盘 CSS。

【测试暴露的真实缺陷】computeViewDistance 在 fovDeg 缺省/NaN 时算出 NaN 相机坐标（undefined*Math.PI）；M0 调用点总传 camera.fov 所以没暴露，抽成模块后立刻被单测抓到。已加 0<fov<180 校验与回退 50°，并补回归用例。

【验证】pnpm test 107/107（12 文件）、pnpm build 成功、cargo test 24/24。GUI 级验收（8 种着色切换与还原、6 视图方向、背景、饱和度曝光、静止 5 秒后 CPU 归零）需用户在本机 pnpm tauri dev 确认。
- [2026-09-17 07:59] [工作记录] model-viewer 模型摆放归一化：居中世界原点 + 底部贴地（可重复应用不漂移） — E:\AI-Coding\model-viewer 新增「模型摆放归一化」（commit 4af4d86）：加载模型后计算包围盒，把模型居中到世界原点（X/Z）、底部贴到地面（y=0），网格/坐标轴随之落在模型底部，相机按摆放后的包围盒适配。

【新增 src/core/three/modelPlacement.js】
- `computePlacementOffset(box, {center, ground})` 纯函数，四种组合：居中+贴地=(-cx,-min.y,-cz)；居中不贴地=(-cx,-cy,-cz)；仅贴地=(0,-min.y,0)；都不开=(0,0,0)；空 box 返回零向量。
- `ModelPlacement` 类：构造时记住 `originalPosition`（克隆）；apply() 每次都**先还原到原始变换再测量**，然后一次性把世界空间偏移加到 object.position 上（前提：对象挂在场景根，父变换为单位矩阵）。这是"可重复应用不漂移"的关键——绝不在当前位置上累加增量。提供 isPristine / restore()。

【引擎接线】setModel 顺序：scene.add → new ModelPlacement → ShadeController.apply → placement.apply({center,ground}) → stage.fitToBox(摆放后 box) → fitToObject(root, {box})。fitToObject 新增可选的 box 参数避免重复计算。applyDisplaySettings 会比较前后 centerModel/alignToGround，变化时调用 reapplyPlacement()（重新摆放 + 刷新网格 + 重新适配相机）。新增 getModelBounds() 返回 {box,size,center,min,max} 供 M2 尺寸面板/边界框标注复用。

【设置与 UI】displayStore 新增 display.centerModel / display.alignToGround（默认 true、持久化）；DisplayPanel 新增「模型放置」分区两个开关，并明确提示"只影响显示、不改模型文件原始坐标，关掉即可看真实坐标"。

【测试】modelPlacement.test.js 13 例（四种偏移组合、幂等不漂移、开关还原、自带旋转缩放仍正确、空对象）+ displayStore 2 例；vitest 144/144、cargo 未动、双端构建通过。

【注意】摆放是场景空间平移，若用户需要查看模型文件里的真实坐标，关掉开关即可（已做成一键还原）。
- [2026-09-17 08:08] [工作记录] model-viewer M2 完成：层级树 + 边界框尺寸标注 + 单位换算（189 测试全绿） — E:\AI-Coding\model-viewer 的 M2 里程碑（模型检查：层级树 + 边界框尺寸 + 单位换算）已完成并提交（commit fb8b890，工作区干净）。

【新增纯逻辑模块（均带单测）】
- src/core/three/hierarchy.js：buildHierarchy(root) 把 Object3D 树抽成**纯数据树**（id=uuid、label、type、isMesh、visible、triangles、vertices、children），three 对象引用留在引擎侧非响应式 nodeById Map 里（避免进 Vue 响应式）；skipEmpty 跳过空叶子；节点数上限 MAX_HIERARCHY_NODES=5000 截断并置 truncated。
- src/core/three/visibility.js：**可见性解析层**。resolveNodeVisibility({isMesh,userOverride,originalVisible,hideSolids}) 纯函数；applyVisibility(root,{overrides,originals,hideSolids}) 落盘并返回变化数；captureVisibility(root) 记录模型原始可见性。
- src/core/three/units.js：LENGTH_UNITS(raw/mm/cm/m/in)+DISPLAY_UNIT_IDS(auto含)；toMeters/fromMeters/convertLength/autoPickUnit/formatLength。语义：sourceUnit='raw' 表示**不换算、按原始数值显示**（避免虚假精度）；声明真实单位后按 displayUnit（auto 按量级挑）换算。
- src/core/three/boundingBox.js：describeDimensions/describeCorner/dimensionLabelPositions 纯函数 + BoundingBoxOverlay 类（Box3Helper + CSS2D 三个轴向标签 + 最小角标签；Node 无 DOM 时自动只画线框不抛错）。

【架构性修复（重要）】原 ShadeController 直接改 mesh.visible（仅线框隐藏实体、切回按"原始可见性"整体重置）。加上层级树的手动隐藏后必然出现"用户隐藏的网格切一次着色模式就自己回来"——与 §16 辅助显示是同一类缺陷（隐式状态覆盖用户意图）。已把可见性从着色模块彻底摘出：ShadeController 只负责材质与叠加层，visible 一律由 visibility.js 解析（用户开关 ?? 模型原始值，再由 hidesSolid 决定实体隐藏）。shadeModes.test.js 相应改为断言"控制器绝不修改可见性"，并新增 visibility.test.js 锁住"用户隐藏的网格在模式来回切换后仍隐藏"。

【测试抓到的口径 bug】buildHierarchy 最初对任何带几何体的节点都计三角面 → 点云节点也报 12 面 → 逐节点面数之和 36 ≠ 整体统计 24。现只对 isMesh/isSkinnedMesh 计面数，与 stats.js 统一。

【引擎 API】getHierarchy / setNodeVisible(id,visible) / setAllNodesVisible / resetNodeVisibility（返回权威 flags 供 UI 回填）/ collectVisibilityFlags / focusNode(id)（取节点世界包围盒 → controls.target + 重新适配）/ refreshBoundsOverlay / getModelBounds（已有）。

【UI】ModelTreePanel.vue（第三标签页「层级」，逐节点隐藏开关+聚焦+全部显示/隐藏/重置）；ModelInfoPanel 新增「尺寸与单位」分区（边界框开关、模型单位、显示单位、长宽高、min/max 角坐标）；快捷键 B 切换边界框；modelStore 新增 hierarchy/bounds/selectedNodeId 与**就地补丁**方法（不替换数组，保留 el-tree 展开态；bounds 里的 Box3 用 markRaw 包住避免被深度代理）；ModelCanvas 在 root 变化与设置变化时把引擎数据同步成纯数据。

【验证】vitest 189/189（20 文件）、cargo 24/24、pnpm build 通过。GUI 验收（层级树可见性/聚焦、边界框标注、单位换算显示）需用户在本机 pnpm dev 确认。
- [2026-09-17 08:23] [工作记录] model-viewer M3 完成：三点光源 + PMREM 环境贴图 + 5 预设 + 自定义光照主题（244 测试全绿） — E:\AI-Coding\model-viewer 的 M3 里程碑（光照与环境）已完成并提交（commit ce2beaa，工作区干净）。

【新增核心模块（均带单测）】
- src/core/three/lighting.js：三盏平行光（主/补/轮廓）+ 半球环境光；computeLightPosition(方位角/仰角/半径 → 世界坐标，纯函数含越界收敛，约定 0° 指 +Z、仰角从水平面起算)；LIGHT_LIMITS(强度0~10、方位±180、仰角±90、半径0.1~100、环境强度0~5)；normalizeLightingState 固定补齐 key/fill/rim 并按内置预设兜底；主题载荷 createThemePayload/parseThemePayload(schemaVersion=1，拒绝非 JSON/非对象/更高版本)；LightingRig 类（apply 状态→three 光源，dispose 无残留）；describeLightPositions 便于测试。
- src/core/three/environment.js：createGradientEquirectData 生成等距柱状渐变（Float32Array RGBA、alpha=1、按行做天顶→地平→地面插值；颜色用 three 的 Color 解析以得到线性值）；EnvironmentManager（PMREMGenerator；gradient→fromEquirectangular(DataTexture)、room→fromScene(RoomEnvironment, 0.04)、none→scene.environment=null；scene.environmentIntensity 控强度；内部缓存键避免重复生成 PMREM；applyEquirectangularTexture 作为 HDR 导入接入点）。
- src/constants/presets/lightingPresets.js：5 个预设（影棚/黄昏/森林/全景/无环境），每个含 lights+environment+background+render；presetToState 深拷贝防止污染常量。
- src/stores/lightingStore.js：reactive 光照状态 + themes/activeThemeId；updateAmbient/updateLight/updateEnvironment（支持 {persist:false} 供滑杆拖动）；applyPreset 会同时把预设的 background/render 写回 displayStore；saveTheme（同名覆盖）/applyTheme/renameTheme/removeTheme/refreshThemes；load() 从 viewer_settings 读回 lighting.state 与 lighting.activeThemeId。

【引擎/舞台】ViewerEngine 移除 M0 的临时照明（半球+两盏平行光），改由 LightingRig + EnvironmentManager 接管；新增 applyLighting()（幂等，环境贴图仅在来源/颜色变化时重建）；stage.js 的背景新增第 4 种模式 environment（PMREM 贴图作背景 + backgroundIntensity/backgroundBlurriness），并提供 setEnvironmentBackground 由引擎注入纹理。

【持久化】viewer_settings 新增键 lighting.state / lighting.activeThemeId；光照主题走既有 lighting_themes 表（桌面 SQLite / Web localStorage，两侧同名覆盖语义一致），storage 门面新增 list/upsert/rename/delete。

【UI】新增「光照」标签页（LightingPanel.vue + LightSourceEditor.vue）：预设下拉、环境来源(影棚/渐变/无)与三色、环境强度、半球光开关与配色、三盏灯独立编辑器（强度/颜色/方位/仰角/半径，拖动不落库）、主题保存与列表（应用/重命名/删除）。

【测试抓到】① 预设里黄昏/森林的轮廓光方位角写成 190°/200° 超出 ±180°——运行时会被静默夹取不报错，是靠"预设必须落在 LIGHT_LIMITS 内"的断言暴露的；② 仰角上限原设 ±89°，与"平行光在 ±90° 仍有定义"冲突，最终放开到 ±90°。

【范围调整】HDR/EXR 导入移到 M6：需要第二条文件选取链路（平台层要支持非模型扩展名的过滤与授权），且主题引用自定义 HDR 的可复现性需要决策（桌面端复制进应用数据目录 / Web 端 blob 无法跨会话）。接入点 EnvironmentManager.applyEquirectangularTexture 已就绪，文档 §18.4 有记录。

【验证】vitest 244/244（25 文件）、cargo 24/24、pnpm build 通过。GUI 验收（预设切换观感、主题保存/应用、环境贴图当背景）待用户在本机 pnpm dev 确认。
- [2026-09-17 09:10] [工作记录] model-viewer M4 完成：动画片段选择与播放控制（真实 mixer 确定性单测，269 全绿） — E:\AI-Coding\model-viewer 的 M4 里程碑（动画片段选择与播放控制）已完成并提交（commit 29af9e7，工作区干净）。

【新增 core/three/animation.js（可单测）】
- AnimationController：封装 AnimationMixer + 每片段 action 缓存（clipAction 按 clip 对象缓存，切换片段时停住前一个）。
- 状态机约定（UI 语义依赖它，改动前先看这里）：① 选中片段后**停在 0 秒并暂停**，并立即 `mixer.update(0)` 应用第 0 帧姿势（否则模型停在上一段的姿势）；② `停止` = `action.stop()`（three 的 stop 会 reset：time=0 且 paused=false）**再显式 paused=true 且 time=0**，语义是"回到起点并暂停"，不是恢复绑定姿势；③ `播放一次`（LoopOnce + clampWhenFinished）播完时 three 会把 action 置 paused，据此判定 `finished`，重播时先 reset 再放行；④ `seekNormalized` 设 action.time 后必须 `mixer.update(0)` 才会刷新姿势，且会置 paused（拖动 = 暂停定位）。
- 纯函数：describeClips（无名片段给"片段 N"占位名）、formatClipDuration（<60s 用秒，否则 分+秒）、timeToNormalized/normalizedToTime（duration=0 返回 0，不产生 NaN）、normalizeSpeed（0.1~4）、normalizeLoopMode（非法回退 repeat）、MAX_FRAME_DELTA=0.1。

【引擎接线】setModel(root, { animations }) —— **只有 loadable 片段非空才创建控制器**；控制器必须先于 disposeObject3D 释放（否则 mixer 继续引用已销毁节点）；onFrame 内 `delta = min(now-lastFrameTime, MAX_FRAME_DELTA)` 后推进（空闲唤醒时 delta 可达数秒，不夹取会跳帧）；新增 getAnimationClips/getAnimationState/selectAnimationClip/playAnimation/pauseAnimation/stopAnimation/seekAnimation/setAnimationSpeed/setAnimationLoopMode 与 emitAnimationState。
- 回写节流：离散变化（playing/finished/clipId）立即回写，连续时间约 10Hz（100ms），否则播放中每帧都会触发 Vue 重渲染。
- animationPlaying 每帧从控制器状态同步 → hasContinuousWork 保持持续渲染；暂停后自动回到空闲停渲染。

【状态与 UI】src/stores/animationStore.js（纯数据：clips/clipId/playing/finished/time/duration/speed/loopMode + applyState 单一同步入口 + reset 保留用户偏好）；AnimationPanel.vue（片段下拉带时长、播放/暂停/停止、时间轴显示"当前/总长"、倍速滑杆标出常用档、循环模式三选、无动画空态说明纯几何格式不含动画）；偏好键 animation.speed / animation.loopMode 持久化（**时间轴位置刻意不落库**）。
- 偏好同步方向：ModelCanvas 的 watch 监听 store 的 [speed, loopMode] 单向推给引擎 → 同时覆盖"用户修改"与"设置刚从数据库读回"两条路径，且引擎把偏好缓存下来供下一个模型使用。

【验证策略】three 的动画系统不依赖 WebGL，因此用真实 AnimationMixer + AnimationClip（VectorKeyframeTrack('.position')，x 在 2 秒内 0→10→0）做**确定性数值断言**：t=0.5 时 x≈5；2× 倍速下 delta 0.25 前进 0.5s；暂停后不前进；停止归零；seekNormalized(0.75)→time 1.5 且 x≈5；越界夹取；once 播完 finished 且重播从头；loop 写回 action；按名称选片段；非法目标不改选中；多片段切换停住前一段；无片段时全部操作安全返回。

【结果】vitest 269/269（27 文件）、cargo 24/24、pnpm build 通过。GUI 验收（真实带动画模型播放、拖时间轴、倍速、循环模式）待用户在本机确认。
- [2026-09-17 09:19] [工作记录] model-viewer M5 完成：FBX/OBJ(+MTL)/PLY/3MF 全部接入（7 格式齐备，294 测试全绿） — E:\AI-Coding\model-viewer 的 M5 里程碑（补齐 FBX / OBJ(+MTL) / PLY / 3MF）已完成并提交（commit f3fa6e6，工作区干净）。至此 7 种格式全部可打开。

【新增 core/three/formatLoaders.js】四个 loader，全部按需 import；同时导出可单测的纯函数：
- siblingUrl(modelUrl, ext)：从模型 URL 推导兄弟文件 URL（保留 query/hash；只替换最后一个"文件段"的扩展名，因此 /m/v1.2/cube 不会把 v1.2 当扩展名）。
- extractLocalPath(ref)：识别绝对本地路径。Windows 盘符路径原样返回；`file:///E:/x` 去掉盘符前的斜杠；**POSIX 的 `file:///home/u/x` 必须保留前导斜杠**（我曾把期望写成去掉，测试纠正了认知）。
- normalizeReferenceUrl(requested, { assetMap, toAssetUrl })：先走 assetMap（含 basename 兜底），再识别本地绝对路径并用调用方给的转换器改写；未命中一律原样返回，保证缺失资源仍能被 LoadingManager 上报。
- loadFbx / loadObj / loadPly / loadThreeMf + EXTRA_FORMAT_LOADERS 映射表（ModelLoader 按 id 分派）。
- OBJ 关键决策：.mtl 缺失或解析失败**不报错**，换成默认黏土材质 + 一条提示（纯几何 OBJ 合法）。
- PLY：无法线则 computeVertexNormals；含 color 属性则 vertexColors 材质。
- nameOfUrl：**必须先 decodeURIComponent 再按分隔符切分**，否则 asset URL 里的 %5C 编码反斜杠会被漏掉（测试抓到）。

【新增 core/three/orientation.js（Z-up ↔ Y-up）】
- shouldConvertUpAxis：auto 模式下**只有 3mf 自动转换**（规范明确 Z-up），FBX 视导出器而定所以不猜；keep 永不转；z-up 强制转。
- createUpAxisQuaternion([-π/2,0,0])：绕世界 X 轴 -90°；分量非有限值回退 0，绝不产生 NaN 姿态。
- ModelOrientation：记住原始 quaternion，每次从原始值重算并**预乘**（世界空间旋转，语义与用户看到的一致），反复切换不累积旋转——与 ModelPlacement 同一模式。
- 引擎接线：setModel(root, { animations, formatId }) 里，轴向修正必须在**量包围盒之前**应用，否则尺寸/贴地/相机适配会全部跟着错。

【其他】formats.js 七种格式全部 loadable:true；formats.test.js 改为"七种全部可加载且都有实现"（防注册表与实现漂移）；loader 返回的 warnings 经 useModelOpen 汇总进信息面板。

【明确留到 M6 的三项（文档 §20.2 有记录）】① MTL 绝对路径重写的**接线**（纯函数已实现并单测，只差 loader 侧 URL 修饰器 + 平台层同步转换器 getLocalPathConverter）；② 手动轴向覆盖 UI（需给 displayStore 加 display.upAxis 并持久化，ModelOrientation 已就绪）；③ 新格式的字节级进度（loadAsync 未接 onProgress，只显示不确定进度）。

【结果】vitest 294/294（29 文件）、cargo 24/24、pnpm build 通过。GUI 验收（四种格式真实文件能否打开、OBJ 贴图、3MF 是否立起来）待用户在本机确认。

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
- [2026-09-16 15:35] [经验教训] 首次 git 提交与资源清理：先数暂存文件数、.gitattributes 治 autocrlf、迁移 sqlite3 离线自验、git grep 引用判定要排除记忆笔记 — git 首次提交与资源清理的实操教训（本轮实测）：

1) **首次 `git add -A` 前必须先数文件数**：`git diff --cached --name-only | Measure-Object`。本轮 pnpm 11 在项目根自建了 `.pnpm-store`（内容寻址包缓存，无项目级 .npmrc、`pnpm config get store-dir` 为 undefined，却落在仓库内），一次就裹进 12115 个文件；靠"待提交文件数"这一步才发现（正常的 M0 规模应为 ~90）。发现后处理：`git reset` → .gitignore 加 `.pnpm-store` → 重新 add。同理需要忽略的还有 `src-tauri/gen/schemas`（tauri-build 生成的 ACL/能力 schema）。

2) **Windows 上 autocrlf 会产生海量 LF→CRLF 警告**，把真正的输出淹没。加一个 `.gitattributes`（`* text=auto` + `*.png/*.ico/*.icns/*.wasm/*.ttf` 等 binary）即可明确二进制不做转换、文本交还给 git 策略，比反复读警告省事。

3) 迁移 SQL 的离线自验很划算：直接用 sqlite3 CLI 把 migrations/*.sql 依次灌进一个放在 target/（已忽略）下的 scratch 库，再断言 sqlite_master 里的表集合与残留表计数。不需要启动 GUI 就能证明 append-only 迁移链在全新库上可执行。

4) **用 `git grep` 做“资源是否被引用”的判定时，必须收敛扫描面**：dsh-memoir 会把文件名写进 PROJECT_MEMORY.md（记忆笔记正文里提到 `dclaw.png`/`icons.svg`），导致 `git grep -E "dclaw|icons\.svg"` 命中自己的笔记而被误判为“仍被引用”。正确做法是限定引用载体类型并排除记忆文件：`git grep -n -I -E "<pattern>" -- "*.html" "*.vue" "*.js" "*.ts" "*.json" "*.css" "*.md" ":!PROJECT_MEMORY.md"`。另注意 PROJECT_MEMORY.md 由 memoir 自动改写，会周期性显示为已修改（M），属正常现象。
- [2026-09-16 17:17] [经验教训] 抽模块+单测立刻暴露被调用点掩盖的 NaN 缺陷；断言提示文案要选唯一子串 — 两点与「把算法抽成纯模块 + 单测」直接相关的经验（model-viewer M1 实测）：

1) **抽取算法模块会立刻暴露调用点替你掩盖的缺陷**：computeViewDistance 里 `(fovDeg * Math.PI) / 180`，当 fovDeg 为 undefined/NaN 时整条链路算出 NaN 相机坐标（表现为模型"消失"）。M0 里调用点永远传 camera.fov，所以线上看不出问题；把它抽成可复用模块后第一次跑单测就红了。结论：涉及相机/几何的公式函数，一律在函数内部校验参数合法区间并给兜底值（本例 0<fov<180，否则回退 50°），别把校验责任推给调用方。

2) **断言子串要选"只可能由该逻辑产生"的文案**：验证「有 UV 时不报警」时写了 `expect(warnings.some(w => w.includes('UV'))).toBe(false)`，结果被另一条完全无关的提示「当前环境无法创建 Canvas 纹理，UV 棋盘格不可用」命中而假失败。教训：断言提示文案时用最能标识该分支的完整短语（如「没有 UV 坐标」），否则任何包含同一关键词的其他提示都会污染断言——包括环境相关的降级提示（Node 无 DOM/Canvas 就属于这一类）。
- [2026-09-16 17:39] [经验教训] rAF 循环致死双重陷阱：绑定顺序 + 僵尸句柄（现象仅"画布全黑"）；用独有产物判断用户跑的是哪个形态 — 「requestAnimationFrame 循环」的两个经典致死陷阱（model-viewer M1 实测，用户报"不显示模型"，控制台仅一行 `Cannot read properties of undefined (reading 'tick')`）：

1) **绑定顺序**：构造函数里 `this.tick = this.tick.bind(this)` 放在末尾，而构造函数中途的 `handleResize() → noteActivity() → start()` 已经把**未绑定**的 tick 交给 rAF（`requestAnimationFrame(this.tick)` 读的是原型方法、没有 this）。回调执行时 this 为 undefined 直接抛错。M0 之所以没事：那时 handleResize 末尾没有 noteActivity（空闲停渲染是 M1 才加的）。

2) **僵尸句柄（更隐蔽、后果更严重）**：旧实现是"先排下一帧再干活"（`tick(){ this.frameHandle = requestAnimationFrame(this.tick); ... }`），异常发生在第一行 → frameHandle 从未被更新，却停在一个已失效的非 null 值上；而 `start()` 用 `if (this.frameHandle !== null) return` 做幂等 → **此后所有 start() 全部直接返回，循环永久死亡**。界面表现是"有界面、模型区域全黑"，而模型其实已加载成功（状态栏有三角面数），极难从现象反推原因。

**结构化修法**（已落地 src/core/three/renderLoop.js + 5 个单测）：调度器只持有闭包（`onFrame: () => this.onFrame()`，不依赖 this 绑定时机），并且**先清空句柄再执行回调**——这样回调无论怎么抛错都不会留下 running 的假象；每帧由 onFrame 的返回值决定是否继续排帧（空闲就不排，rAF 自然归零）。单测专门锁住"回调抛错后 loop.running === false 且可重新 start"。

经验：任何"自己排下一帧"的循环，都要(a)不依赖 this 绑定、(b)保证异常路径下句柄状态一致、(c)用可注入的 requestFrame/cancelFrame 把调度器抽出来单测——这类 bug 在浏览器里只以"画面不动"的形式出现，没有测试就只能靠用户报障。

附带两条排障经验：① 判断用户实际跑的是哪个形态，最快的方法是看该形态独有的产物——Tauri 的 `~/.model-viewer/app/app.log` 与数据目录不存在，就直接证明"桌面版从未启动"，问题必然在 Web 路径；② 我在用户开着 dev server 时改文件，HMR 会先应用模板再应用脚本，导致控制台出现"属性未定义"的**中间态假警告**（本次 `onRenderError` 那条即属此类），让用户复测前先强刷页面可排除这类噪声。
- [2026-09-16 18:11] [经验教训] 开关"意图"要与几何重建态分离；用可在 Node 跑的单测把 UI→store→场景 链路切开定位 — 「开关状态」与「几何重建」必须分离（model-viewer M1 实测，用户报"辅助显示点击开关不起作用"）：

【两个同源缺陷】Stage.fitToBox 在模型包围盒变化时会重建网格/坐标轴几何，但重建逻辑只看"对象当前是否可见"，没有遵循用户的开关意图，于是出现两种怪现象：
1. 网格开着时加载模型 → 几何被 dispose 并置 null 却没按意图补建 → **网格消失**，此时再点开关完全看不出变化（用户判定"开关坏了"）；
2. 坐标轴关掉后加载模型 → 重建时无视意图直接把它建回来 → **关不掉的复活**。这来自用隐式可见性记录状态（`if (this.axesVisible) this.ensureAxes()` 里的 axesVisible 只在创建时被赋值，关掉时不变）。

【修法】把两类状态拆开：**意图**（wantGrid/wantAxes，只由 UI 决定）与**几何尺寸**（gridSize/groundY，只由模型包围盒决定）；尺寸变化只允许"重建几何"，重建后统一走 syncHelpers() 按意图恢复可见性。ensureGrid/ensureAxes 只负责按尺寸创建，不再兼任状态记录。

【关键排障手法（值得复用）】不要靠读代码猜，而是**写一个能在 Node 里跑的测试把链路切开**：
- three 的 Scene/GridHelper/AxesHelper/Box3 在 Node 下可直接构造（不需要 WebGL），所以 Stage 的辅助显示逻辑完全可单测 → 这两处缺陷是第一次运行 stage.test.js 就红的（`expected null to be truthy`）；
- UI→引擎的接线也能测：`setActivePinia(createPinia())` + `computed(() => store.toEngineSettings)` + `watch` + `nextTick()`，即可在无 DOM 环境下验证"改设置 → 快照变化 → watch 被触发"（store.update 传 {persist:false} 绕过存储后端）。
这样一次运行就把"是 Vue 响应式断了，还是 three 场景逻辑断了"这个二分问题直接定位，不用再向用户追问。

【附带修复】无 Canvas 环境生成渐变纹理失败时 scene.background 会变成 null（看起来像没设置背景），现回退为纯色。
- [2026-09-17 08:12] [经验教训] 同文件并发 edit 会留下"源码已对但 dev server 缓存仍旧"的中间态；用编译器级静态检查区分源码缺陷与服务端缓存 — 同文件并发 edit 的**后果比想象中更黏**（model-viewer 实测两次踩到）：

1) 第一次（M2 期间）：并发写入产生"有用法、无 import"的中间态，被运行中的 dev server 经 HMR 推到浏览器 → 用户报 `markRaw is not defined`。
2) 第二次（M4 期间，我自己违反了刚定的规约）：同一条消息里对 `Viewer.vue` 发了两个 edit（onMounted 与动画处理函数），**两个 edit 都回报成功、源码最终也正确**，但用户刷新页面后仍报 `Property "onPlayAnimation" was accessed during render but is not defined on instance`——因为 **Vite dev server 的模块转换缓存里留着一份过期结果，普通 F5 只会重复拿到它**。

处置与验证顺序（可复用）：
- 先用 Vue 官方编译器**证明源码是否正确**，而不是继续读代码猜：`compileScript` 取绑定集合 + `compileTemplate` 取产物，检查 `_ctx.<name>` 与绑定集合的交集。命中即"脚本里有顶层声明、模板却按实例属性访问"（真实缺陷）；不命中则说明源码没问题，问题在服务端缓存。
- 已固化为工具 `scripts/diagnose-sfc.cjs`（可传文件参数，默认扫 src 下全部 .vue；自动在 node_modules/.pnpm 里定位 @vue/compiler-sfc）。全量 14 个组件通过。
- 结论与用户侧动作：**重启 dev server**（必要时 touch 一下该文件触发重新转换）。仅靠强刷不一定有效，因为过期的是"服务端的转换缓存"而不是浏览器缓存。

**硬规约（第二次教训后升级）**：任何情况下都不得在同一条消息里对同一个文件发多个 edit —— 并发写入不仅可能丢改动，还可能让 dev server 留下一份"源码已对、服务端仍错"的缓存，排查成本远高于多花一轮消息。
- [2026-09-17 08:35] [经验教训] CSS 静默裁切两大家族：百分比高度链断裂（overflow 不触发）与 flex 子项被压缩（overflow:hidden 裁掉内容） — CSS 布局「静默裁切」两大家族（model-viewer 实测，用户先后报"侧边光照栏下方设置无法到达"与"三张光源卡片内容缺失"；两者现象都像"内容不够 / 看不到"，但根因不同，修法也不同）：

【A. 百分比高度链断裂 → overflow 根本不触发】
根因：`.el-tabs__content` 给了 `flex:1; min-height:0` 但**漏了给 `.el-tab-pane` 确定高度**，面板里的 `height:100%` 相对于 auto 高度的中间容器**静默退化为 auto**（不报错、不警告），面板自身的 `overflow-y:auto` 永不触发，超出内容被祖先 `overflow:hidden` 裁掉且滚不到。
三层修法一起才稳：1) `.el-tab-pane{height:100%}` 补齐链；2) `.el-tabs__content{overflow-y:auto}` 兜底；3) 面板自身再写与祖先无关的确定高度 `max-height: calc(100vh - 130px)`（顶栏52+状态栏30+标签页头约48）——`height:100%` 与 `max-height` 并存：链完整则精确填满，链断裂则被兜住且 overflow 生效。
判断法：沿 DOM 往上问"这个 overflow:auto 的元素有没有确定高度？高度来自 `height:100%` 还是 flex？"百分比就必须逐层检查；flex item + min-height:0 也算确定高度。

【B. flex 子项被压缩 + overflow:hidden → 内容被裁（本次新增，注意与 A 的区别）】
根因：`.lighting-panel` 是**固定高度**的 flex 列容器；flex 子项的自动最小高度（`min-height:auto`）**只在 `overflow:visible` 时生效**，而 `el-card`/`el-alert` 自带 `overflow:hidden` → 子项可被压缩到低于内容高度，被挤掉的部分**既看不到也滚不到**。关键鉴别点：这种情况**滚动条其实在工作**（与 A 相反），所以"滚动了仍然看不到内容"要往这里查。
修法：容器上写 `.panel > * { flex-shrink: 0 }`，约定"子项永远保持自然高度，溢出只由这一个滚动容器负责"；组件自身也显式写 `flex-shrink:0`，防止以后换布局又被挤扁。

【流程教训】纯视觉布局问题**无法被单元测试与生产构建发现**：A 从 M1 引入到 M3 才暴露，中间三次"验证全绿"都不覆盖。缓解：改动中间层布局容器（tabs/collapse/card/scrollbar）后自查高度链与收缩行为；M6 可考虑引入截图级冒烟检查（Playwright）兜住这类回归。
- [2026-09-17 09:31] [经验教训] 空闲停渲染下"面板命令必须自己唤醒循环"：否则状态已改但无帧渲染，表现为"点了没反应" — 「按需/空闲停渲染」架构下的通用陷阱（model-viewer 实测，用户报"动画片段切换后无法再次播放"）：

【现象与根因】动画控制器单测全绿（切换片段后能再次播放、旧片段不参与混合），但用户点播放毫无反应。真因与动画逻辑无关：**引擎的 activity 监听只挂在 canvas 上**（pointerdown/pointermove/wheel/keydown…），而侧栏面板里的点击根本不经过 canvas。渲染循环一旦因空闲停掉，从面板发出的命令只改了状态、**没有任何一帧被渲染**，于是"状态对了但画面不动"。之所以总是出现在"切换片段之后"：切换片段本身就是侧栏点击，之后循环进入空闲。

【修法】让"命令式状态变更"与"唤醒渲染"绑定在一起：引擎里所有对外命令的最后一步都要 noteActivity()（本项目是 `emitAnimationState()` 统一回写状态，因此一处改动覆盖 play/pause/stop/seek/选片段/倍速/循环模式）。审计方法是逐个公开方法看它是否（直接或经由 fitToObject/applyVisibilityNow/handleResize）最终调用 noteActivity。

【可复用规则】只要渲染循环会因为"长时间无操作"而停下，就必须明确"哪些入口会唤醒它"。canvas 上的原生事件只覆盖鼠标在 3D 区域内的操作；**所有来自 UI 面板的命令路径都必须自己唤醒循环**，否则会出现一类非常难查的"点了没反应"（状态、日志、单测全部正常，只是没人渲染）。新增引擎命令时把这条当检查项。

【排障手法】先用**回归单测证明模块本身无缺陷**（本次新增 3 例把动画控制器排除嫌疑），把问题从"逻辑层"挤到"接线层"，比继续读业务代码高效得多。

## 行动指南 Action Guide

- [2026-09-17 08:46] [行动指南] 侧栏布局定案（单列 + 面板自滚 + 子项不收缩）与待办：另两个面板尚缺 flex-shrink/兜底保护 — model-viewer 侧栏布局的**已定决策与待办**（用户通过选项明确，后续不要自行扩大或改变方向）：

已定决策：
- 侧栏保持**单列**布局，不加宽、不做两列平铺、不改为全屏抽屉/独立设置页。
- 内容超出时**由面板自身滚动**（不是页面滚动）。
- flex 容器约定：**子项不参与收缩**（`.panel > * { flex-shrink: 0 }`），溢出只由面板这一个滚动容器负责。

已落地（compose 顺序即修复演进）：
1. `Viewer.vue`：`.el-tab-pane{height:100%}` + `.el-tabs__content{overflow-y:auto}`（commit c3c4227）；
2. `LightingPanel.vue`：`height:100% + max-height: calc(100vh - 130px) + overflow-y:auto`（commit 2343ce8）；
3. `LightingPanel.vue`：`> * { flex-shrink: 0 }` + `LightSourceEditor.vue` 卡片本身 `flex-shrink: 0`（commit 512ced8，修三张光源卡片被压缩导致的静默裁切）。

待办（需用户点头再做，不要擅自扩大改动面）：
1. 扫描已确认 **ModelInfoPanel 与 DisplayPanel 同样缺少 `flex-shrink: 0` 保护**（两者都是固定高度 flex 列容器且含 `overflow:hidden` 的子元素），存在与光照页相同的潜在裁切风险；已向用户提出，等其确认后再补这一行。
2. 这两个面板也**尚未**加 `max-height: calc(100vh - 130px)` 这层与祖先无关的兜底。
3. 若再报"内容缺失/看不到"，先让用户 `Ctrl+F5` 强刷（旧 bundle 会看到修复前状态），再按 lessons 条目的两个判断法定位是 A（高度链）还是 B（flex 收缩）。
- [2026-09-17 09:40] [行动指南] 界面布局与控件定案：动画控制条悬浮底部（图标按钮并排）、模型信息 HUD 悬浮左上角（快捷键 I）；已移除底部状态栏与动画标签页 — model-viewer 界面布局与控件的用户定案（2026-09，按用户明确要求调整，后续不要改回）：

【动画控制】改为**悬浮在渲染区底部的控制条**（components/viewer/AnimationBar.vue）：片段选择 + 播放·暂停 + 停止 + 时间轴 + 倍速 + 循环模式 + "已播完"标记；**仅在模型含动画时出现**；事件名与原来的侧栏面板完全一致，所以 Viewer.vue 的处理函数无需改动。**原「动画」标签页已删除**（components/panels/AnimationPanel.vue 已删）。

【播放/停止按钮】用户明确要求**纯图标、两个独立按钮并排**（不再包 button-group、不再用文字）✅ 已实现（commit f8dec99）。约定：
- 图标用**内联 SVG + `currentColor`**（跟随按钮配色），**不引入 `@element-plus/icons-vue`** —— 本项目一直避免图标依赖包，几个 path 足够；
- 图标随状态切换（播放中显示暂停图标），播放态保持主题色高亮；
- 文字去掉后必须补 `title` 与 `aria-label`，否则可发现性与读屏体验受损；
- 用户后续可能继续要求把倍速/循环也做成图标或圆形按钮 —— 属于待确认的延伸，不要提前改。

【模型信息】改为**渲染区左上角的浮动 HUD**（components/viewer/InfoHud.vue），显示：文件名、格式、大小、三角面、顶点、尺寸（按「模型信息」页声明的单位换算，三轴各自带单位）、帧数、FPS、渲染模式（后处理/直渲）、运行环境，以及渲染异常文案；折叠态只保留一个小圆点按钮。**快捷键 I 切换显示/隐藏**（会话级未持久化；HUD 自带折叠/展开按钮，不依赖快捷键可发现）。**原底部状态栏已删除**（components/layout/ViewerStatusBar.vue 已删）。

【相关约束】① 浮层都放在 `.viewer__stage` 内（`position: absolute` + `z-index: 3`），必须留在 `ModelCanvas` 的兄弟位置而不是插槽内，避免被 canvas/CSS2D 层影响交互；② 快捷键 `I` 的 enabled 恒真（无模型时也能切换 HUD），其余快捷键各自做了空值保护；③ 信息/控制移到浮层后，Viewer.vue 里 formatLabel/sizeText/triangleText/animationTabLabel 等计算属性与 formatBytes/resolveFormatById 导入已随之清理。

【验证手段】这类纯 UI 结构调整**构建不报错、单测覆盖不到**，因此固定用 `node scripts/diagnose-sfc.cjs` 做组件绑定静态检查（本次重构后 14 个组件全部通过）+ 人工在浏览器确认。
