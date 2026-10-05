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
- [2026-09-17 10:06] [工作记录] 明暗主题已实现：暗色/亮色/跟随系统（UI 跟随、3D 视口不跟随；308 测试全绿） — E:\AI-Coding\model-viewer 实现了界面明暗主题（commit 13d15a6，工作区干净；已通过 308/308 单测 + 14 组件 SFC 绑定检查 + 双端构建）。**替代此前"不具备明暗切换"的记录**。

【实现】
- `core/theme.js`（纯函数，可测）：`THEME_MODES`（dark/light/system，默认 dark）、`resolveTheme(设置, 系统偏好)`、`applyTheme(theme, doc)` —— 切换 `<html>` 的 `dark` 类**并同步 `documentElement.style.colorScheme`**（关键：不同步的话亮色主题下原生滚动条/下拉/对话框仍是深色）、`systemPrefersDark()`、`createSystemThemeWatcher({onChange, target})` 返回取消订阅函数（环境不支持 matchMedia 时返回空函数，调用方无需判空）。
- `stores/themeStore.js`：**独立 store**（不是塞进 settingsStore）——因为它带"落到 DOM 的副作用 + 系统监听生命周期"，职责与纯偏好读写不同。设置键 `appearance.theme`（仍写 viewer_settings）。`init()` 读设置 → 应用 → 订阅系统变化；`setMode()` 立即生效并持久化；`dispose()` 退订。
- `App.vue` 挂载时 `theme.init()`：`index.html` 里的 `<html class="dark">` **只是首屏默认值**，用户选过的"亮色/跟随系统"必须在挂载后接管（否则刷新会闪回暗色）。
- 设置页新增「外观」卡片（暗色/亮色/跟随系统三选）。
- 浮层背景抽成全局变量 `--viewer-overlay-bg`（暗 rgba(15,17,21,.72) / 亮 rgba(255,255,255,.86)，定义在 src/style.css 的 `:root` 与 `html:not(.dark)`）。

【用户确认的取舍（重要，不要再改回）】**UI 跟随明暗，3D 视口底色不跟随**：视口背景仍由「显示 → 背景」控制并默认深色，理由是与主流三维软件（Blender/Maya）一致、深色更利于判断形体与材质。因此 `Viewer.vue` 的 `#1b1e24` 与 `ModelCanvas.vue` 的棋盘格 `#22262d/#333941` **保持硬编码深色**，刻意不接入主题。信息 HUD 保持用户指定的 **0.3 透明度**，亮色下只换成浅色半透明底（新增 `html:not(.dark) .info-hud__panel/.info-hud__chip` 规则）。

【顺带修正】设置页「关于」卡片过期信息（原写"0.1.0（M1 里程碑）"并把已完成的格式/光照/动画列为"计划中"），已更新为当前真实能力清单。

【待办】设计文档 §21 与 README **尚未**补明暗主题一节（本轮优先保证代码与测试闭环）；下次继续时补齐，或与 M6 章节一并写。
- [2026-09-17 14:13] [工作记录] 修复 pnpm tauri dev 启动 panic：删除 sql preload 的 ~ 路径（已推送 0263b00） — model-viewer 启动崩溃已修复并推送（commit 0263b00，清理误入库文件 7359910）。

【做了什么】删掉 `src-tauri/tauri.conf.json` 里的 `plugins.sql.preload`（内容是 `sqlite:~/.model-viewer/app/app.db`）—— 该 `~` 会触发 SQL 插件社区 fork 的 `expand_tilde()`，其中 `env::var("HOME").expect(...)` 在 Windows（无 HOME）上启动即 panic（exit 101）。原因是用户报 "pnpm tauri dev 报错 HOME 环境变量不存在: NotPresent"。详见经验教训 3c567b7a6f86（含依赖源码证据与替代方案核对）。

【安全性论证（已核对依赖源码，不是猜）】建库由插件 `DbPool::connect` 的 `create_database` 负责；迁移按 URL 字符串注册、由前端 `Database.load`（绝对路径，与 Rust `add_migrations` 的键一致）命中执行。因此删 preload 不影响建库与迁移。

【护栏】`paths.rs` 新增单测 `配置里不应出现波浪号数据库路径`（`include_str!("../tauri.conf.json")` + 断言无 `~`），任何人把 `sqlite:~...` 加回来会立刻失败。

【验证】cargo 48/48；`cargo build` 后在没有 HOME 的环境直接启动 `target/debug/model-viewer.exe`，进程存活 10s 无 panic（修复前该阶段即退出）；vitest 381/381。

【下一步（用户侧）】重新执行 `pnpm tauri dev`，确认窗口正常起来并检查设置/最近文件能读写（这条同时验证迁移仍生效）。真机验收清单见记忆 670bf3b062fd（M6 收尾交接）的最后一节。
- [2026-09-21 17:45] [工作记录] 渲染/加载性能优化四阶段落地（未提交）：性能快照、resize 去抖、恒等 pass 跳过、光照免重编译、解码器复用、低性能模式 — model-viewer 本轮性能优化（用户选定“渲染/加载性能”方向，四个阶段全做；**尚未 git commit**）。

【改动清单（15 改 + 6 新增）】
- 新增 `core/three/resizeScheduler.js`(+test)：resize 合并到每帧一次，仿 renderLoop.js 的“句柄先清空再回调”不变式。
- 新增 `core/three/perfMode.js`(+test)：低性能模式的纯逻辑（像素比上限、MSAA 采样、antialias 决策）。
- 新增 `utils/perf-snapshot.js`(+test)：性能快照文本化纯函数。
- `postfx.js`：saturation===1 时 `saturationPass.enabled=false`；`applySize` 不再重复调 `composer.setPixelRatio`（它内部已调 setSize）；新增 `setSamples()`（改 samples 必须丢 composer）与 `describe()`；导出 `DEFAULT_POSTFX_SAMPLES`。
- `ViewerEngine.js`：`getPerfSnapshot()`、`pixelRatioLimit` getter、`setLowPerformance()`、resize 短路（尺寸@像素比）、低性能模式读进构造参数（antialias/samples）。
- `lighting.js`：关闭光源改用 `intensity=0`（`visible` 恒 true），`enabledCount` 判据改为 `intensity>0`。
- `ModelLoader.js`：解码器模块级共享（`getGltfDecoders`/`disposeGltfDecoders`），loadGltf 不再 finally dispose。
- `useViewerEngine.js`：unmount 时 `disposeGltfDecoders()`。
- `settingsStore.js`：新增 `perf.lowPerformance`（默认 false）。
- `InfoHud.vue`/`Viewer.vue`：HUD 加“复制性能快照”按钮（剪贴板失败回退 console）。
- `Settings.vue`/`ModelCanvas.vue`：低性能模式开关 + 接线。
- 顺手修掉 `ModelCanvas.vue` 里重复注册两次的 `watch(() => model.root, syncInspection)`。
- `docs/设计文档.md`：新增 §36（诊断表含源码行号、交付、决策、自我纠正、验证、待真机确认），并更新 §29.1/§29.4 的性能快照出口与采集方法。

【验证】vitest 463/463（41 文件，基线 434/38）；diagnose-sfc 15/15；`pnpm build` 成功（3.88s）。未跑 cargo test（零 Rust 改动）。

【仍未做】① git commit；② 真机基准数字（§29.4 仍为空）；③ 视觉等价性肉眼确认。
- [2026-09-21 18:05] [工作记录] 阴影 + 五个后处理通道落地（未提交）：PostFx 改为可插拔通道架构，含 GTAO/描边/泛光/景深/调色 — model-viewer 本轮新增"阴影 + 后处理效果"（承接 §36 性能优化；**尚未 git commit**）。

【第一步是重构，不是加效果】PostFx 从硬编码三段式改成**可插拔通道**：
- 通道定义在 `src/core/three/postfx/*.js`，字段：`id / label / order / defaultEnabled / defaultSettings / ranges / heavy` + `create / update / isIdentity / describe / dispose`。
- 组装：按 order 升序插在 RenderPass 之后，OutputPass 固定最后。
- **所有通道在 composer 创建时一次性建好，之后只切 `pass.enabled`** —— 开关效果不重建 render target。
- `isIdentity(settings, pass)` 把 §36 的"恒等跳过"通用化（AO 强度 0、泛光 0、调色全默认、描边无选中都自动跳过）。
- `saturation` 拆到 `postfx/saturation.js`；`postfx.js` 保留全部原有导出，**重构后 463 个既有用例零改动全绿**。

【五个通道】outline(10,默认开)/gtao(20,默认开,heavy)/bloom(30,**默认关**,heavy)/dof(40,**默认关**,heavy)/grade(80,默认开)/saturation(90,默认开)。
- 泛光与景深默认**关**：用户授权"效果优先可默认开"，但这两个会主动糊掉/模糊模型，与查看器定位冲突，故默认关（随时可开，已在文档与汇报中明说）。
- 没做 LUT：与"饱和度 + 5 种色调映射"重叠，且需要 3D 查找表资源；改用分级 shader 做色温+暗角。**刻意不做对比度**（那是显示空间操作，放 OutputPass 之前会变成"曝光式"结果）。
- 世界尺度参数由引擎写入：gtao 的 `sceneRadius`、dof 的 `focusDistance`（相机移动时更新，带阈值去抖）。

【阴影（诊断发现项目原本零阴影）】`lighting.js` 只让主光 castShadow；`stage.js` 加 ShadowMaterial 接收面（只显示阴影、自身透明）；`fitShadowCamera(box)` 按包围盒重算正交范围且**不动 light.target**（改靶心=悄悄改打光）。**关键：`shadowMap.autoUpdate = false` + 脏标记**，只在模型/可见性/摆放/轴向/光源/动画帧变化时重渲 —— 相机移动不影响影子，所以静态查看零 shadow map 开销。

【配套】`postfxStore.js`（单个 JSON 键 `postfx.channels`，默认值只从通道定义取；持久化只保留 `ranges` 里的键，天然排除引擎写入的运行时字段）；低性能模式 `setHeavyChannelsEnabled` 压制 heavy 通道但保留 UI 开关；`displayStore.showShadow`（默认开）；DisplayPanel 动态渲染通道开关与滑杆；Viewer.vue 的 onSelectNode/onFocusNode 调 `engine.setSelectedNode`；性能快照加"效果通道"行。

【验证】vitest **495/495（42 文件，基线 463/41）**；diagnose-sfc 15/15；`pnpm build` 成功。新增 `postfxStore.test.js`；`postfx.test.js` 12→26（含**内置通道冒烟测试**：用真实 Scene+PerspectiveCamera 逐个 create/setSize/dispose）。

【仍待】① git commit；② **真机验证五个通道的实际画面与兼容性**（Node 测不了 GPU；尤其要确认 AO/泛光在半透明背景与"仅线框"下是否异常）；③ 用 §29.4 基准测 GTAO 默认开带来的开销 —— 这是"效果优先"的代价，必须用数字说话。
- [2026-09-21 18:15] [工作记录] 已提交并推送：远端 origin/main = c06e4f0（§36 性能优化 + §37 阴影与后处理 + 阴影 bug 修复，34 文件） — model-viewer 本轮改动已提交并推送完成。**远端 origin/main = c06e4f0**（本地与远端一致，`main...origin/main` 无 ahead/behind）。

【提交】c06e4f0 `feat(render): 阴影与后处理通道扩展，以及渲染/加载性能优化` —— **34 个文件**（19 改 + 15 新），conventional commit + 四段 body（性能优化 §36 / 阴影与后处理 §37 / 阴影 bug 修复 §37.7 / 验证结果）。

【本提交覆盖的两轮工作】
1. 渲染与加载性能优化（§36）：resize 去抖、跳过恒等饱和度 pass、光源开关改用 intensity=0、解码器应用级共享、低性能模式、性能快照出口、修掉 ModelCanvas 重复 watch。
2. 阴影与后处理（§37）：PostFx 重构为可插拔通道（`src/core/three/postfx/` 下 7 个文件）；五个通道（描边/GTAO/泛光/景深/调色）；阴影（主光投影 + ShadowMaterial 接收面 + autoUpdate=false 脏标记）；并修复"模型完全没有阴影"（§37.7：光源侧漏首次同步 + 模型网格从未开 castShadow）。

【验证基线（最新，供后人对齐）】vitest **498/498（42 文件）**、`scripts/diagnose-sfc.cjs` **15/15**、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【推送要点（复现用）】push 必须 `sandbox_permissions: danger-full-access`：受限沙箱下 ssh 经 sh.exe 包装会报 `couldn't create signal pipe, Win32 error 5`。本次用 `$env:GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20'` 加 `git push`，一次成功。**git commit 的 -m 消息避开 ASCII 双引号**（PowerShell 会拆成 pathspec），多段内容用多个 -m 传。

【仍未做（用户侧真机验收）】① 阴影是否真的出现（本次刚修的 bug，需用户确认）；② 五个后处理通道的实际画面与兼容性（AO/泛光在半透明背景与「仅线框」下是否异常）；③ 用 §29.4 基准测 GTAO 默认开的性能代价 —— 这是"效果优先"的代价，数字仍缺；④ §36.6 与 §37.6 里列出的其余人工确认项。
- [2026-10-03 16:27] [工作记录] 外壳改为悬浮覆盖层（侧栏默认折叠、工具栏常驻，未提交）：Viewer.vue 布局重写 + §38 — model-viewer 外壳改为悬浮覆盖层（侧栏可折叠且**默认收起**、工具栏常驻）——**尚未 git 提交**。

【改动】`src/views/Viewer.vue`（模板与布局样式整体重写：去掉 el-container / el-header / el-main / el-aside，改为 `div.viewer` + `.viewer__stage{position:absolute;inset:0}` + 悬浮 `.viewer__toolbar` + 悬浮 `.viewer__aside` + **独立**的 `.viewer__aside-toggle`）；`src/style.css` 新增 `--viewer-toolbar-height: 52px`；`src/components/viewer/InfoHud.vue` 的 top 改为 `calc(var(--viewer-toolbar-height) + 10px)` 让开工具栏；`docs/设计文档.md` 新增 §38。

【默认状态（用户明确要求）】侧栏**默认收起**：`asideCollapsed` 初值 `true`，进入查看器先让画布吃满窗口，需要时点右边缘按钮展开。状态是**会话级、不持久化**，因此每次打开应用都是默认收起；会话内展开后切到设置页再回来仍保持（keep-alive 缓存）。

【关键决策】① 折叠用 `transform: translateX()` 而非动画 width（宽度动画每帧触发布局，旁边有 WebGL 画布在渲染）；② 折叠按钮**独立于侧栏**、收起后回到屏幕右边缘（若放进侧栏内部，收起即失去再次打开的入口）；③ 收起时同时 `opacity:0` + `pointer-events:none`（否则透明区域仍拦截画布鼠标操作，表现为拖不动模型）；④ 让位量集中成一个 CSS 变量；⑤ 画布 `absolute inset:0` → 折叠侧栏**不再触发画布 resize**，顺带避开后处理 applySize 重建 render target 的那条路径。

【验证】vitest 498/498（42 文件）、`scripts/diagnose-sfc.cjs` 15/15（Viewer.vue 绑定 96 个）、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【待真机确认】① 默认收起时右边缘按钮可见且可点开；② 工具栏「设置」按钮靠右（本轮修掉的回归）；③ 亮色主题浮层可读性；④ InfoHud 是否完全避开工具栏；⑤ `backdrop-filter` 在横跨全宽工具栏上的性能代价（掉帧则去掉这两处 blur）。

【提交状态】累积**三批**未提交改动：§38 悬浮布局 + §39 点设置模型丢失修复 + 本次默认折叠。用户尚未要求提交推送。
- [2026-10-03 16:34] [工作记录] 修复点设置后模型丢失（未提交）：根因是路由卸载触发引擎 dispose，改用 keep-alive 缓存查看器 + §39 — model-viewer 修复"点设置后模型丢失"（**尚未 git 提交**）。

【根因（路由层，非渲染层）】`App.vue` 原本是裸的 `<router-view />`，`/` 与 `/settings` 是独立路由 → 跳转时 `Viewer` 组件被**卸载** → `useViewerEngine` 的 `onBeforeUnmount` → `engine.dispose()` → `disposeObject3D(currentRoot)` 释放模型资源；返回时重建的是空引擎。**这是既有问题**（路由自 M0 起如此设计），不是 §38 布局重构引入的，布局改动只是让入口更容易被点到。

【修复】`App.vue` 用 `<router-view v-slot="{ Component }"><keep-alive :include="['Viewer']"><component :is="Component" /></keep-alive></router-view>`（只缓存查看器，不缓存设置页）。另有三处配套，缺一不可：① `Viewer.vue` 加 `defineOptions({ name: 'Viewer' })`（include 按组件名匹配，显式声明避免改名后静默失效）；② `ViewerEngine` 新增 `suspend()`/`resume()`，并让 `handleResize` 与 `ResizeObserver` 在 suspended 时直接返回（隐藏期间画布尺寸报 0，否则会把 render target 缩到 1×1、返回时再放大，白重建两遍 GPU 资源；`resume` 里必须先清 `lastResizeKey` 否则重算被短路挡掉）；③ Viewer.vue 新增 `isActive` ref，`useHotkeys` 的 `enabled` 由 `() => true` 改为 `() => isActive.value`（快捷键监听在 window 上，与视图可见性无关）。

【验证】vitest 498/498（42 文件）、`scripts/diagnose-sfc.cjs` 15/15（Viewer.vue 绑定 96 个）、`pnpm build` 成功（453ms）。未跑 cargo test（零 Rust 改动）。文档见 §39。

【待真机确认】① 点设置再返回模型仍在且**瞬间恢复**（无需重新加载文件）；② 在设置页按 f/1/s 等快捷键无任何反应；③ 返回后画布尺寸正常、侧栏折叠状态保持。

【提交状态】累积两批未提交改动：§38 悬浮覆盖层布局 + §39 本修复。用户尚未要求提交推送。
- [2026-10-03 16:42] [工作记录] 选中描边改橙红并补「清除高亮」（未提交）：新增 selection.js + 修掉 el-tree 空串静默失败 + §40 — model-viewer 选中高亮两项改动（**尚未 git 提交**）：

【1. 描边改橙红】`src/core/three/postfx/outline.js`：`OUTLINE_VISIBLE_COLOR` 由蓝 `#7fb2ff` 改为橙红 `#ff6b35`，`OUTLINE_HIDDEN_COLOR`（被遮挡部分）由 `#2a3f66` 改为同色相压暗的 `#8a3419`。原先的注释"与线框覆盖层同色系，保证选中与线框是一套语言"已**反向更新**：橙色选中 + 蓝色线框（`shadeModes.js` 的 `OVERLAY_COLOR`）色相拉开，两者同时出现才分得清哪个是被选中的节点。

【2. 补上「清除高亮」】此前选中是单向的（只能改选另一个节点，无法回到"什么都没选"）。新增两个等价入口：工具栏「清除高亮」按钮（未选中时禁用）+ **再次点击已选中的那个节点**。判定抽成纯函数 `src/core/selection.js` 的 `resolveNodeClick(currentId, clickedId)`（再次点击同一节点返回空串）并配 `selection.test.js`。`Viewer.onSelectNode` 无需改动 —— 它本来就把空 id 当"清除"（`nodeId ? ... : null`）。

【3. 顺带修掉的 Element Plus 坑（关键）】清除后描边消失但**列表那一行高亮残留**。根因：el-tree 的 `setCurrentNodeKey('')` 既不是 `null`/`undefined`（不进清除分支），又找不到 key 为 `''` 的节点（`if (node)` 不进设置分支）→ **静默什么都不做**。修法：绑定处映射空值，`:current-node-key="selectedId || null"`（`modelStore` 仍用 `''` 表示无选中，转换只在这一处）。

【验证】vitest **501/501（43 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功（461ms）。未跑 cargo test（零 Rust 改动）。

【待真机确认】① 描边是橙红且清晰，与线框（`W` 键）同时开启时不混淆；② 三个清除路径都生效且**列表与视口一起**变干净（工具栏按钮 / 再次点击同一节点 / 切换模型）；③ 被遮挡部分的暗橙红描边深浅是否合适。

【提交状态】累积**四批**未提交：§38 悬浮布局 + §39 点设置模型丢失修复 + 侧栏默认折叠 + §40 本次高亮改动。
- [2026-10-03 16:51] [工作记录] 引入 Iconify/Material Symbols 图标（未提交）：unplugin-icons 编译期按需 +6KB，覆盖查看器全部高频按钮 + §41 — model-viewer 引入图标库（Iconify / Material Symbols）给高频按钮加图标（**尚未 git 提交**）。

【选型】`unplugin-icons` + `@iconify-json/material-symbols`（均 devDependencies），配置只有 `vite.config.js` 一行 `Icons({ compiler: 'vue3' })`。**刻意不用 Iconify 运行时 API**（桌面版必须离线）也**不用 `addCollection(整集)`**（会把数千图标打进安装包）。`~icons/material-symbols/xxx` 在编译期变成 Vue 组件，只打包真正 import 的那几个。

【体积实测】`Viewer-*.js` 482 → **488 KB（+6 KB）**，`index-*.js` 未增。

【覆盖范围】工具栏（打开/适配/重置/视图/着色/截图/设置）、层级面板（显示/隐藏/重置/清除高亮/聚焦）、动画条（播放/暂停/停止）、信息浮层（展开/关闭/复制快照）、加载遮罩（取消）、空状态（打开模型）、最近文件（清空/移除）、显示面板（通道重置/恢复默认）、光照面板（导入/移除/保存主题/主题行三动作）。**顺带把动画条原本手写的内联 SVG 播放/暂停/停止换成了图标库同一来源**。

【窄容器决策】侧栏仅 340px，层级面板工具栏与光照主题表格操作列（152px 放 3 个动作）改用**纯图标 + tooltip**（「图标+文字」会溢出）；每个纯图标位置都配了 tooltip 保可发现性。

【⚠️ 非预期变更（需真机确认）】`pnpm add` 把范围内依赖解析到最新：`element-plus` 2.13.7 → **2.14.5**、`vue` 3.5.32 → **3.5.42**、`vite` 8.0.4 → **8.3.0** 等（均符合原 `^` 范围）。全量测试通过，但 Element Plus 次版本升级的组件外观/行为需真机看一眼。

【验证】vitest **501/501（43 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功（653ms，全部图标名解析通过）。未跑 cargo test（零 Rust 改动）。文档见 §41。

【待真机确认】① 纯图标按钮 tooltip 是否都可弹出、语义是否一眼可懂；② **窄窗口（~900px 以下）工具栏是否拥挤**（加图标后总宽度增加，最可能出问题处）；③ 亮色主题下图标对比度；④ Element Plus 升级后的组件外观。

【提交状态】累积**五批**未提交：§38 悬浮布局 + §39 点设置模型丢失修复 + 侧栏默认折叠 + §40 选中高亮改动 + §41 图标库。
- [2026-10-03 16:54] [工作记录] 层级树聚焦改为平滑过渡（未提交）：补 animate:true；发现「适配视图」仍是瞬移待定 + §42 — model-viewer 层级树「聚焦」改为平滑过渡（**尚未 git 提交**）。

【改动】`ViewerEngine.focusNode()` 给 `fitToObject` 补上 `animate: true`（`src/core/three/ViewerEngine.js`）。此前它走默认的瞬时落位路径，点「聚焦」时视角是"跳"过去的。时长沿用 `DEFAULT_TWEEN_MS = 320ms`，与「切换视图预设」一致。

【根因：不是默认值问题，是漏传参数】`fitToObject` 的 `animate` 默认 `false` 是**刻意**的（加载模型、重新摆放、尺寸变化这类程序化路径必须立刻到位）。所以问题在于"聚焦"这个**用户主动**的视角跳转当时没显式传 `animate: true`。

【机制本来就有、无需额外处理】① 系统开启「减少动效」偏好时 `animateCameraTo` 会自动退回瞬时；② 连续点不同节点不会排队，新补间直接接管上一个。

【顺带发现的不一致（**未改，待用户决定**）】同一界面三条同类操作，两条瞬移一条有动画：
- 聚焦节点（层级树按钮）→ 本次已改平滑
- **适配视图（工具栏按钮 / `F` 键）→ 仍瞬移**（`useModelOpen.fitView()` 调 `fitToObject()` 时同样没传 animate）
- 重置视图（工具栏 / `R` 键）→ 有动画（走 `setViewPreset`，默认 `animate: true`）
建议一并改（只差一个参数，否则同一工具栏两个按钮一个跳一个滑）。

【验证】vitest 501/501（43 文件）、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功（571ms）。未跑 cargo test（零 Rust 改动）。文档见 §42。
注：这是"接线"性质的改动（把已有参数传下去），`ViewerEngine` 需 WebGL 上下文、无单测覆盖，观感只能真机确认。

【待真机确认】① 聚焦过渡是否顺畅、**聚焦到很远的节点时 320ms 是否偏快**（跨度大可按时长自适应，`cameraTween.js` 备有 `MIN_TWEEN_MS=80`/`MAX_TWEEN_MS=2000`）；② 连续聚焦多节点是否被新补间干净接管；③ 开「减少动效」时是否瞬时到位。

【提交状态】累积**六批**未提交：§38 悬浮布局 + §39 点设置模型丢失修复 + 侧栏默认折叠 + §40 选中高亮改动 + §41 图标库 + §42 聚焦动画。
- [2026-10-03 17:00] [工作记录] 层级列表可见性开关改图标（未提交）：el-switch→图标按钮，状态用三重信号表达 + §43 — model-viewer 层级列表的可见性开关改为图标（**尚未 git 提交**）。

【改动】`src/components/panels/ModelTreePanel.vue`：每行右侧的 `el-switch` 换成**图标按钮**（`visibility` / `visibility-off`，两个名字此前已验证存在），与左侧「聚焦」图标按钮成为同一套。

【理由（与 §41.3 的窄容器决策同源）】`el-switch` **每行都占固定宽度**，而这一列本来就要和长模型名抢空间（§40 那轮修过的"长名字挤掉操作按钮"）。图标按钮更窄，视觉上也与相邻的「聚焦」统一。

【状态表达：换了控件必须补偿可辨性 —— 三重信号】
① 图标形状：实心眼睛（可见）/ 划掉的眼睛（隐藏）；
② 按钮颜色：用 Element Plus 的 `type`，可见 `default`、隐藏 `info`（灰）—— **用 `type` 而不是自定义 CSS**，既符合项目"复用 Element Plus 组件"的规范，也不必和它的样式特异性较劲；
③ 节点名：原有的 `tree-node__label--hidden`（删除线 + 变灰）保持不变。

【接口未变】点击回调从 `@update:model-value` 的 `$event` 改为显式取反（`!data.visible`），对外的 `toggle-visibility(nodeId, visible)` 事件签名不变，上层 `Viewer.onToggleNodeVisibility` 一行未动。

【验证】vitest 501/501（43 文件）、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功（597ms）。未跑 cargo test（零 Rust 改动）。文档见 §43。

【待真机确认】① 可见/隐藏两态的图标是否一眼可辨（尤其**隐藏态在深色主题下的灰**）；② 点图标只切可见性、**不会顺带选中该节点**（`@click.stop` 仍在，需实测）；③ 长模型名下两个图标按钮的排布。

【仍待用户决定】「适配视图」（工具栏 / `F` 键）仍是瞬移，而「重置视图」有动画 —— 同一工具栏两个按钮行为不一致，改法只差一个参数（见 §42.2）。

【提交状态】累积**七批**未提交：§38 悬浮布局 + §39 点设置模型丢失修复 + 侧栏默认折叠 + §40 选中高亮 + §41 图标库 + §42 聚焦动画 + §43 可见性开关图标化。
- [2026-10-03 17:57] [工作记录] 已提交并推送：远端 276de46（§38~§43 七批 UI 改动，21 文件）；提交时排除来源不明的 .nvmrc 改动 — model-viewer 七批 UI 改动**已提交并推送**。**远端 origin/main = 276de46**（本地与远端一致，工作区干净）。

【提交】276de46 `feat(ui): 悬浮覆盖层布局、图标化与交互改进，并修复模型丢失等缺陷` —— **21 文件，+1292/−187**，提交信息按七个主题分段。

【覆盖的七批工作（详见设计文档 §38~§43）】
1. §38 悬浮覆盖层布局（画布 absolute inset:0 铺满，工具栏常驻悬浮，侧栏可折叠悬浮面板）
2. 侧栏**默认收起**
3. §39 修复"点设置回来模型丢失"（keep-alive 缓存查看器 + 显式组件名 + 隐藏期暂停尺寸响应 + 按 isActive 关停全局快捷键）
4. §40 选中高亮：描边改橙红 + 补清除高亮两入口；并修 el-tree 空串静默失败
5. §41 图标库：Iconify Material Symbols 经 unplugin-icons 编译期按需（+6KB、离线）
6. §42 层级树聚焦补 animate:true
7. §43 层级列表可见性开关 el-switch → 图标按钮

【依赖变更（同一提交内）】`pnpm add` 顺带把 element-plus 2.13.7→2.14.5、vue 3.5.32→3.5.42、vite 8.0.4→8.3.0 等解析到各自 semver 范围内最新。非主动升级，**组件外观需真机确认**。

【提交前回归（全量，因含依赖变更）】vitest **501/501（43 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【提交时排除的一处无关改动】暂存清单里出现 `.nvmrc` 由 `22.22.1` 改成 `22.23.3`（正好是当前机器的 node 版本，项目内没有任何 pnpm node 版本配置，来源不明、与本次功能无关），已 `git checkout` 回退、**未随本次提交**。若确需让项目跟上 node 版本，应另开一个 `chore` 提交。

【仍未做】① 真机验收清单（阴影是否出现、点设置后模型是否还在、五个后处理通道画面与兼容性、GTAO 默认开的性能代价、§29.4 基准数字仍为空、图标 tooltip 与窄窗口工具栏、Element Plus 升级后的组件外观）；② 待用户决定：「适配视图」（工具栏 / `F`）仍是瞬移而「重置视图」有动画，同一工具栏行为不一致，改法只差一个参数（§42.2）。
- [2026-10-03 18:02] [工作记录] 已提交并推送：远端 5e584b4（适配视图平滑 cf7e902 + .nvmrc 修正 5e584b4）；并记录 §44 真机验收 — model-viewer 本轮收尾（**已提交并推送**）：**远端 origin/main = 5e584b4**（本地与远端一致，工作区干净）。

【1. 适配视图改用平滑过渡】`src/composables/useModelOpen.js` 的 `fitView()` 改为 `engineRef.value?.fitToObject(undefined, { animate: true })`。至此三条同类操作统一：聚焦节点（层级树）/ 适配视图（工具栏、`F`）/ 重置视图（工具栏、`R`）都是平滑过渡。提交 `cf7e902`。
- **易踩细节**：第一个参数必须显式传 `undefined` 占位 —— `fitToObject(object = currentRoot, options)` 的默认值只在实参为 `undefined` 时生效，传 `null` 会被当成"没有对象"直接返回。
- **加载模型路径不受影响**（先查证再改）：`fitView` 的唯一调用点是工具栏与 `F` 键（`Viewer.vue`），加载走 `setModel` 内部的 `fitToObject`，保持瞬时 —— 这正是 `animate` 默认值为 `false` 的原因。

【2. 真机验收记录】用户回复"已确认"，据此在 `docs/设计文档.md` 新增 **§44**，按"§38~§43 的确认清单整体通过"记录（措辞注明未逐项说明细节，有例外可直接追加）。同时 §42.2 更新为三条操作的最终状态。

【3. 修正上一轮的误判（重要）】上一轮我把 `.nvmrc`（`22.22.1`→`22.23.3`）当成"来源不明"排除出提交，**那是错的**：本机只装了 node 22.23.3，版本包装器按 `.nvmrc` 找不到 22.22.1，导致测试与构建全部失败。已恢复并单独提交 `5e584b4 chore: 同步 .nvmrc 到当前 node 版本（22.23.3）`。教训已并入记忆 74f88d3a280d（修正为"先验证再排除"）。

【验证】vitest **501/501（43 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【仍是空白的一项】**§29.4 的性能基准数字**（十万级 / 四十万级三角面的 FPS 与性能快照文本）需按 §29.1 流程人工采集回填；§36.6 与 §37.6 里关于**开销大小**的条目同样仍待数字。"功能是否正常"的验收与"开销多大"是两件事，后者至今没有数据。
- [2026-10-05 09:38] [工作记录] assets/hdr 8 张全景压缩到 1600×800（97MB→22.2MB，原图未动）：ImageMagick Q16-HDRI + triangle 滤镜，动态范围已验证 — model-viewer 把 `assets/hdr/` 的 8 张全景 HDR 压缩到 1600×800 完成（**原图未动，待用户决定是否替换**）。

【结果】97.0 MB → **22.2 MB（−77%）**，全部 1600×800，`magick identify` 逐个验证。绝大多数文件 −75%~−84%；`隔壁.hdr` 本来就已经是 1600×800，体积不变。输出在 **`assets/hdr/1600x800/`**（新目录），8 个原文件保持原样 —— 覆盖不可逆，先问过用户。

【命令】本机 ImageMagick 在 `D:\Environment\Scoop\apps\imagemagick\current\magick.exe`（**7.1.2-31 Q16-HDRI**）。批量：
`magick <in>.hdr -filter triangle -resize 1600x800 <out>.hdr`
`-resize WxH` 是"装入该框、保持比例、只缩不放"，所以已是目标尺寸的图不会被放大，2:1 的源正好落成 1600×800。

【动态范围验证（关键）】对比原图与压缩图的 `mean`/`max`：石林 mean 38446→38319、max 497656→495608；灯光室-2 与 灯光室-白-黑 的 **max 完全一致**（60927.1 / 68095）。mean 的微小下降是降采样的正常平滑；max 基本不变即证明**没有截断、也没有 ringing**。

【顺带查清】`src/` 里**没有任何代码引用 `assets/`**（grep 无匹配），所以该目录是纯源素材，**不会进应用也不会进安装包**。若要把这些 HDR 用到应用里（例如做内置环境贴图预设），必须另放到 `public/`（原样复制进 dist）或 `src/assets/`（走 vite 处理）。

【待用户决定】① 是否用压缩版替换原文件（替换后 `assets/hdr/` 下即 1600×800 版本，原图不再保留）；② 是否要把它们接进应用作为环境贴图来源。
- [2026-10-05 09:42] [工作记录] 应用图标已用新源图重新生成（未提交）：RMSE=0 验证嵌入成功；productName 已改为 ModelViewer；assets/hdr 119MB 待决定 — model-viewer 应用图标已用新源图重新生成完成（**图标相关改动尚未提交**）。

【做了什么】源图 `assets/Icon.png` 已被用户更新为 2048×2048 / 8-bit TrueColorAlpha / 3.4 MB 的新图。执行 `pnpm tauri icon assets/Icon.png` → `src-tauri/icons/` **17 个文件**；随后按既有流程收尾：① 删掉 `android/` 与 `ios/`（`tauri icon` 默认连移动端一起生成）；② `src-tauri/icons/64x64.png` → `public/favicon.png`；③ `touch src-tauri/build.rs` 后 `cargo build`（28.9 s，**不 touch 的话 tauri-build 不会重编译，资源会停在旧图标**）。

【客观验证（比肉眼比对更硬）】用 .NET `ExtractAssociatedIcon` 从 `src-tauri/target/debug/model-viewer.exe` 抠出图标，与新生成的 `src-tauri/icons/32x32.png` 做 RMSE 比对：**RMSE = 0（完全一致）** —— 证明新图标确实嵌进了 exe，避开了"不重编译"那个坑。favicon 与新源图缩放的 RMSE = 1.6%（`tauri icon` 与 magick 缩放算法差异，属正常）。`bundle.windows.nsis.installerIcon/uninstallerIcon` 早已配好，所以**下次 `pnpm tauri build` 时安装包图标会自动更新**（本轮未跑打包做端到端验证）。

【状态变更（用户采纳了上一轮的方案 A）】`src-tauri/tauri.conf.json` 的 **`productName` 已由 `三维模型查看器` 改为 `ModelViewer`**。影响：安装目录与安装包文件名变英文（`%LOCALAPPDATA%\ModelViewer\`、`ModelViewer_0.1.0_x64-setup.exe`）；**开始菜单快捷方式名与「设置 → 应用」里的显示名也跟着变英文**；窗口标题由 `app.windows[].title` 独立控制，**保持中文不受影响**；旧目录 `%LOCALAPPDATA%\三维模型查看器\` 会残留，需手动卸载一次。

【待用户决定（本轮结束时仍未定）】① **`assets/hdr/` 共 119.2 MB 且全部 untracked**（8 张原图 97 MB + 我上一轮生成的 `1600x800/` 22 MB）—— 直接提交会把 119 MB 塞进仓库，需先决定：加 `.gitignore` 排除 / 只提交压缩版 / 都提交；② `public/favicon.svg` 已确认**不被任何文件引用**（Vite 模板遗留），可删；③ 是否跑一次 `pnpm tauri build` 对安装包图标做端到端验证；④ 图标相关改动是否现在提交。
- [2026-10-05 09:57] [工作记录] 8 张全景 HDR 内置进应用（未提交）：新来源 builtin 复用 imported 的纹理路径，public/hdr 22.2MB 进安装包 + §45 — model-viewer 把 8 张全景 HDR **内置进应用**（**尚未 git 提交**，与图标改动同批待提交）。

【交付】新环境来源 `builtin`，位置在光照面板「来源」（影棚 / 渐变 / **内置** / 导入 / 无），选中后用下拉挑具体那张。
- 资源：`public/hdr/` 共 8 个文件 **22.2 MB**（vite 原样复制进 `dist`，不打进 JS bundle）；**dist/hdr 实测 8 files / 22.2 MB**，确认真的进了产物。
- 文件名用 **ASCII**（`studio-1.hdr`、`mountain.hdr`、`stone-forest.hdr`…），界面显示中文（灯光室 1 / 山地 / 石林）—— 把"技术标识"与"用户可见名"分开。理由：运行时经 URL 取，非 ASCII 路径在自定义协议与子路径部署下都出过问题。
- 清单与工具函数：新增 `src/constants/builtinEnvironments.js`（`id` 持久化 / `label` 中文 / `file`；`resolveBuiltinEnvironment`、`builtinEnvironmentLabel`、`builtinEnvironmentUrl`，后者用 `document.baseURI` 拼**绝对** URL，与解码器路径同一套理由）。

【关键设计】内置与用户导入在**后续处理上完全相同**（读文件 → `registerImportedTexture` → PMREM），因此只抽出"URL 从哪来"这一层：
- `environment.js` 新增 `resolveEnvironmentTextureUrl(environment)`（imported 取 customHdrUrl / builtin 按 id 推导）与 `environmentTextureName(environment)`；
- `resolveEnvironmentPlan` 把两者归为一类（`needsTexture`），`kind` 仍复用 `imported`，**缓存键前缀由 `imported|` 改为 `texture|`**（共用同一条缓存路径）；
- `ViewerEngine` 方法改名：`needsImportedEnvironment` → `needsEnvironmentTexture`、`loadImportedEnvironment` → `loadEnvironmentTexture`；
- 但**类型没有硬塞**：内置是应用资源，不需要 asset 协议重新授权、也没有数据目录副本路径，故用独立字段 `environment.builtinId`，避免 `degradeStaleImportedEnvironment` 那类"按来源类型判断"的逻辑变别扭。

【UI】`LightingPanel` 的「来源」加内置按钮（五个选项在 340px 侧栏排不下 → CSS `flex-wrap`），并加内置下拉；`onSourceChange` 在切到内置而此前未选过时补默认 id（否则 builtinId 为空会让引擎找不到贴图、界面出现空选择框）。

【体积（已向用户确认并获接受）】安装包 4.29 MB → 约 **23 MB**（+22.2 MB 资源；NSIS 的 LZMA 对已 RLE 压缩的 HDR 再压有限）；`dist/` ~5 MB → ~27 MB。

【验证】vitest **512/512（44 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功。新增 `builtinEnvironments.test.js`（8 例）+ `environment.test.js` 补内置路径（已登记→复用 imported 且键随 id 变；未加载完 / id 已失效→退化渐变并标 fellBack，保证不黑屏）。未跑 cargo test（零 Rust 改动）。文档见 §45。

【最该真机确认的一条】**Tauri 下 `/hdr/*.hdr` 能否取到** —— 服务 `public/` 静态资源的方式与 dev 服务器不同，这是 ASCII 文件名想规避但必须实测的风险点。另附：8 张图观感、五按钮换行排版、存为主题后重启能否恢复。

【遗留待定】`assets/hdr/` 共 **119.2 MB 且全部未被 git 跟踪**（97 MB 原图 + 22 MB 我生成的 `1600x800/`）；它**不需要入库**（内置用的是 `public/hdr/` 那份），建议加 `.gitignore`，但属版本控制策略，等用户确认。另：图标改动（已重新生成、RMSE=0 验证嵌入）与本轮同批未提交。
- [2026-10-05 10:05] [工作记录] 修复内置切换不起作用（未提交）：调用点只看 customHdrUrl 导致内置永远退化渐变；改参数为回调 + 两条护栏 + §45.7 — model-viewer 修复"光照面板切「内置」不起作用"（**尚未 git 提交**，与图标 + 内置 HDR 同批）。

【现象】用户实测：切到「内置」并选中一张全景图后，环境没有任何变化。

【根因（我的实现疏漏，与 Tauri 取文件无关）】`EnvironmentManager.apply` 判断"目标贴图是否已登记"时只看一个字段：
```js
resolveEnvironmentPlan(environment, {
  importedReady: this.hasImportedTexture(environment.customHdrUrl),   // ← 只看 customHdrUrl
})
```
而**内置来源没有 `customHdrUrl`**（为 `null`）→ 永远 `importedReady = false` → `resolveEnvironmentPlan` 每次都返回"退化为渐变" → **切了等于没切**。上一轮"复用导入那条路径"的方向是对的（见 d5838c434600），漏的是**调用点**没有跟着换成统一解析出的 URL。文档 §45.7。

【修法：不止改一行】第一版在调用点改成 `this.hasImportedTexture(resolveEnvironmentTextureUrl(environment))` —— 能用，但那等于**又把"用哪个 URL 去问"交给调用方**，保留了下一次写错的机会。最终把 `resolveEnvironmentPlan` 的参数由**布尔值换成回调**：
`{ importedReady: <boolean> }` → `{ hasTexture: (url) => boolean }`。
理由：**该函数内部本来就已经算出 `textureUrl`**（靠 `resolveEnvironmentTextureUrl` 推出），让调用方再解析一遍是重复知识、必然可能不一致。收敛后"用哪个 URL 判断"只有一个答案。

【护栏】`environment.test.js` 新增两条**照 bug 写的**用例：① 内置来源必须拿**推导出的** URL 去查询（断言查询参数匹配 `/hdr/mountain.hdr$`），而不是那个不存在的 `customHdrUrl`；② 推不出 URL 时**不应发起查询**（避免拿 `null` 去问）。—— 关键手法：**断言"传给依赖的中间输入"而不只是最终结果**，否则这类 bug 测不出来。

【验证】vitest **514/514（44 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【待用户重试】重启 `pnpm tauri dev` 后切「内置」。若**仍不生效**，则落到 §45.5 列出的那个风险点：`tauri.localhost` 服务 `public/` 静态资源的方式（需看 devtools 里 `/hdr/*.hdr` 是否 404）。`app.windows[].devtools` 是开着的，可让用户看控制台。

【提交状态】累积**三批**未提交：图标重新生成（RMSE=0 已验证嵌入）、8 张 HDR 内置、本次修复。另 `assets/hdr/` 119.2 MB 仍未被 git 跟踪、建议 `.gitignore`（等用户确认）。
- [2026-10-05 10:16] [工作记录] 内置环境贴图第二处缺陷已修（未提交）：取纹理也误用 customHdrUrl 导致 scene.environment=null；改由 plan 携带 textureUrl + 可见条件清单 — model-viewer 内置环境贴图**第二处缺陷已修**（**尚未 git 提交**，与图标 + 内置 HDR + 上一轮修复同批）。

【根因（第二处，也是"完全没生效"的真正原因）】`src/core/three/environment.js:226` 取纹理时同样误用了 `customHdrUrl`：
```js
this.currentTexture = this.generateFromImported(environment.customHdrUrl)   // 内置来源这里是 null
```
→ `generateFromImported(null)` 查不到 → 返回 `null` → `scene.environment = null`。上一轮只修了"要不要用贴图"的判断（`hasTexture`），漏了"去取哪张贴图"，于是**内置贴图从未被应用过** —— 表现不是"效果弱"，而是完全无效。

【修法（彻底堵住"重复推导"）】让 `resolveEnvironmentPlan` 把它**内部已经算出的 URL 一并返回**：
```js
return { kind, cacheKey: `texture|${textureUrl}`, fellBack: false, textureUrl }
```
`apply` 改为 `this.generateFromImported(plan.textureUrl)`。这样调用方**没有机会**再解析一次。
【护栏】`environment.test.js` 新增 2 条：① 需要贴图时 plan 必须带上可用的 `textureUrl`（内置的断言匹配 `/hdr/stone-forest.hdr$`）；② 退化为渐变时不带 `textureUrl`，调用方据此不会去取一张不存在的纹理。

【验证】vitest **516/516（44 文件）**、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。**仍需用户在真机确认现象**（无法在此环境渲染验证）。

【本轮调研产出：内置/导入环境贴图"什么情况下看得出效果"（已答复用户，供后续复用）】
- ✅ **背景设为「环境贴图」**（显示面板 → 背景）→ 整幅全景图直接成为背景，**与模型材质无关，最直观**，也是推荐的验证入口
- ✅ 模型是 glTF/GLB（PBR）且**金属度高** → 明显镜面反射
- ✅ FBX（Phong）/ Lambert → 生效但弱于 PBR
- △ **STL / PLY / OBJ**（项目默认黏土材质 `metalness: 0.1 / roughness: 0.65`）→ **很微弱**，环境贴图只贡献柔和间接光，几乎看不到反射
- ❌ 着色模式 = 法线 / UV 棋盘格 / 仅线框（材质被换成 `MeshNormalMaterial` / `MeshBasicMaterial` / `LineBasicMaterial`，都不吃 `scene.environment`）
- ❌ 光照面板的「环境贴图强度」= 0

【若按上述路径仍无变化】则落到 §45.5 那个风险点：`tauri.localhost` 服务 `public/` 静态资源（`app.windows[].devtools` 已开，让用户看 `/hdr/*.hdr` 是否 404）。

【提交状态】累积**四批**未提交：图标重新生成、8 张 HDR 内置、内置切换判断修复、本次取纹理修复。`assets/hdr/` 119.2 MB 仍未被 git 跟踪、建议 `.gitignore`（待用户确认）。
- [2026-10-05 10:26] [工作记录] 修复切换内置全景图"偶发"不生效（未提交）：提前 return 使 lightingState 过期 + 晚到请求覆盖最新选择，两处同修 + §45.8 — model-viewer 修复"切换内置全景图**偶发**不生效"（**尚未 git 提交**，与图标 + 内置 HDR + 前两轮修复同批）。

【现象】用户报告：切内置全景图时**偶发**切换后不起作用 —— 多数正常、偶尔没反应。（"偶发"这个词直接指向竞态。）

【根因：两处缺陷叠加成一次覆盖】
① `ModelCanvas.applyLightingSettings` 在"需要读文件"时**提前 `return`、没有调 `applyLighting`** → 引擎内部的 `this.lightingState` 停留在**旧值**；
② `ViewerEngine.loadEnvironmentTexture` 加载完成后用的是 `this.applyLighting(this.lightingState)` —— 那个旧值。
时序（连切两张）：
```
切到 A → 开始读 A（lightingState 未更新）→ return
切到 B → 开始读 B（lightingState 仍未更新）→ return
A 先读完 → applyLighting(旧状态) → 套用旧图
B 读完   → applyLighting(旧状态) → 缓存键与 currentKey 相同且 currentTexture 非空 → 直接跳过
```
结果界面停在旧图上，**用户的选择始终没生效**。之所以"偶发"：只在"前一张读完之前又切了下一张"时触发，且后果取决于两次异步读取的**完成顺序**；慢慢切永远复现不出来。§45.8。

【修法（两处，缺一不可）】
① `ModelCanvas` 改成**先 `applyLighting(settings)`、再按需读文件**（去掉提前 return）→ `lightingState` 始终是最新选择；此刻贴图尚未登记，管线先退化为渐变，文件就绪后引擎自己切过去。
② `ViewerEngine` 应用前用新增纯函数 `shouldApplyLoadedTexture(currentEnvironment, loadedUrl)`（放在 `environment.js`）判定 → **晚到的旧请求不再覆盖最新选择**，只登记进缓存、不应用（登记总是有益的，下次切回来即命中）。判定抽成纯函数是因为它就是"这条竞态"的可测表达形式。

【护栏】`environment.test.js` 新增 4 条：读到的正是当前选中的 → 应用；已被切走 → 不应用；用户已切到非贴图来源 → 不应用；缺 URL / 缺当前环境 → 一律不应用（防御性）。

【验证】vitest **520/520（44 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【待用户复测】重启 `pnpm tauri dev` 后**快速连续切换几张内置图**（不等加载完就切下一张）—— 这是原来能复现的操作。控制台正常会打印 `环境贴图已就绪但用户已切换，暂不应用: xxx`（可据此确认竞态被拦住）。

【提交状态】累积**五批**未提交：图标重新生成、8 张 HDR 内置、内置切换判断修复、取纹理修复、本次竞态修复。`assets/hdr/` 119.2 MB 仍未被 git 跟踪、建议 `.gitignore`（待用户确认）。
- [2026-10-05 10:37] [工作记录] 跟随 three 上游弃用：RGBELoader → HDRLoader（未提交）：后者只是前者的包装，零风险替换 + 该警告反证链路已通 — model-viewer 跟随 three 上游弃用：`RGBELoader` → `HDRLoader`（**尚未 git 提交**，与前面几批同批）。

【现象】控制台出现 `RGBELoader has been deprecated. Please use HDRLoader instead.`

【根因（读源码确认，零风险替换）】three r180 起 `RGBELoader.js` 只剩一层包装：
```js
import { HDRLoader } from './HDRLoader.js';
// @deprecated, r180
class RGBELoader extends HDRLoader {
  constructor( manager ) { console.warn( 'RGBELoader has been deprecated...' ); super( manager ); }
}
```
即**唯一区别就是那条警告**，换成 `HDRLoader` 行为完全一致。

【改动】`src/core/three/environment.js` 的 `loadEquirectangularTexture`：非 exr 分支改用 `import('three/addons/loaders/HDRLoader.js')` + `new HDRLoader().loadAsync(url)`（.exr 仍走 `EXRLoader`，本轮确认它**未**弃用 —— 它唯一那条 warn 是"跳过未知头部格式"的正常运行时提示）。`src/core/three/lighting.js` 里提到 RGBELoader 的注释同步更新。

【验证】① `node -e "import('three/addons/loaders/HDRLoader.js')"` → 路径可解析、导出 `HDRLoader`（这类动态 import 不会被 build 静态校验，必须单独验）；② 全仓 grep 确认代码中无 `RGBELoader` 残留（仅注释里提及，用于说明替换原因）；③ vitest **520/520（44 文件）**、`pnpm build` 成功。未跑 cargo test（零 Rust 改动）。

【一个有诊断价值的观察】**这条警告此前一直没出现，恰恰是因为内置贴图从未加载成功**（前两轮修的两个 bug 让 HDR 加载器从未被实例化）。所以它现在出现，反过来证明"文件真的读进来、加载器被构造了"——链路已通。（同类信号：某条日志/警告本该出现却没有，通常说明那段代码路径从未执行。）

【提交状态】累积**六批**未提交：图标重新生成、8 张 HDR 内置、内置切换判断修复、取纹理修复、异步竞态修复、本次弃用跟随。`assets/hdr/` 119.2 MB 仍未被 git 跟踪、建议 `.gitignore`（待用户确认）。文档：本轮未单开章节，原因写在代码注释里（§45.7/§45.8 已覆盖前几轮）。
- [2026-10-05 14:32] [工作记录] assets/hdr 已加入 .gitignore（未提交）：根锚定规则只命中它，public/hdr 内置资源仍会入库并已双向验证 — model-viewer 把 `assets/hdr/` 加入 `.gitignore`（**尚未 git 提交**）。

【改动】`.gitignore` 新增一条（第 33 行）：
```
# HDR 全景原始素材 + 缩放中间产物（合计 ~119 MB，体积过大不入库）。
# 注意：应用**内置**的是 public/hdr/ 下那份压缩版（8 张 / 22 MB），**那份必须入库** ——
# 别因为名字相似把它一起忽略掉；本规则以根目录锚定，只命中 assets/hdr/。
assets/hdr/
```
规则写成 `assets/hdr/`（带前导路径 + 结尾斜杠）：锚定仓库根、只匹配目录，因此不会命中 `public/hdr/`。**故意在 .gitignore 里写了那条警示注释** —— 两个名字太像，后人顺手加规则时很容易把内置资源一起忽略掉，而那种错误要到"安装包里没有环境贴图"才会暴露。

【验证（三步，都做了）】
1. `git check-ignore -v assets/hdr/` → `.gitignore:33:assets/hdr/  assets/hdr/`（确认命中，含规则行号）
2. `git check-ignore -v public/hdr/studio-1.hdr` → **无输出、退出码 1** = 未被忽略 ✓（内置资源仍会入库）
3. `git status --short` → 不再出现 `?? assets/hdr/`，而 `?? public/hdr/` 正常出现 ✓

【待提交清单（七项，用户尚未决定是否提交）】① 图标用新源图重新生成（17 个 icons + favicon）；② 8 张 HDR 内置（`public/hdr/` 22.2 MB + `builtinEnvironments.js` + 代码接线）；③ 内置切换判断修复；④ 取纹理修复（`scene.environment` 被设成 null）；⑤ 异步竞态修复（偶发不生效）；⑥ `RGBELoader` → `HDRLoader`；⑦ 本次 `.gitignore`。**注意 `public/hdr/` 的 22.2 MB 必须入库，仓库体积会 +22 MB**（内置方案的固有代价，用户已确认接受）。

【顺带确认】`assets/Icon.png`（图标源图的输入）不在忽略范围、仍会正常入库；它在本批中显示为 `M`（用户换了新图）。

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
- [2026-09-17 08:35] [经验教训] CSS 视觉异常三家族：高度链断裂、flex 子项被压缩、EP 自带外边距与 flex gap 叠加（含各自判断法与修法） — CSS 布局「视觉异常」的三个家族（model-viewer 实测；现象都像"界面不对"，但机制与修法各不相同）：

【A. 百分比高度链断裂 → overflow 根本不触发】
根因：`.el-tabs__content` 给了 `flex:1; min-height:0` 但**漏了给 `.el-tab-pane` 确定高度**，面板里的 `height:100%` 相对于 auto 高度的中间容器**静默退化为 auto**（不报错、不警告），面板自身的 `overflow-y:auto` 永不触发，超出内容被祖先 `overflow:hidden` 裁掉且滚不到。
三层修法一起才稳：1) `.el-tab-pane{height:100%}` 补齐链；2) `.el-tabs__content{overflow-y:auto}` 兜底；3) 面板自身再写与祖先无关的确定高度 `max-height: calc(100vh - 130px)`（顶栏52+状态栏30+标签页头约48）。
判断法：沿 DOM 往上问"这个 overflow:auto 的元素有没有确定高度？高度来自 `height:100%` 还是 flex？"

【B. flex 子项被压缩 + overflow:hidden → 内容被裁】
根因：固定高度 flex 列容器里，子项的自动最小高度（`min-height:auto`）**只在 `overflow:visible` 时生效**，而 `el-card`/`el-alert` 自带 `overflow:hidden` → 子项可被压缩到低于内容高度，被挤掉的部分既看不到也滚不到。**关键鉴别点：这种情况滚动条其实在工作**（与 A 相反）。
修法：容器上写 `.panel > * { flex-shrink: 0 }`，约定"子项永远保持自然高度，溢出只由这一个滚动容器负责"。

【C. Element Plus 组件自带外边距与自定义 flex gap 叠加 → 间距异常（本次新增）】
根因：EP 对相邻按钮自带 `.el-button + .el-button { margin-left: 12px }`；若父容器同时用了 flex `gap`（本例 10px），两者**叠加成 22px**，于是"播放与停止按钮之间"比同一条里其它元素宽出一截。修法：在容器内 `:deep(.el-button + .el-button) { margin-left: 0 }`，让间距只由 gap 一处负责。
**通用提醒**：给 EP 组件的容器设 `gap` 时，先确认该组件自身有没有相邻兄弟的选择器规则（button/checkbox/radio/tag 一类常有），否则会出现"只有某两个元素间距不对"的诡异现象——所以**任何间距都只允许有一个来源**。

【流程教训】这三类都是**纯视觉**问题：构建不报错、单元测试也覆盖不到。缓解：改动中间层布局容器（tabs/collapse/card/scrollbar）或给 EP 组件容器加 gap 时逐一自查上面对应的判断法；M6 可考虑引入截图级冒烟检查（Playwright）。
- [2026-09-17 09:31] [经验教训] 空闲停渲染下"面板命令必须自己唤醒循环"：否则状态已改但无帧渲染，表现为"点了没反应" — 「按需/空闲停渲染」架构下的通用陷阱（model-viewer 实测，用户报"动画片段切换后无法再次播放"）：

【现象与根因】动画控制器单测全绿（切换片段后能再次播放、旧片段不参与混合），但用户点播放毫无反应。真因与动画逻辑无关：**引擎的 activity 监听只挂在 canvas 上**（pointerdown/pointermove/wheel/keydown…），而侧栏面板里的点击根本不经过 canvas。渲染循环一旦因空闲停掉，从面板发出的命令只改了状态、**没有任何一帧被渲染**，于是"状态对了但画面不动"。之所以总是出现在"切换片段之后"：切换片段本身就是侧栏点击，之后循环进入空闲。

【修法】让"命令式状态变更"与"唤醒渲染"绑定在一起：引擎里所有对外命令的最后一步都要 noteActivity()（本项目是 `emitAnimationState()` 统一回写状态，因此一处改动覆盖 play/pause/stop/seek/选片段/倍速/循环模式）。审计方法是逐个公开方法看它是否（直接或经由 fitToObject/applyVisibilityNow/handleResize）最终调用 noteActivity。

【可复用规则】只要渲染循环会因为"长时间无操作"而停下，就必须明确"哪些入口会唤醒它"。canvas 上的原生事件只覆盖鼠标在 3D 区域内的操作；**所有来自 UI 面板的命令路径都必须自己唤醒循环**，否则会出现一类非常难查的"点了没反应"（状态、日志、单测全部正常，只是没人渲染）。新增引擎命令时把这条当检查项。

【排障手法】先用**回归单测证明模块本身无缺陷**（本次新增 3 例把动画控制器排除嫌疑），把问题从"逻辑层"挤到"接线层"，比继续读业务代码高效得多。
- [2026-09-17 09:48] [经验教训] three 的 action.stop() 会停用 action：再播放必须重新 play()（且"回到第 0 帧"也依赖它） — three.js `AnimationAction` 的两个易踩语义（model-viewer M4 实测，用户报"播放→停止→再播放无响应"）：

1) **`action.stop()` 会停用 action，不只是清零时间**：内部调用 `mixer._deactivateAction()` 把它从 mixer 的**活动列表**移除；此后 `mixer.update()` 根本不再遍历它。所以"停止后再播放"若只把 `paused` 改回 false 是**完全无效**的——必须显式再调 `action.play()` 重新激活（对已激活的 action 是幂等的，可以每次播放都调）。本项目 AnimationController.play() 里就缺这一句，导致"停止后无法再次播放"。

2) **同一个原因还会让"停止 = 回到第 0 帧"落空**：action 被停用后不再参与属性混合，即使把 `time` 设为 0、再 `mixer.update(0)`，姿势也不会被应用（画面停在上一帧或绑定姿势）。正确做法是 `stop()` 之后 `enabled=true; paused=true; time=0; play()` —— 既回到起点又保持暂停。

3) 测试盲区：我此前的用例只断言了"停止后 time==0 且 playing==false"（**只查时间不查姿势**），所以这两处都被漏过；而"切换片段后播放"的路径之所以正常，是因为 selectClip 里调了 `action.play()`。补的回归用例同时断言**位置数值**（播到 0.6s 时 x≈6 → 停止后 x≈0 → 再播放 0.5s 后 x≈5），这类"数值 + 状态"双重断言才拦得住。

**适用范围**：直接操作 three 的 AnimationAction 时都适用；用 `mixer.clipAction()` 得到的 action 一旦被 stop/disable，就必须重新 play 才会重新被更新。
- [2026-09-17 11:11] [经验教训] MTLLoader 会把绝对贴图路径拼在 baseUrl 后面，setURLModifier 收到的是拼接后的串 — model-viewer M6-3 实测（three r185）：想让 MTL 里 `map_Kd C:\tex\a.png` / `file:///E:/a.png` 这类绝对本地路径生效，光给 LoadingManager.setURLModifier + convertFileSrc 转换器是**不够**的。

【根因】MTLLoader 自带的 resolveURL 只把 `http(s)://` 当绝对地址（源码里就一句 `/^https?:\/\//i.test(url)`），其余一律 `baseUrl + url`。于是到达 URL 修饰器的字符串已经是 `asset://localhost/E%3A%5Cmodels%5CC:\tex\a.png`，只判断"整串是不是绝对路径"的 extractLocalPath 直接返回 null → 静默不改写 → 贴图缺失（会在信息面板列成缺失资源）。

【解法】formatLoaders.js 新增 extractEmbeddedLocalPath：在被拼过前缀的请求里**取最后一个** `X:\`/`X:/` 候选（前面的盘符属于 baseUrl 自身）后切出来再判定。顺序必须是 assetMap → extractLocalPath → extractEmbeddedLocalPath。

【踩坑（判 scheme 的正确判据）】不能用"候选前面是不是字母"来排除 `http://` 里的 `p:/`：编码后的 `%5C`（encodeURIComponent('\')）以字母 C 结尾，会把合法的 `...%5CC:\tex\a.png` 误杀（实测三个用例一起红）。正确判据是 **`X:` 之后是否紧跟第二个分隔符**——`http://`(`p:/`)、`asset://`(`t:/`)、`file:///`(`e:/`) 命中被跳过，`C:\`/`C:/` 不会。另注意 convertFileSrc 会把冒号编码成 `%3A`，所以正常 asset URL 里不会出现字面盘符，纯相对引用能安全放行（draco/basis 解码器的 http URL 也不会被误改）。

【更一般的教训】纯函数全绿 ≠ 功能可用：上一轮只单测了 extractLocalPath/normalizeReferenceUrl 就记为"只差接线"，实际接线后才发现缺一层判定。接线类改动应当直接测**真实接线点**（这里测 `createLoadingManager(...).resolveURL(拼接后的串)`，即 three 各 loader 请求外部资源时走的那一步），而不是只测纯函数。
- [2026-09-17 11:26] [经验教训] 截图导出两坑：WebGL 读取必须与渲染同任务；Tauri capability 漏 dialog:allow-save 只在运行时炸 — model-viewer M6-4（截图导出）踩到的两处，都属于"测试全绿但功能不可用"的类型：

【1. WebGL 截图必须"渲染 + 读取"在同一同步任务里】引擎的 WebGLRenderer 没开 `preserveDrawingBuffer`（开了会常驻一份额外绘制缓冲）。浏览器可能在合成之后清空绘制缓冲区，所以正确顺序是：**先同步 `renderFrame()` + `canvas.toDataURL()`，拿到 data URL 之后再去弹"另存为"对话框**；反过来（等用户选完路径再截）很可能拿到一张空图。另外提分辨率不要另写离屏 RenderTarget 读取，直接临时调高 `renderer.setPixelRatio` + `postFx.setSize` 再重渲一帧，后处理（EffectComposer）就会一起按新尺寸出图，避免直渲/后处理两条路径截图不一致；记得恢复像素比并立刻重绘，否则画布停在导出分辨率上。上限要给（单边 ≤8192，超过显卡 MAX_TEXTURE_SIZE 直接渲染失败），下限也不能低于当前显示像素比。

【2. Tauri 插件的 capability 是"漏了就只在运行时失败"】用了 `@tauri-apps/plugin-dialog` 的 `save()` 就必须在 `src-tauri/capabilities/default.json` 里加 `dialog:allow-save`（原来只有 `dialog:allow-open`）。前端单测、`pnpm build` 都不会报错，只有真机点按钮才被 ACL 拒绝。**同类教训：新增任何 `@tauri-apps/plugin-*` API 调用后，先回 capabilities 清单确认权限，并用 `cargo test`/`cargo build` 跑一遍让 tauri-build 校验 capability 与插件 ACL 是否匹配。**

【Rust 侧小坑】`fn 测试名()` 里带空格不是合法标识符（中文名不带空格可以）；写盘类命令把约束收在命令内部并把纯逻辑拆出来单测（base64 解码、PNG 魔数、路径校验、端到端写临时目录）比给 fs 插件开口子更划算。
- [2026-09-17 14:12] [经验教训] Tauri SQL 插件的 ~ 展开依赖 HOME：Windows 无 HOME → 启动即 panic（已用删 preload 修复） — model-viewer 实测：`pnpm tauri dev` 启动即崩，报
`HOME 环境变量不存在: NotPresent` → `model-viewer.exe (exit code: 101)`。

【根因（读到依赖源码才定位）】`tauri.conf.json` 的 `plugins.sql.preload` 写的是 `sqlite:~/.model-viewer/app/app.db`。本项目用的 SQL 插件（社区 fork `tuyu79/plugins-workspace#v2-sql-default`）里：
```rust
fn expand_tilde(path: &str) -> String { ... let home = env::var("HOME").expect("HOME 环境变量不存在"); ... }
```
而 `expand_tilde` **只被 preload 这条路径调用**（`lib.rs` 里 `for db in config.preload { let db = expand_tilde(&db); ... }`），`Database.load` / `execute` 等命令**不调用**它。Windows 默认不设 HOME（只有 USERPROFILE），所以"启动时预加载数据库"这一步直接 panic。**此前一直能跑通只是碰巧在设了 HOME 的终端里跑（Git Bash / 部分 IDE 终端会设）。**

【修复：删掉 preload（本项目不需要）】两处代码核对确认冗余：① 建库——插件 `DbPool::connect` 对 sqlite 会 `database_exists` → 不存在则 `create_database`，不需要预加载（目录由 Rust 启动时创建）；② 迁移——`add_migrations(db_url)` 按 **URL 字符串**注册，`Database.load(db)` 里 `migrations.remove(&db)` 命中即执行，前端 `join(await homeDir(), '.model-viewer','app','app.db')` 拼出的绝对路径与 Rust 注册键完全一致，而 preload 用 `~` 展开出来的是**混用分隔符**的另一串（`…\.model-viewer/app/app.db`）——也就是说迁移一直靠 `Database.load` 生效，删 preload 不会丢迁移。

【护栏与验证】`paths.rs` 加单测用 `include_str!("../tauri.conf.json")` 断言配置里不出现 `~`（注释写明原因）；`cargo test` 48/48；`cargo build` 后直接在**同样没有 HOME** 的环境启动 `target/debug/model-viewer.exe`，进程存活无 panic（修复前该二进制在插件初始化阶段即退出）。

【两条通用教训】① **Windows 上不要依赖 HOME**：任何 `~` 展开、`env::var("HOME")` 都会在默认环境炸；路径统一走 `dirs::home_dir()`（Windows 用已知文件夹 API）或 `USERPROFILE` 兜底。② 排查"启动即 panic"先看 panic 消息属于谁：本项目自己的代码都用 `CODE: 详情` 形式的 Result（不 panic），**出现中英混杂的 `.expect()` 文案基本就是第三方依赖**，去 `CARGO_HOME/git/checkouts|registry` 里搜那句话能立刻定位。
- [2026-09-17 14:19] [经验教训] 锁死的应用外壳里如何做"整页滚动"：自己当滚动容器 + 关 el-main 的 overflow:auto + 禁止卡片 flex 收缩 — model-viewer 设置页"卡片内容有滚动条"的修复（commit a39cfbb，用户报的 BUG）。

【根因是外壳布局链，不是卡片本身】`src/style.css` 里 `html, body { height:100%; overflow:hidden }`、`#app { width:100vw; height:100vh; overflow:hidden }` —— 外壳是**故意锁死的固定视口**（3D 视口需要它）。于是任何"内容可能超高的页面"只能靠 Element Plus `el-main` 默认的 `overflow:auto` 在内部滚动，出现嵌套滚动条；同时 `el-main` 是 `flex:1` 的 flex 子项、卡片默认 `flex-shrink:1`，内容会被压扁/裁切（本项目历史上"布局静默裁切"的同一类问题，M5 也踩过）。

【修法（只改设置页，不动外壳与查看器）】
- `.settings { overflow-y: auto }`：让页面自己当整页滚动容器（`height:100vh` 保留），头部与卡片一起滚；
- `el-main.settings__main { flex: 1 0 auto; overflow: visible }`：**选择器必须带 `el-main` 元素限定**，否则单类选择器与 EP 的 `.el-main` 同权重、谁赢取决于打包顺序；
- `.settings__card { flex-shrink: 0 }`：卡片只按内容撑高。
结论：**在锁死的外壳里做"整页滚动"，要自己指定滚动容器 + 关掉内层 `overflow:auto` + 禁止 flex 收缩，三者缺一不可。**

【验证方式（无浏览器时可用）】`pnpm build` 后直接在产物里断言规则，注意**设置页是懒加载路由，它的 scoped CSS 落在独立 chunk**（`dist/assets/Settings-*.css`，与 Element Plus 的基础 CSS `index-*.css` 不同文件），只搜第一个 CSS 文件会误判"规则不存在"；正确做法是遍历 `dist/assets/*.css` 找到含 `settings__main` 的那个，确认 `el-main.settings__main[data-v-…]` 带元素限定、且该 chunk 在主包 CSS 之后加载。

【未决】头部（← 返回查看器）目前随页面滚走；已向用户提议可改 sticky，等其确认后再动。
- [2026-09-17 15:04] [经验教训] 相机补间接入空闲停渲染循环的六个必须点（唤醒循环、计入持续工作、先补间后 controls.update、清帧基准、打断源全、默认不动画） — model-viewer 实现"视角切换平滑过渡"时，把相机补间接进**空闲停渲染**循环的六个必须点（commit 29bc806，`core/three/cameraTween.js` + ViewerEngine 接线，vitest 397/397）。

1. **必须自己唤醒循环**：视角由面板/快捷键触发时循环往往已因空闲停掉（本项目老坑），`animateCameraTo` 里 `noteActivity()` 是功能可用性的关键，不是可选项。
2. **补间状态要计入持续工作**：`idlePolicy.hasContinuousWork` 增加 `cameraMoving`，否则 `idleMs` 一到就把动画停半路（只靠 `noteActivity` 的活动窗口不够，idleMs 设为 0 时立刻失效）。
3. **帧内顺序：先推进补间、再 `controls.update()`**。补间直接写 `camera.position` / `controls.target`；OrbitControls 每帧从"当前位置 − target"重算球坐标，阻尼增量为 0 时不覆盖写入值；反过来写会被 controls 抹掉。另外**瞬态挂起 `autoRotate`**（只在 `controls.update()` 那一瞬置 false 再还原）——两者都在改相机，否则"到不了目标视角"且不覆盖用户的转盘开关。
4. **清 `lastFrameTime` 再起补间**：从空闲唤醒时首帧 delta 被夹到 `MAX_FRAME_DELTA`（100ms），对 320ms 的补间等于"起步跳掉 1/3"，看起来像卡了一下。
5. **打断源要全**：OrbitControls 的 `start` 事件（用户一按鼠标就接手）、连续切换（后一段覆盖前一段）、`setModel`（旧终点已失效）、`dispose`（**直接 `cancel` 而不是 `cancelCameraTween`**，后者会 noteActivity 在销毁路径上重新排帧）。
6. **只有"用户主动换视角"才动画**：`fitToObject` 的 `animate` 默认 false，加载模型/重新摆放/尺寸变化必须立刻到位，否则看到"模型飞进来"。

附带设计取舍：补间逻辑放在**不依赖 three 的独立模块**（只用 `[x,y,z]` 与毫秒），因为打断源有三个、状态机边界多（起点等于终点不动画、时长下限夹取、delta 为负不倒退、NaN 位姿退化为瞬时），只有这样才能在 Node 下完整单测；`prefers-reduced-motion: reduce` 时直接瞬时落位。
- [2026-09-17 16:05] [经验教训] 换应用图标的四个坑：public/ 会进安装包、NSIS 装包图标要单独配、图标改动不触发重编译、tauri icon 会连移动端一起生成 — model-viewer 换应用图标（commit c9e5af1，源图 `assets/Icon.png` 2048×2048 透明背景）踩到的四点，都是"不看产物就发现不了"的类型。

1. **`public/*` 会被原样复制进 `dist`，而 `dist` 会被打进安装包**。源图最初放在 `public/Icon.png`（1.5 MB），实测安装包 5.72 MB；移到 `assets/` 后降到 4.3 MB。**图标源图、设计稿这类只在开发期用的大文件一律不要放 `public/`**（放 `assets/` 或 `src-tauri/icons/`）。
2. **NSIS 安装包图标要单独配**：`bundle.windows.nsis.installerIcon` / `uninstallerIcon = icons/icon.ico`。不配时安装包用的是 **NSIS 自带图标**（不是自己的）—— 我一开始只改了 `bundle.icon`，从装包里提取图标才发现是那个绿色下载图标。
3. **改图标后 `cargo build` 不会自动重编译**：`tauri-build` 没为图标文件注册 `rerun-if-changed`，会打印 "Finished in 0.3s" 而资源仍是旧的；需要 `touch build.rs`（或 `cargo clean -p model-viewer`）强制重建。dev 窗口图标来自 exe 资源，**必须重启 `pnpm tauri dev`** 才更新。
4. **`tauri icon` 默认连移动端图标一起生成**：`src-tauri/icons/android/` + `ios/` 合计 870 KB，桌面项目直接删掉即可（需要时重新生成）。

【验证手法（无 GUI 也能做，值得复用）】用 .NET 从**构建产物**里把图标抠出来再肉眼比对：
```powershell
Add-Type -AssemblyName System.Drawing
$i = [System.Drawing.Icon]::ExtractAssociatedIcon("src-tauri\target\release\bundle\nsis\三维模型查看器_0.1.0_x64-setup.exe")
$i.ToBitmap().Save("installer-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
```
对 debug exe 与 NSIS 安装包分别做，两者都应是自己图标。另可用 `GetPixel` 抽样确认源图是否真透明（本例 73.7% 像素透明，所以任务栏里是异形图标而不是白方块）。
- [2026-09-18 08:56] [经验教训] 入场动画的实现要点：起点由终点推导、端点直接赋值（1ULP）、唤醒+清帧收在一处、瞬时适配保留、夹取下限别卡掉退化情形 — model-viewer 实现"模型加载完成入场动画"（commit 529e5e3，相机从更远略高处推入，650ms）的可复用要点：

1. **入场起点只由终点推导**（沿同一视线推远 1.9×、抬高 `距离×0.12`），与"上一个相机停在哪"无关 → 每次加载表现一致、可纯函数单测。改造前本来就是瞬跳到适配位姿，"跳到更远处再滑进来"不是回退。
2. **端点必须直接赋值，不要走 lerp**：`a + (b - a) * 1` 在 IEEE754 下可能差 1ULP，而"补间终点与适配位姿**完全一致**"是硬要求（否则连续切视角留极小漂移、几何体错位）。做法：`sampleCameraTween` 在 progress 0/1 时直接返回端点副本。
3. **把"唤醒循环 + 清帧时间基准"收在同一个 helper 里**（`startCameraTween`）：这是补间能播的两个前提，分散写迟早漏一处（本项目历史上"命令改了状态但没有帧渲染"就是这个坑）。`animateCameraTo` 与入场共用它。
4. **瞬时适配必须保留**：先 `setModel(fit:true)` 把相机摆正、再播入场。这样动画被跳过时（系统「减少动效」/位姿不可用/引擎销毁）相机依旧正确取景，不会出现"半个动画或错误取景"。
5. **动画触发时机要晚于状态就绪**：放在 `model.setReady()` 之后而不是 `setModel` 内部——`setModel` 之后还有统计与状态回写，当时就起动画会被加载遮罩挡掉开头一段。
6. **夹取下限别把"退化情形"卡掉**：`ENTRANCE_FACTOR_RANGE.min` 一开始写 1.05，导致文档里承诺的 `factor=1 && lift=0 → 与终点完全相同`（进而"不动画"）永远走不到，被单测当场抓住；下限改成 1 后既保留"只抬高不推远"的合法组合，也与退化情形相接。**凡是有"关闭/退化"组合的参数，夹取区间必须容纳该组合。**

【只动相机、不做模型缩放/淡入的理由】`ModelPlacement` 只管位置、`ModelOrientation` 只管姿态，`root.scale` 虽然空着，但缩放会让 CSS2D 的尺寸标注与模型错位；按材质淡入又要与 `ShadeController` 的材质克隆、线框/顶点色模式纠缠。相机移动对 CSS2D 完全安全（每帧按相机投影）。
- [2026-09-18 09:49] [经验教训] 两个侧栏布局坑：el-slider 按钮热区在 100% 处溢出 18px（全局 padding 修）；flex 行需 flex:1+min-width:0 才能收窄并右对齐 — model-viewer 两个侧栏布局 BUG 的根因与修法（commit fc9bea4，均可复用）：

【1. Element Plus 滑块在最大值处向右溢出 18px → 窄容器出现横向滚动条】
`.el-slider__button-wrapper` 是 **36×36 的绝对定位方块**（`--el-slider-button-wrapper-size: 36px`），居中压在 0%/100% 上：拖到最大时它的一半（18px）落到跑道之外；跑道是 `.el-slider__runway{flex:1}` 铺满内容宽度 → 在侧栏这类窄容器里就撑出横向滚动条（与"提示气泡是否显示"无关）。
**修法（全局一条，一次覆盖所有面板）**：`src/style.css` 加
```css
.el-slider:not(.is-vertical) { padding: 0 20px; }   /* 18px 热区 + 2px 余量防子像素舍入 */
```
竖直模式的热区在纵向（`.el-slider.is-vertical`），所以要排除。
**排查要点**：滑块的提示气泡是 `el-tooltip` 渲染并**传送到 body** 的，不参与溢出计算 —— 别把它当成嫌疑对象。

【2. flex 行里内容过长会把尾部按钮挤出视野（看起来"没右对齐"）】
层级树节点行原来写 `width: 100%`，而 flex 子项默认 `min-width: auto` 不允许收窄到内容宽度以下 → 长名字把整行撑宽，容器 `overflow: auto` 于是横向滚动，右侧的操作按钮被推到视野外。
**修法（canonical）**：行 `flex: 1; min-width: 0`；会变长的标签 `flex: 1 1 auto; min-width: 0` + `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`；尾部操作区 `flex-shrink: 0` + `margin-left: auto`（原有）。

【过程教训】我凭记忆认定"显示面板里的滑块写死了 320px 会溢出"，实际 grep 后发现那两处在**设置页**（960px 宽，不溢出），显示面板根本没有固定宽度滑块 —— **布局值属于易记错的事实，动手前先 grep/读文件核对，别按记忆改。**

【验证手法】改 CSS 时在产物里断言：`pnpm build` 后遍历 `dist/assets/*.css`（主包与懒加载 chunk 分开），用正则确认规则真的写进去了、且带 `[data-v-...]` 或不带（全局 vs scoped）。
- [2026-09-18 14:39] [经验教训] CSS2D 标签不继承父级 visible；gizmo 用 sizeAttenuation:false + depthTest:false，方向线取真实 target；只读策略是逐次判定需先请用户放宽 — model-viewer 实现"光源可视化"时确认的两处可复用结论（commit edd7a66，`core/three/lightGizmos.js`）：

【1. CSS2DRenderer 只看对象自身的 `visible`，不继承父级】
把一组 CSS2D 标签挂在一个 Group 下，然后 `group.visible = false` —— **标签仍然会显示**。`setVisible()` 必须遍历标签逐个设置 `visible`（`boundingBox.js` 的 `BoundingBoxOverlay.setVisible` 当初就是这么写的，原因在此）。凡是给 CSS2D 标签做开关，都要照这个模式。

【2. 3D 辅助示意（gizmo）的稳妥画法】
- 标记点用 `sizeAttenuation: false` 的 `Points`：**屏幕像素大小恒定**，模型 1 单位还是 1000 单位、相机拉多远都看得清；"按世界尺寸画球"在超大/超小模型上会大到挡画面或小到看不见。
- `depthTest: false` + 较高 `renderOrder`：辅助标记不是几何体，被模型包住时（大模型下光源常落在模型内部）也必须可见。
- 多个标记点合成**一个 Points**（顶点色区分），一次 draw call；`update()` 只就地改属性、不重建对象 —— 光照面板拖滑杆是高频调用。
- 方向线的终点要取**真实朝向目标**：`DirectionalLight.target` 默认在原点且本项目没改过，所以线指向原点才与实际打光一致（指向"模型中心"是错的，因为模型被摆放成底部贴地后几何中心并不在原点）。
- 关闭/失效的对象**也要画出来**（灰色 + 文案标注），否则用户无法回答"它本来在哪、是不是关着"。
- 标签位置用 CSS2DObject.center（元素尺寸的比例）偏移，而不是在世界坐标里加固定偏移 —— 后者在缩放时会与标记点分家。

【3. 顺手记录的环境事实】DSH 的只读文件策略是**逐次判定**的：每次写文件都要单独 `sandbox_permissions` 升级 + 一次授权弹窗，"一次批准"不会让后续写操作放行。改动涉及十几个文件时，正确做法是先请用户把会话策略切到 workspace-write，而不是让对方点十几次同意。
- [2026-09-21 14:44] [经验教训] three 的 FBXLoader 能力矩阵与"静默降级"：单位只存不用、PBR 变纯黑、<7000 直接抛错、其余只 warn；用 try/finally 接管 console.warn 把它们变成界面提示 — model-viewer 做 FBX 兼容性改进时查清的上游事实与手法（commit 8408ad8，three r185）：

【1. three 的 FBXLoader 能力矩阵（读源码确认，别再凭印象）】
- **Z-up 自动纠正**：`UpAxis === 2` 时 loader 自己 `sceneGraph.rotation.set(-π/2,0,0)` —— 但**只认取值 2**；`UpAxisSign = -1`、X-up(X=0) 都不处理。
- **ASCII 与二进制 FBX 都支持**；**嵌入贴图支持**（读 `Video.Content` 的 ArrayBuffer/base64）。
- **单位只存不用**：`addGlobalSceneSettings()` 把 `UnitScaleFactor` 写到 `sceneGraph.userData.unitScaleFactor`，既不缩放也不告知；而且 `parseScene` 中途会把"只有一个分组"的场景 **unwrap 一层**，所以读这个字段要做浅层兜底（根找不到就看直接子节点）。
- **版本硬门槛**：`FileVersion < 7000`（FBX 6.x）直接 `throw`。
- **材质只支持 Lambert/Phong**；PBR(Stingray) 解析失败表现为**纯黑**（不是报错）。
- 其余降级**只 `console.warn`**：不支持的贴图通道、多层贴图只留第一层、一个骨骼挂多个几何体、图片格式不支持。**"兼容性差"的体感主要来自这种静默降级，而不是打不开。**

【2. 把 loader 的静默降级变成界面提示（手法）】加载期间临时替换 `console.warn`，把带 `THREE.FBXLoader`/`FBXLoader` 前缀的告警收集、翻译、去重限流后走应用的 warnings 通道；非前缀日志透传。**必须用 `try/finally` 还原 `console.warn`（成功与抛错都要），并写单测锁住"抛错后 console.warn 仍是原函数"** —— 否则全局日志被永久劫持。这是唯一可行办法：这些降级既不返回也不抛错。

【3. 测试里踩到的小坑】`new Mesh()` **一定带一个白色默认材质**（three 构造器的默认参数），所以"没有材质"的用例必须显式 `mesh.material = null`；否则断言会莫名少一条。另外导入常量时注意 `CLAY_COLOR` 来自 `materialNormalizer.js` 而非新模块。

【4. 仍未做的 FBX 坑（下次要继续从这里开始）】① 上轴：`UpAxisSign = -1` / X-up 不处理；且**loader 已自动转 Z-up 后，用户在「模型轴向」再手动选「按 Z-up 处理」会反向躺倒**（手动模式语义需要相对"是否已转过"计算）；② 动画：three 只认标准 `AnimStack → AnimLayer → AnimCurveNode`，缺失时本应用无任何提示，需要"加载诊断摘要"（版本/编码/蒙皮网格数/动画源节点数）来定位。
- [2026-09-21 15:34] [经验教训] 模板用 store 必须 import + 顶层实例化；diagnose-sfc 原先抓不到"未声明的名字"（15/15 全绿仍崩），已补检查并用修复前文件验证能抓到 — model-viewer 修掉一个我自己上一轮引入的线上级 BUG，结论对以后每次"给模板加新数据源"都适用（commit 0115ac8）：

【现象与根因】启动即报 `LightingPanel.vue: Cannot read properties of undefined (reading 'showLightGizmos')`。原因是给光照面板加「在视口中显示光源」开关时，**只写了 `import { useDisplayStore }`，忘了写 `const display = useDisplayStore()`**。`<script setup>` 里没有这个顶层声明，模板里的 `display` 就退化成实例属性访问 → 渲染时读到 `undefined`。
**规则：模板里要用一个 store/组合式结果，必须同时做两件事 —— import + 在 setup 顶层实例化。只 import 不会报错，编译期一切正常。**

【关键：项目自带的诊断工具原本抓不到这类错误】`scripts/diagnose-sfc.cjs` 的判定是"把 `compileTemplate` 里的 `_ctx.<name>` 与 `compileScript` 的绑定集合取交集"，也就是**只查"已声明却退化成实例访问"**；对"模板引用了**根本没声明**的名字"完全无感 —— 所以它当时给我报了 **15/15 全绿，而程序一启动就崩**。现已扩展：`_ctx.<name>` 若既不是绑定、也不在允许列表（Vue 内置 `$slots/$attrs/$props/...` 与 JS 全局 Math/Date/JSON/...）里，就报"模板引用了未声明的名字（构建不报错，渲染时才是 undefined）"。
**含义：diagnose-sfc 的"全绿"现在才真正覆盖了这两类模板/脚本不一致；以后新增模板数据源时它是有用的把关，但仍测不到逻辑错误（它只是编译器级静态检查）。**

【验证手法（值得复用）】证明"新增的检查真的能抓到"：用 `git show HEAD:<path> > $env:TEMP\x.vue` 把**修复前**那份文件取出来，再对临时文件跑一次诊断，确认它精确报出 `display`；同时跑全量确认 15 个组件无误报。**改检查规则时既要验证"能抓到坏样本"，也要验证"不误报好样本"。**
- [2026-09-21 17:45] [经验教训] three 性能四事实：light.visible 触发全材质重编译／EffectComposer.resize 重建 RT／恒等 pass 白跑／解码器 dispose 销毁 worker 池 — model-viewer 做渲染性能优化时读 three r185 源码确认的四个可复用事实（都带文件行号，别再凭印象）：

【1】改 `light.visible` 会让**所有材质重新编译 shader**。
证据链：`WebGLRenderer.projectObject` L1833 `if (object.visible === false) return`（不可见对象不进 renderList，光源也不进）→ `WebGLLights.setup` L277/303 按进入顺序填 `state.directional[]` → `WebGLPrograms` L338 `numDirLights: lights.directional.length`，L472 把它打进 `getProgramCacheKey`。
⇒ 拨一次光源开关 = program key 变化 = 全模型重编译（材质越多越卡）。
**正确做法：关闭光源用 `intensity = 0`，`visible` 恒为 true。** 视觉等价（`WebGLLights` L281 `uniforms.color.copy(light.color).multiplyScalar(light.intensity)` → color 被乘成 0），且 L268-305 对 intensity 无跳过逻辑，数量恒定。同理 `scene.environment` 在 null↔texture 间切换也改 program key。

【2】`EffectComposer.setSize` 会**销毁并重建** render target。
`EffectComposer.setSize` L317-334 → `renderTarget1/2.setSize` → `RenderTarget.setSize` L297 `if (尺寸变了) { ...; this.dispose() }` L321（释放 GPU 纹理，下一帧重新分配）。
⇒ ResizeObserver 若不去抖，拖窗口边框时**每个尺寸事件**都重建 2 个 render target（HalfFloat + 4×MSAA 下极贵）。
另注：`composer.setPixelRatio()` 内部自己会调一次 `setSize`（L342-347），紧接着再显式 `setSize` 是冗余的。

【3】默认参数下**白跑一趟恒等全屏 pass**。`mix(vec3(luma), texel.rgb, 1.0)` ≡ 原色，但 saturation=1 是默认值。用 `ShaderPass.enabled = false` 跳过（保留对象，值回到非 1 时立即恢复，无需重建 composer）。

【4】`DRACOLoader.dispose()` / `KTX2Loader.dispose()` 会**销毁 worker 池**。原来在每次加载的 finally 里 dispose，导致每打开一个模型都重新 spawn worker + 实例化 WASM。解码器应做成应用级共享（惰性单例），只在引擎销毁时释放。
**写这个缓存的两个坑**：① 并发调用会让 `if (!cache) { await ...; cache = ... }` 各建一组 → 必须共享同一个创建中的 Promise；② 共享实例只能绑一个 LoadingManager，硬绑会出现“第二次加载收到第一次的进度回调”的串扰。
- [2026-09-21 17:45] [经验教训] 本沙箱下 vitest/vite 必然 EPERM 需要 danger-full-access；diagnose-sfc 与文件读写可直接跑 — 在 DSH 受限沙箱下跑 model-viewer 的验证命令时的可复用结论（本会话实测）：

**会 EPERM 的（必须升级到 danger-full-access 才能跑）**：
- `pnpm test` / `pnpm exec vitest run ...`：vite 加载 config 时 esbuild 要 spawn 子进程服务（named pipe）→ `spawn EPERM`，errno -4048。
- `pnpm build`：vite 在 Windows 上用 `child_process.exec` 解析真实路径（`windowsSafeRealPathSync` → `optimizeSafeRealPathSync`）→ 同样 `spawn EPERM`。
- 关键：**workspace-write 也拦不住这个** —— 文件策略放宽到 workspace-write 后，命名管道限制依旧（两种 confined mode 都禁），所以这两条命令必须走 `danger-full-access`。

**能直接跑的（无需升级）**：
- `node scripts/diagnose-sfc.cjs`（纯文本分析的 SFC 诊断，15 组件）
- 文件读写（workspace 内）在 workspace-write 下正常。

**操作要点**：同一会话内首次被拒后，后续同类命令可以直接 upfront 申请 danger-full-access（提示允许“本会话已拒绝过同一访问”时前置升级）；被拒的第一次不要换写法绕，直接原命令 + `sandbox_permissions` 重试。

**回归三件套**（本项目当前基线）：`pnpm test`（463/463，41 文件）+ `node scripts/diagnose-sfc.cjs`（15/15）+ `pnpm build`。零 Rust 改动时可不跑 `cargo test`。
- [2026-09-21 18:05] [经验教训] 后处理与阴影六条：castShadow 也改 program key／通道一次性建好只切 enabled／世界尺度参数／线性空间能做与不能做／冒烟测试必抓 API 误用／不动 light.target — model-viewer 做后处理/阴影时确认的 six 条可复用结论（都读过 three r185 源码或实测）：

【1】`castShadow` 开关同样会触发全材质重编译。program cache key 里除了 `numDirLights` 还有 **`numDirLightShadows`**（`WebGLPrograms.js` 取 `lights.directionalShadowMap.length`）。所以"关阴影"用一个 `if` 是省不掉的（除非像光源那样用 `shadow.intensity = 0`）。**但每帧重渲 shadow map 是可以省掉的**：`renderer.shadowMap.autoUpdate = false` + 只在内容真变化时置 `needsUpdate = true`。查看器里相机移动**不影响影子**，所以静态查看时 shadow map 开销为零。脏标记要挂在：模型加载/可见性/摆放/轴向/光源/动画帧。

【2】通道化后处理的两个关键设计。① **所有通道在 composer 创建时一次性建好，之后只切 `pass.enabled`** —— 动态增删 pass 会逼你在"开关效果"时重建 render target（每帧级别的大开销）；未启用的 pass 不产生 GPU 时间。② 用 `isIdentity(settings, pass)` 统一声明"当前参数下这一趟等于没做"（饱和度=1、AO 强度 0、泛光 0、描边没选中），比在每个通道里手写 `pass.enabled` 干净，且把"恒等跳过"这个优化变成了管线级保证。

【3】后处理参数里的**世界尺度陷阱**。GTAOPass 的 `radius`、BokehPass 的 `focus` 都是**世界单位**，写死会"换个模型就失效"（同一个 0.5 对 1cm 零件和 100m 建筑完全不是一回事）。做法：设置里存**相对比例**，由引擎按包围球半径/相机距离写入运行时字段（`sceneRadius`/`focusDistance`），并在持久化时用"只存 UI 可调项"的规则把这些运行时字段排除掉。

【4】线性空间 vs 显示空间。后处理链在 OutputPass **之前**，工作在线性（HDR）空间。在这里做以下操作是**正确**的：通道增益（色温）、乘法衰减（暗角）、泛光（光晕本就发生在 HDR 亮度上）。而**对比度是显示空间的非线性操作**（以 0.5 中灰为中心拉伸），放线性空间会得到"曝光式"结果，与用户预期不符 —— 宁可不做也别做错。

【5】通道文件必须有"真实构造一次"的冒烟测试。只测管线组装抓不到 three API 用错。做法：用真实的 `new Scene()` + `new PerspectiveCamera()`（Node 下可创建），逐个 `create → setSize → dispose`，只跳过需要 GPU 的渲染。**这次立刻抓到真问题**：测试最初把空对象当 camera 传给 GTAOPass，`setSize` 里 `Matrix4.copy(camera.projectionMatrix)` 直接炸。

【6】`fitShadowCamera` 刻意**不动 `light.target`**：方向光的 target 决定光照方向，把靶心挪到模型中心等于悄悄改了打光（项目定位是忠实呈现，不该有这种意外变化）。代价是视锥要以原点为中心去覆盖"偏心的包围球"，所以正交范围要把球心偏离原点的量算进去（`extent = (radius + |center|) * 1.1`）。接收阴影用 `ShadowMaterial` 平面（只显示阴影、自身透明），不必真往场景摆地板。
- [2026-09-21 18:11] [经验教训] three 阴影必须两侧都开（Object3D.castShadow 默认 false）；且"只在变化时同步"会漏掉首次应用 — model-viewer 实测"模型没有阴影"，两个独立根因叠加（任何一个都足以让画面一片影子都没有）。两条都是可复用的踩坑结论：

【根因 1】**three 的阴影是"两侧都要开"的**。`Object3D.castShadow` / `receiveShadow` **默认都是 `false`**，所以：
- 只配光源 `light.castShadow = true` 而模型网格没开 → **完全没有影子，且没有任何报错或警告**；
- 反过来只开模型也没用。
正确做法：模型加载后 `root.traverse(node => { if (node.isMesh || node.isSkinnedMesh) { node.castShadow = true; node.receiveShadow = true } })`（点云/线框覆盖层不该参与）。本项目当时只配了光源侧。
**护栏**：抽成纯函数 `enableModelShadows(root)` 可单测；测试里**先断言 three 的默认值是 false**，再验证被打开 —— 那条断言本身就是"为什么必须显式打开"的文档。

【根因 2】**"只在变化时同步"的写法会漏掉首次应用**。`setShadowEnabled` 只写在 `applyDisplaySettings` 里且包在 `if (showShadow !== previous.showShadow)` 内；而构造时 `showShadow` 的初始值就是默认值 `true`，首次调用传入的也是 `true` → 条件永远不成立 → 光源的 `castShadow` 始终是 false。
**教训**：凡是"按变化量触发副作用"的地方，必须同时保证**初始状态被应用过一次**（在 constructor 里显式同步），或者改成幂等的无条件同步。这里两者都做了：constructor 显式调一次 + applyDisplaySettings 改为每次幂等同步（只把"打重渲标记"留给变化判断）。`setShadowEnabled` 本身幂等（three 的 program 参数没变就命中缓存），所以无条件调用没有额外代价。

【排障经验】像"配置了但什么也没发生"这类问题，最有效的手段是把链路两侧的状态**暴露到可一键复制的诊断输出里**。本轮给性能快照的 shadow 段加了 `lightCasts`（主光是否投影）与 `catcher`（接收面是否可见），下次一眼就能分辨是光源侧还是接收侧的问题，不必再读一遍代码。
- [2026-10-03 16:27] [经验教训] 搬进 flex 容器会静默改变子元素宽度语义；折叠式悬浮面板的四个必须点 — model-viewer 做悬浮覆盖层布局时确认的两条可复用结论：

【1】把组件从 block 容器的子元素挪进 flex 容器，会**静默改变它的宽度语义**。`ViewerToolbar` 根元素是 `display:flex`，内部靠一个 `flex:1` 的 spacer 把「设置」按钮推到最右；原先它在 block 容器（`el-header`）里作为 block-level flex container **自动撑满宽度**，搬进 `display:flex` 的覆盖层容器后变成 flex item，**宽度只由内容决定** → spacer 分不到空间、按钮不再靠右（无报错、纯视觉回归）。修法：在容器上声明 `.parent > * { flex: 1; min-width: 0 }`。**适用范围**：任何"把已有组件从普通文档流搬进 flex/grid 容器"的重构，都要重新确认它的宽度是"撑满"还是"由内容决定"。

【2】折叠式悬浮面板的四个必须点：① 用 `transform: translateX()` 而不是动画 `width`（宽度动画每帧触发布局，而面板旁边通常正有画布/图表在渲染）；② **开关按钮必须独立于面板**并停在收起后仍可见的位置 —— 放进面板内部的话，一收起按钮跟着移出屏幕，就再也没有入口打开它；③ 收起时同时 `opacity:0` + `pointer-events:none`，否则那块透明区域仍会拦截下层交互；④ 让位偏移量（如工具栏高度）集中成一个 CSS 变量，避免多个文件各写一遍。**附带好处**：面板浮在画布之上时折叠它**不改变画布尺寸**，因此不会触发 renderer 尺寸重算（后处理那条路径在尺寸变化时会重建 render target）。
- [2026-10-03 16:34] [经验教训] keep-alive 缓存持有重资源的视图：显式组件名、拦住隐藏期的 0 尺寸、resume 清短路键、关停 window 级监听 — model-viewer 用 keep-alive 缓存"持有重资源的视图"（WebGL 引擎）时确认的四个必须点，缺任一条都会留下静默缺陷：

【1】`include` 按**组件名**匹配，而组件名可能是"推断"出来的。Vue 能从文件名推断 name，但重命名文件后 `include` 会**静默失配** → keep-alive 不再生效 → 视图退化为卸载重建。表现正是被修的那个 BUG（模型丢失），极难定位。**做法：显式 `defineOptions({ name: 'Viewer' })`**。

【2】视图被隐藏时，它的容器尺寸会报 0，**必须拦住尺寸响应**。否则渲染引擎会把 render target 缩到 1×1、返回时再放大，**白重建两遍 GPU 资源**（4K + MSAA 下不便宜）。做法：引擎加 `suspend()`/`resume()`，并让 `handleResize` 与 ResizeObserver 回调在 suspended 时直接返回。

【3】**`resume()` 里必须先清掉尺寸短路键**（`lastResizeKey = null`）。因为隐藏期间尺寸是 0，恢复时若不强制清键，那次重算会被 `handleResize` 的"尺寸没变就返回"短路挡掉，画布就停在错误尺寸上。这是【2】的必然配套，很容易漏。

【4】**挂在 `window` 上的监听与视图可见性无关，必须显式关停**。典型是全局快捷键：视图被缓存后组件不卸载，监听仍在，于是在别的页面按 `1`/`f`/`s` 会静默作用到看不见的画布上。做法：加 `isActive` ref，`onDeactivated`/`onActivated` 切换它，并把它接进监听的 `enabled` 判定。

**适用范围**：任何用 `keep-alive` 缓存"持有副作用资源"的视图（WebGL 上下文、定时器/轮询、window/document 级监听、WebSocket）。反过来，**纯表单类视图不值得缓存**（重新挂载没有代价），所以 `include` 应只列真正需要保留状态的视图。
- [2026-10-03 16:43] [经验教训] el-tree 的 setCurrentNodeKey 对空串静默无操作（只认 null/undefined）；受控 key 组件的空值语义要按源码核对 — model-viewer 修掉的一个 Element Plus 静默失败坑，以及它代表的通用教训：

【具体事实】Element Plus 的 `el-tree` 里，`setCurrentNodeKey` 对**空串**是静默无操作：
```js
watch(() => props.currentNodeKey, (newVal) => store.setCurrentNodeKey(newVal ?? null))

setCurrentNodeKey(key) {
  this.currentNodeKey = key
  if (isPropAbsent(key)) { /* 清除高亮 */ return }   // 只认 null / undefined
  const node = this.getNode(key)
  if (node) { this.setCurrentNode(node) }             // 找不到 key 就什么都不做
}
```
传 `''` 时它**既不是** `null`/`undefined`（不进清除分支），**又找不到** key 为 `''` 的节点（不进设置分支）→ 直接掉进"什么都不做"，旧高亮原样留着。表现是"清除了选中，描边没了、列表里那一行还亮着"——一半生效一半没生效，很容易以为是自己的逻辑写错。
**修法**：在绑定处把空值映射成 `null`（`:current-node-key="selectedId || null"`，`null` 对非必填 prop 不触发类型警告），内部 store 继续用 `''` 表示"无选中"。

【通用教训】**"用 `''` 表示没有"是应用层的常见约定，但第三方组件库往往只认 `null`/`undefined`**，两侧语义不一致时**不会报错**，只会静默不生效。适用范围：所有"受控 key / 受控值"型组件（树/表格的 current key、选择器的 modelValue 等）。
**排查手法**：这类问题的特征是"我传了值但组件没反应"，此时**读库源码里那个 setter 的空值分支**比猜快得多 —— 本例从 `isPropAbsent(key)` 与 `if (node)` 两行就能确定 `''` 会掉进空档。顺带：添加"清空"能力时，务必同时验证**组件内部高亮/选中态**与**外部业务状态**是否一起被清掉，只验一头会漏掉这种半生效缺陷。
- [2026-10-03 16:51] [经验教训] 离线应用选编译期图标方案；图标名要先批量核对（Material Symbols 与 Material Icons 命名不同）；窄容器用纯图标+tooltip — model-viewer 引入图标库（Iconify）时确认的可复用结论：

【1｜选型：离线桌面应用必须用编译期方案】三种做法对比：① `@iconify/vue` + 在线 API —— 运行时向 Iconify 服务器取 SVG，**离线直接不可用**；② `@iconify/vue` + `addCollection(整集)` —— 离线可以，但要把整集（Material Symbols 数千个）打进包；③ **`unplugin-icons` + `@iconify-json/<集名>`（采用）** —— `~icons/<集>/<名>` 在编译期编译成 Vue 组件，只打包真正 import 的图标。**实测：几十处图标总共只增加 6KB**（对比 ② 的量级差距）。配置只有 vite 插件一行。
**适用范围**：任何"必须离线"的前端（Tauri/Electron/内网部署）选图标方案时，先排除一切运行时按需拉取的方案。

【2｜图标名必须**先批量核对**，不要逐个等构建报错】Material Symbols 与旧的 Material Icons **命名并不完全一致**（例：`highlight_off` 是旧名，Material Symbols 里没有 `highlight-off`，最接近的语义等价名是 `deselect`）。而 `pnpm build` 一次**只报第一个**缺失项 —— 逐个试就是多轮往返。
**做法**：动手前把要用的名字一次性对着图标集的数据文件核对（本项目即 `node_modules/@iconify-json/<集>/icons.json` 的 `icons` + `aliases` 键），缺失的先改成等价名再写代码。

【3｜窄容器里「图标 + 文字」会溢出，纯图标反而更省空间】侧栏仅 340px、表格操作列 152px 这类宽度敏感处，加图标会直接把按钮挤出去（与"长模型名挤掉操作按钮"是同一类问题）。**做法：改用纯图标按钮 + tooltip** —— 比原来的纯文字更省空间，可发现性由 tooltip 兜底。空间充足处（工具栏、面板底部）仍用「图标 + 文字」，不牺牲可读性。**前提**：纯图标按钮必须逐个配 tooltip，否则等于把可读性换成了猜谜。

【4｜顺手统一历史写法】同一界面里不要并存两套图标来源。本项目动画条的播放/暂停/停止原本是手写的内联 SVG，引入图标库后一并换掉 —— 否则"两套视觉语言"会长期漂移。
- [2026-10-03 16:54] [经验教训] "刻意的默认值 + 多个调用点"会让同类操作行为不一致：默认值越安全，漏传越隐蔽（须主动审计调用点） — model-viewer 暴露的一类缺陷模式：**"刻意的默认值 + 多个调用点" 会导致同类操作行为不一致**。

【具体案例】`ViewerEngine.fitToObject(object, { animate = false })` 的默认值 `false` 是**有意**的 —— 加载模型、重新摆放、尺寸变化这些程序化路径必须立刻到位，不能有过渡。但正因为默认值被"设计成安全的"，每个**用户主动**的视角跳转调用点都必须**显式**传 `animate: true`，而实际只有「切换视图预设 / 重置视图」（走 `setViewPreset`）传了：
- 层级树「聚焦」→ 漏传 → 瞬移（本轮修掉）
- 工具栏「适配视图」/ `F` 键 → 漏传 → 仍瞬移（**未修，待定**）
- 「重置视图」/ `R` 键 → 有动画
结果同一个工具栏里两个按钮"一个跳、一个滑"，而这种不一致**没有任何测试或报错会提示**。

【可复用做法】当某个默认值是为了保护某类调用者而**刻意**设定的（代码里通常有一句"默认 X，因为这边的场景需要 Y"的注释），就要把它当成一个**审计信号**：显式列出所有调用点，逐个确认"它属于哪一类、该不该显式覆盖"。默认值越"安全"，漏传的代价就越隐蔽 —— 因为程序不会崩，只是行为悄悄不对。

【适用范围】任何"默认值 + 多入口"的 API：动画开关、副作用开关（是否持久化 / 是否记录历史 / 是否触发重渲染）、权限或校验参数。**排查线索**：同一界面上同类操作表现不一致时，先怀疑"某处漏传了参数"，而不是"这个功能的实现有问题"。
- [2026-10-03 17:00] [经验教训] 换掉自带形态差异的控件时要多重信号补偿可辨性；状态色优先用组件库的 type 而非自定义 CSS（避免特异性之争） — model-viewer 换控件时确认的两条可复用结论：

【1｜把"自带形态差异"的控件换成"没有形态差异"的控件，必须主动补偿状态可辨性】`el-switch` 的开关位置本身就表达状态，而图标按钮没有这层信息 —— 换过去后如果只换个图标形状，隐藏态的辨识度会明显下降。**做法：用多个互不依赖的信号叠加**。本项目用了三重：图标形状（实心眼睛 / 划掉的眼睛）+ 按钮颜色（用 `type` 区分）+ 相邻文本的既有样式（节点名删除线 + 变灰）。
**适用范围**：switch → 图标按钮、复选 → 开关、标签页 → 下拉 等任何"换控件"的改造。**检查方法**：换完问一句"不看交互、只扫一眼，能分清这两个状态吗"。

【2｜表达状态优先用组件库的 `type`/`variant`，不要自定义 CSS 去覆盖它的颜色】自定义 class 想改按钮颜色时，会与 Element Plus 的 `.el-button.is-text` 这类选择器**特异性打平甚至更低**，于是要么靠加载顺序碰运气、要么被迫加 `!important` 或堆选择器 —— 都是味道很差的修法。**改用组件自己的属性**（`:type="visible ? 'default' : 'info'"`）则：① 符合项目"复用 Element Plus 组件"的规范；② 颜色跟随主题变量自动适配明暗；③ 不必和库的样式特异性较劲。
**适用范围**：任何基于组件库的主题色/状态色表达（按钮类型、标签类型、文字层级）。**例外**：库没有对应属性可表达时才回退到自定义样式，此时用足够特异性的选择器并写清理由。
- [2026-10-03 17:57] [经验教训] 对"我没改过"的配置文件要**先验证再排除**（回退 .nvmrc 曾弄坏工具链）；git push 的放宽前提随会话策略变化 — model-viewer 项目里确认的两条操作经验（第 1 条是**修正过的结论**，含一次实际踩坑）：

【1｜对"我没改过"的配置文件：先验证，再决定排除，别只凭推理回退】
**踩坑经过**：提交前暂存时发现 `.nvmrc` 从 `22.22.1` 被改成 `22.23.3`（恰好等于当前机器的 node 版本），我据"项目内没有 `.npmrc` 也没有 pnpm 的 node 版本配置 + 我没动过它"判定为环境写入的无关改动，`git checkout` 回退并把它排除出提交 —— **结果回退后测试与构建全部失败**：`Node.js v22.22.1 is not installed or cannot be found`。因为 node 的版本包装器会按 `.nvmrc` 去找对应版本，而本机只装了 22.23.3。**那个改动是环境有意同步、必须保留的**，随后恢复并单独提交（`chore: 同步 .nvmrc 到当前 node 版本`）。
**修正后的做法**：① 先 `git diff <file>` 看内容；② 对**可能是环境必需**的配置文件（`.nvmrc`、`.tool-versions`、锁文件、`package.json` 的 engines 等）**先回退、立刻跑一次基线命令**（测试或构建），用结果判断 —— 失败即说明它是必需的，改回来并如实提交；③ 只有确认回退无副作用才排除；④ 无论哪种处理，都在汇报里说明。
**判断线索（当时推反的那一条）**："新值恰好等于当前环境的版本"**不是**"意外写入"的证据，反而很可能是"环境为了匹配运行时而同步"的证据。
**适用范围**：任何"批量暂存再提交"的流程，尤其仓库里存在由工具维护的文件（版本声明、记忆文件、锁文件）。

【2｜`git push` 的放宽前提随会话策略变化，先看当前策略再决定要不要请求】
本项目 push 走 ssh 会被 `sh.exe` 包装，在**受限沙箱**下报 `couldn't create signal pipe, Win32 error 5` 而失败，此前需 `sandbox_permissions: danger-full-access` 重试。但当会话文件策略**已经是 danger-full-access** 时，直接 `git push` 即可成功，**不需要也不应再请求升级**（若审批策略是 never，这类请求会被自动拒绝）。
**做法**：push 前先看运行时上下文里的 file policy；用 `GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20'` 预设选项避免交互卡住；成功后核对 `git status -sb` 显示 `main...origin/main` 无 ahead/behind。
**适用范围**：本机（Windows + DSH 沙箱）的 git 远端操作；纯本地 git 命令（add/commit/log/status）从来不需要放宽。
- [2026-10-05 09:10] [经验教训] Tauri 无安装目录名配置项：目录与安装包名都来自 productName（installMode 默认 currentUser）；NSIS 向导语言默认仅英文 — model-viewer 打包中文路径的调研结论（**已核对本地 `node_modules/@tauri-apps/cli/config.schema.json`，非凭印象；改动尚未实施，等用户选方案**）。

【1｜Tauri 没有"安装目录名"或"安装包文件名"的配置项】`NsisConfig` 的全部可配项只有：`template, headerImage, sidebarImage, installerIcon, uninstallerIcon, uninstallerHeaderImage, installMode, languages, customLanguageFiles, displayLanguageSelector, compression, startMenuFolder, installerHooks, minimumWebview2Version`。顶层另有 `mainBinaryName`，但它**只改 exe 文件名**，不影响安装目录。

【2｜两个中文都来自同一个字段】`productName`（当前 `三维模型查看器`）决定：① 安装包文件名 `三维模型查看器_0.1.0_x64-setup.exe`；② 安装目录名。另注 `installMode` **默认 `currentUser`**，所以实际装到 `%LOCALAPPDATA%\三维模型查看器\`，**不是** Program Files；改成 `perMachine` 才会变 `C:\Program Files\三维模型查看器\`。

【3｜两条改法及取舍】
- **方案 A（推荐）**：`productName` 改成 ASCII（如 `ModelViewer`）→ 安装包名与目录一并变英文。`app.windows[].title` 独立控制窗口标题，可保持中文不变。**代价**：开始菜单快捷方式名、以及「设置 → 应用 → 已安装的应用」里的显示名都跟着变英文；`startMenuFolder` 只能把快捷方式放进一个中文**文件夹**（多一层），改不了快捷方式本身的名字。
- **方案 B**：只改目录、保留全部中文显示名 —— 用 `bundle.windows.nsis.template` 指向自定义 `installer.nsi`（从 Tauri 仓库对应版本复制，改 `InstallDir` 里的应用名）。**代价**：要跟随 Tauri 版本维护这份模板（官方模板变了得同步）。只在"显示名必须中文且目录必须英文"这个组合下才值得。

【4｜附带发现（可能更值得注意）】`bundle.windows.nsis.languages` **默认 `["English"]`** —— 当前**安装向导界面是英文的**。想改中文需显式配 `"languages": ["SimpChinese", "English"]`。

【5｜改 `productName` 的副作用】安装目录会变，旧的 `%LOCALAPPDATA%\三维模型查看器\` 会残留，需手动卸载一次；`identifier` 与数据目录（固定 `~/.model-viewer/app`）**不受影响**。

【待用户决定】① 改文件名、安装目录、还是两者；② 应用显示名能否变英文（这是选 A 还是 B 的唯一分界）；③ 是否顺手把安装向导语言改中文。
- [2026-10-05 09:38] [经验教训] 处理 HDR 素材：Pillow 读不了 RGBE；ImageMagick 必须 HDRI 构建；缩放禁用默认 Lanczos；用 mean/max 验证未截断 — 处理 Radiance HDR（.hdr / RGBE）图像素材时确认的六条结论，都在这轮实际踩过或验证过：

【1｜Pillow **不支持** Radiance HDR】`Image.registered_extensions()` 里没有任何 hdr 扩展名。bundled Python 只带 Pillow（无 OpenCV/imageio），所以**别指望用 Python 直接缩 HDR**。可行工具：**ImageMagick**（本机已装）、OpenCV、imageio。先查 `magick` 是否可用，比急着装依赖划算。

【2｜ImageMagick 必须是 **HDRI 构建**】用 `magick -version` 看是否为 `Q16-HDRI`。**普通 Q16 会把 HDR 的动态范围截断到整数**，环境贴图的高光直接毁掉。本项目机器上的是 `ImageMagick 7.1.2-31 Q16-HDRI` ✓。**适用范围**：任何浮点图像（.hdr/.exr，以及需要负值/超范围中间结果的合成）。

【3｜缩放 HDR **不要用 ImageMagick 的默认滤镜**】默认是 Lanczos，会产生 overshoot（负值 / 超亮），在环境贴图上表现为异常亮点。改用无 ringing 的滤镜：`-filter triangle`（本轮采用）或 `box`/`Mitchell`。

【4｜验证"动态范围没被截断"的方法】对比缩放前后的统计量：
`magick identify -format "%f mean=%[mean] max=%[max] min=%[min]\n" <原图> <结果>`
判据：**`max` 基本不变**即没截断（本轮两张图的 `max` 完全一致）；`mean` 轻微下降是降采样的正常平滑，不是问题；`max` 若掉到 1.0 量级则说明被归一化/截断了。

【5｜Windows 上的 `convert` 不是 ImageMagick】`C:\Windows\system32\convert.exe` 是 NTFS 磁盘转换工具，**同名易误用**。ImageMagick 7 的命令行是 **`magick`**。

【6｜尺寸用 `-resize WxH`，不要用 `WxH!`】`WxH` 是"装入该框、保持比例、只缩不放"——已是目标尺寸的图不会被放大，2:1 的等距柱状全景正好落成 1600×800。加 `!` 是强制拉伸，会破坏比例。另注：`-Y H +X W` 是 Radiance 头部的写法的**高在前**，读头部时别把宽高读反。
- [2026-10-05 09:57] [经验教训] 新增资源来源：处理流程相同而前提条件不同时，复用流程但分开类型；复用会暴露缓存键语义变化（测试抓住正是好事） — model-viewer 给"新增一种资源来源"确认的可复用设计模式（内置全景图接进环境贴图系统时验证）：

【1｜判据：处理流程相同、前提条件不同 → 复用流程，分开类型】内置贴图与用户导入的**后续处理完全一样**（读文件 → 登记纹理 → PMREM），但**前提条件不同**：内置是应用资源，不需要 asset 协议重新授权、也没有应用数据目录里的副本路径。
- 于是**流程复用**：只抽出变化的那一层 —— `resolveEnvironmentTextureUrl(environment)`（imported 取 `customHdrUrl`、builtin 按 id 推导），其余读取/登记/PMREM 一行不改；
- 但**类型不硬塞**：用独立的持久化字段 `builtinId`，而不是借 `customHdrUrl/customHdrPath` 造假数据。否则所有"按来源类型判断"的逻辑（如 `degradeStaleImportedEnvironment` 里"没有副本路径就退回渐变"）都会被迫加例外分支，越改越别扭。

【2｜复用会暴露一处"可见成本"，那是好事】因为两条来源共用同一条纹理缓存，`resolveEnvironmentPlan` 的缓存键前缀必须从 `imported|` 改成 `texture|`（否则键名与实际语义不符）。这**直接导致一个既有单测失败**——这正是想要的效果：测试抓住了"共用缓存"这个语义变化，迫使作者显式确认它。**不要为了让旧测试变绿而保留名不副实的键名。**

【3｜技术标识与用户可见名分层】随应用分发的静态文件用 **ASCII 文件名**（`stone-forest.hdr`），界面用清单里的**中文 label**（`石林`）。理由：文件名要经 URL/自定义协议层，非 ASCII 路径在这类环境里出过问题；而显示名完全可控，不该为技术限制牺牲可读性。清单里同时存 `id`（持久化用，改名等于破坏用户设置）与 `file`，职责分明。

【4｜体积换功能的决策必须先量化再问】这类"内置大资源"的功能，代价是安装包直接变大（本例 4.29 MB → 约 23 MB，约 5 倍）。做法：**先算出前后数字、给出"全部内置 / 精选几张 / 只做入口"的选项让用户选**，再动手 —— 而不是先实现完再说"顺便它变大了"。

**适用范围**：任何"给已有系统新增一种来源/后端/格式"的改造（导入 vs 内置、本地 vs 远端、程序化 vs 文件）。
- [2026-10-05 10:06] [经验教训] 不要把函数内部已知的中间结果做成布尔值参数交给调用方（会重复推导且静默失效）；测试要断言"传给依赖的中间输入" — model-viewer 修掉一个静默功能失效后提炼的 API 设计教训（是对 d5838c434600"复用流程、分开类型"的**实践补充**，不是替代）：

【1｜核心原则：纯函数内部已经算出的中间结果，不要以"算好的判断"（布尔值）形式再要求调用方提供】
案例：`resolveEnvironmentPlan(environment, { importedReady })` —— 它**内部**就会用 `resolveEnvironmentTextureUrl(environment)` 推出目标 URL，却把"这个 URL 的贴图登记了没有"做成布尔值参数丢给调用方。调用方看不到那个中间 URL，只能**自己重新推导一遍**；结果 `EnvironmentManager.apply` 里只写了 `environment.customHdrUrl`，而内置来源该字段为 `null` → 永远 `importedReady = false` → 每次都退化渐变，用户看到的就是"切了没反应"。
**修法**：把参数换成回调 `{ hasTexture: (url) => boolean }`，让纯函数用它自己算出的 URL 去问。收敛后"用哪个 URL 判断"只有一个答案，这类不一致在结构上消失。

【2｜识别信号】当你发现**调用方需要重复计算被调函数内部已知的东西**（重新解析同一个 URL、重新推导同一个默认值、重新统计同一个集合），就说明这个参数设计错了 —— 应该把回调（或原始输入）传进去，而不是把算好的结论传进去。**"把结论传给函数"看似更简单，实则把知识复制到了调用方。**

【3｜为什么这类 bug 是静默的】因为它走的是一条**合法的降级路径**：`importedReady=false` 是完全正常的状态（"贴图还没加载完"），函数据此正确退化为渐变、不抛错、不打日志。于是**配置错误伪装成了正常状态**。教训：**凡是"未准备好就降级"的设计，都要额外检查"判断自身是否可能永远为假"** —— 降级路径越优雅，它的失效越难察觉。

【4｜测试护栏的写法：断言"传给依赖的中间输入"，而不只是最终结果】本轮补的两条用例是照 bug 写的：① 内置来源必须拿**推导出的** URL 去查询（断言回调收到的参数匹配 `/hdr/mountain.hdr$/`），而不是那个不存在的 `customHdrUrl`；② 推不出 URL 时**不应发起查询**（避免拿 `null` 去问）。只看 `kind`/`cacheKey` 的断言**测不出**这个 bug（退化后返回的也是合法值）；**必须断言"它用什么输入去问了谁"**。

**适用范围**：任何"把状态/结论作为参数传给纯函数或工具函数"的地方，典型是缓存命中判断、能力探测结果、开关状态、依赖是否就绪。
- [2026-10-05 10:16] [经验教训] 修"重复推导"bug 必须 grep 全部同类用法；three 的 scene.environment 对 Standard/Lambert/Phong 生效；"效果弱"与"没生效"要用无关观察点二分 — model-viewer 修"内置环境贴图不生效"时得到的三条可复用结论（第 1 条是对上一轮 41cdae30ac22 的必要补充）：

【1｜修"重复推导"类 bug 时，必须 grep **全部**同类用法，而不是只修被发现的那一处】同一个文件里有两处犯同一个错：判断"贴图登记了没"用了 `environment.customHdrUrl`、取纹理也用了 `environment.customHdrUrl`。上一轮只修了前者并加了护栏，结果是**看起来修好了、功能却完全没生效**（后者把 `null` 传给生成函数，`scene.environment` 被设成 null）。用户反馈"还是不起作用"时才找到第二处。
**做法**：定位到"某字段被误用"之后，立刻 `grep <该字段名>` 扫全仓，逐处判定它该不该换成统一解析的结果；**不要修完一处就认为完事**。这类"同一根因多处实例"的缺陷在重构（尤其"新增一种类型/来源"）时特别常见。

【2｜three 的 `scene.environment` 对哪些材质生效（查源码确认，别凭印象）】`WebGLRenderer.js:2173`：
```js
materialProperties.environment = ( material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial ) ? scene.environment : null;
```
即 **Standard / Lambert / Phong 都自动生效**；`MeshBasicMaterial` / `MeshNormalMaterial` / `LineBasicMaterial` **不生效**。
**差点出错**：我原本准备答复"FBX 的 Phong 材质不支持 scene.environment"，查了源码才发现是错的（Phong 支持）。**"某功能对哪些类型/变体生效"属于框架能力边界，必须读源码或官方实现，不能凭印象**（本项目已因此栽过不止一次）。

【3｜"效果弱"与"完全没生效"必须分开判断 —— 找一个与可变因素无关的观察点做二分】用户说"感觉不起作用"时，先别急着修：本例里既可能是 bug（链路断），也可能是**物理上就弱**（默认黏土材质 `metalness: 0.1 / roughness: 0.65`，环境贴图只贡献柔和间接光，几乎没有可见反射）。
**判别手法**：挑一个**绕开所有可变因素**的观察点来二分 —— 这里就是"**把背景设为环境贴图**"：它直接显示全景图本身，与模型材质、金属度、着色模式全都无关。若这一步能看到图 → 链路是通的，剩下的只是"效果强弱"问题；若看不到 → 才是链路/资源问题。**给用户排查建议时，优先给这种"一次就能分出方向"的验证步骤**，而不是罗列一堆可能原因。

【适用范围】第 1 条适用于任何缺陷修复与重构；第 2 条适用于 three 材质与环境贴图相关的判断；第 3 条适用于任何"用户报告某功能没效果"的场景（渲染、动画、样式、快捷键）。
- [2026-10-05 10:26] [经验教训] "偶发"先查竞态；异步路径上不要用提前 return 跳过状态同步；判定异步结果要比对"请求目标 vs 当前目标"；修好一层会露出下一层 — model-viewer 修掉一次"偶发切换失效"后提炼的四条可复用结论（异步竞态通用，不限于本项目）：

【1｜"偶发"这个词本身就是线索：先按竞态查】**只在某些时机出问题、慢操作永远复现不了**，几乎总是竞态，而不是逻辑错误。本项目案例：用户连着切两张环境贴图 → 偶尔界面停在旧图上；**只要每张都等加载完再切，就永远复现不出来**。所以复现步骤要写"不等加载完就切下一张"。
**适用范围**：任何"异步加载 + 用户可连续操作"的功能（图片/模型/路由/搜索建议/切换主题）。

【2｜在异步路径上，不要用"提前 return"跳过状态同步】反面案例：调用方为了"等文件读完再应用"，在需要读文件时**直接 `return`、不更新引擎状态** —— 结果是**被调用方持有的状态停留在旧值**；等异步完成时，它拿旧状态去套用，于是**后完成的旧请求覆盖了用户最新的意图**。
**正确做法**：无论要不要异步加载，**先把当前状态同步下去**（未就绪时走降级路径），等资源好了再由内部切过去。状态同步不该是"等条件满足才做"的事。

【3｜判断"异步结果是否还该应用"，必须比对"请求时的目标 vs 当前的目标"】不能相信"谁最后完成谁赢"（那正是"晚期旧请求覆盖新选择"）。做法：应用前用当前状态重新解析出目标，与本次结果比对，不一致就**只缓存不应用**（缓存总是有益的 —— 下次切回来即命中，不浪费这次读取）。
**实现建议**：把这个判定抽成**纯函数**（本项目即 `shouldApplyLoadedTexture(currentEnvironment, loadedUrl)`），因为它是这条竞态唯一可单测的表达形式；否则只能靠人工快速点击复现。

【4｜修好一层缺陷后，要预期下一层会露出来】本例的时序缺陷**一直存在**，只是在"内置贴图完全不生效"那个 bug 修好之前，根本走不到"切换"这一步，所以无从暴露。**排查时不要把"刚修过的地方又出问题"当作修复无效** —— 先确认这次的失败模式是否与上次不同（这次是"多数正常偶尔失败"，上次是"从不生效"），往往说明修对了、只是更上层的缺陷现形了。
- [2026-10-05 10:37] [经验教训] 弃用类可能只是新类的薄包装（读源码再换）；"本该出现的警告没出现"是强诊断信号；动态 import 路径构建不校验需单独验 — 处理"上游弃用警告"时确认的四条可复用结论：

【1｜遇到弃用警告，先读被弃用的那个类本身，再决定替换风险】three 的常见做法是**保留旧名作为新类的薄包装**，只在构造函数打一条警告。本例 `RGBELoader` 全文就是 `class RGBELoader extends HDRLoader { constructor(m){ console.warn(...); super(m) } }` —— 唯一区别是那条警告，所以替换**行为完全一致、零风险**。（若旧类里还有真正的实现差异，就必须逐项比对 API 后再换。）
**适用范围**：任何库的 `@deprecated` 类/函数/参数。**别凭"名字变了"就假设行为也变了**，也别因为"有警告"就以为要大改。

【2｜"本该出现的日志/警告却没有出现"是强诊断信号：说明那段代码路径从未被执行】本例最有用的一条观察：`RGBELoader has been deprecated` 这条警告**此前一直没出现**，而它出现的时机恰好是——修好前面两个 bug、内置贴图**第一次真正开始加载**之后。于是这条警告反而成了"链路已通"的证据。
**用法**：排查"功能没反应"时，可以主动问一句"这条路径上应该有什么日志/警告/网络请求？它出现了吗？"；**没有出现**往往比出现更能定位问题（说明根本没走到那里）。**适用范围**：渲染管线、异步加载、事件回调等一切"静默执行"的路径。

【3｜跟随弃用时顺手检查兄弟模块，不要只改被报的那一个】同一个文件里 `EXRLoader` 与被弃用的 `RGBELoader` 是并列分支，替换时顺手确认了 `EXRLoader` **没有**弃用（它唯一那条 `console.warn` 是"跳过未知头部格式"的正常运行时提示，不是弃用）。**只修控制台报出来的那一个，会留下同类问题下次再报一遍**。

【4｜动态 `import()` 的路径不会被构建静态校验，必须单独验证】本项目大量用 `await import('three/addons/loaders/xxx.js')` 做按需加载，而打包器**不会**（也无法）静态检查这类路径 —— 写错文件名时 `pnpm build` 照样成功，只在运行到那一行才失败。**做法**：改完用 `node -e "import('three/addons/loaders/HDRLoader.js').then(m => console.log(Object.keys(m)))"` 直接验一次路径与导出名。
- [2026-10-05 14:33] [经验教训] 加 .gitignore 规则要双向验证（目标被忽略 + 相似路径未误伤），用 git check-ignore -v 看命中规则；相似命名是误伤高发区 — 给 `.gitignore` 加规则时的可复用手法（本轮通过 `assets/hdr/` 与 `public/hdr/` 这对高危相似路径验证）：

【1｜加完规则必须**双向验证**：目标确实被忽略 + 相邻相似路径没被误伤】只验证"目标不出现了"是不够的 —— Git 的忽略是模式匹配，**容易连带命中你没打算忽略的路径**，而这类错误是**静默**的：文件从 `git status` 里消失、看起来"干净了"，直到很久以后"产物里少东西"（本例会是"安装包里没有环境贴图"）才暴露。
**验证命令**（两条都要跑）：
- 目标：`git check-ignore -v assets/hdr/` → 输出 `.gitignore:33:assets/hdr/  assets/hdr/`（**带规则行号**，能确认是哪条命中）
- 相邻：`git check-ignore -v public/hdr/studio-1.hdr` → **应无输出且退出码为 1**（= 未被忽略）。用 `if ($LASTEXITCODE -ne 0)` 判成功，别把"无输出"当命令失败。

【2｜相似命名是误伤高发区，规则要写得更精确】本例 `assets/hdr/`（原始素材，119 MB，该忽略）与 `public/hdr/`（应用内置资源，22 MB，**必须入库**）名字只差一级目录。做法：
- 规则用 **`assets/hdr/`**（带前导路径 + **结尾斜杠**）：斜杠把它锚定到 `.gitignore` 所在目录且只匹配目录，避免 `**/assets/hdr` 这类宽松写法；
- **在 `.gitignore` 里写注释说明为什么不能忽略那条相似路径** —— 忽略文件的维护者往往不是作者，一句注释能挡住一次误操作。

【3｜"忽略掉了本该入库的东西"属于最难自查的一类错误】因为它不报错、不影响本地运行（文件还在磁盘上），只影响**别人 clone 之后的仓库**与**打包产物**。所以：① 对"只差一级目录/只差后缀"的路径组格外小心；② 用 `git status` 之外的手段（`check-ignore`）确认；③ 提交前顺带看一眼 `git status` 里"该出现的新目录出现了没有"（本例 `?? public/hdr/` 必须出现）。

**适用范围**：任何 `.gitignore` / `.dockerignore` / `.npmignore` / 打包排除清单的修改。

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
- [2026-09-17 09:40] [行动指南] 界面布局与控件定案：动画控制条悬浮底部（图标按钮并排）、信息 HUD 悬浮左上角（透明度 0.3、无模型不渲染、快捷键 I） — model-viewer 界面布局与控件的用户定案（2026-09，按用户明确要求调整，后续不要改回）：

【动画控制】悬浮在渲染区底部的控制条（components/viewer/AnimationBar.vue）：片段选择 + 播放·暂停 + 停止 + 时间轴 + 倍速 + 循环模式 + "已播完"标记；**仅在模型含动画时出现**；事件名与原侧栏面板一致，所以 Viewer.vue 处理函数无需改动。**原「动画」标签页已删除**（AnimationPanel.vue 已删）。

【播放/停止按钮】用户要求**纯图标、两个独立按钮并排**（commit f8dec99）：
- 图标用**内联 SVG + `currentColor`**，**不引入 `@element-plus/icons-vue`**（本项目一直避免图标依赖包）；
- 图标随状态切换（播放中显示暂停图标），播放态保持主题色高亮；
- 文字去掉后必须补 `title` 与 `aria-label`；
- 控制条内 `:deep(.el-button + .el-button) { margin-left: 0 }`，间距只由容器 gap 负责（EP 自带 12px 会与 gap 叠加，见 lessons 的 C 家族）。

【模型信息 HUD】渲染区左上角浮动浮层（components/viewer/InfoHud.vue）：文件名/格式/大小/三角面/顶点/尺寸（按声明单位换算，三轴各自带单位）/帧数/FPS/渲染模式/运行环境 + 渲染异常文案。用户明确的两点（commit 87dd347）：
- **背景透明度 0.3**（面板与折叠圆点一致；原为 0.72）——以便直接观察模型；
- **未打开模型时完全不渲染**（根节点 `v-if="model.hasModel"`），不再显示"未打开模型"的空面板；
- 有模型时：`visible` 为真显示面板，为假只留一个小圆点按钮（可点开）；**快捷键 I** 切换（会话级未持久化）。
- 待确认项：若用户反馈浅色模型上 0.3 导致文字发虚，可改为 0.4 或加轻量文字阴影 —— 未获反馈前不要改。
**原底部状态栏已删除**（ViewerStatusBar.vue 已删）。

【相关约束】① 浮层都放在 `.viewer__stage` 内（`position:absolute` + `z-index:3`），必须留在 `ModelCanvas` 的兄弟位置而非插槽内，避免被 canvas/CSS2D 层影响交互；② 快捷键 `I` 的 enabled 恒真，其余快捷键各自做空值保护。

【待用户确认（不要提前改）】用户曾反馈"播放与停止按钮之间异常"，我判断为**间距叠加**并已修（commit 0920a01）；若其实指**图标辨识度**（暂停两条竖线与停止方块在 14px 下易混）／**两按钮宽度或风格不统一**／**播放态 primary 高亮让两者不协调**／**窄窗口折行导致位置异常**，这四个方向都尚未改，等用户一句话点明再动。

【验证手段】这类纯 UI 结构调整**构建不报错、单测覆盖不到**，固定用 `node scripts/diagnose-sfc.cjs` 做组件绑定静态检查（14 个组件）+ 人工在浏览器确认。
- [2026-09-17 10:01] [行动指南] 明暗主题现状：固定暗色（dark 类写死、无外观设置）；已给出低成本实施方案与 5 处待抽变量的硬编码颜色，等用户确认是否实施 — model-viewer 的明暗主题现状与待实施方案（已查证，**尚未实现**，不要当成已有功能）：

【现状：不具备明暗切换，当前是固定暗色】
- `index.html` 第 2 行是 `<html lang="zh-CN" class="dark">` —— `dark` 类**写死**；
- `src/main.js` 已引入 `element-plus/theme-chalk/dark/css-vars.css`（所以 EP 组件的暗色变量是可用的）；
- `settingsStore` 的设置项只有 autoRotate / autoRotateSpeed / grantMode / maxPixelRatio 等，**没有外观项**；全库搜 `prefers-color-scheme` 零命中；
- 注意：代码里大量 `theme` 命中指的是**「光照主题」**（用户保存的打光快照，存 lighting_themes 表），与 UI 明暗无关，别混淆。

【成本评估：低，因为 EP 暗色机制就是加减 `<html>` 上的 `dark` 类】
1. `settingsStore` 增加 `appearance: 'dark' | 'light' | 'system'`（写入 viewer_settings，默认沿用暗色）；
2. 新增应用函数：按设置给 `document.documentElement` 加/去 `dark`；`system` 走 `matchMedia('(prefers-color-scheme: dark)')` 并监听变化；
3. 「设置」页加三选（暗色/亮色/跟随系统）+ 工具栏快捷切换按钮；
4. **必须同时处理 5 处硬编码颜色**，否则亮色下浮层仍是深色块（已定位）：`Viewer.vue` 画布底 `#1b1e24`；`ModelCanvas.vue` 透明棋盘格 `#22262d`/`#333941`；`InfoHud.vue` `rgba(15,17,21,0.3)`（两处）；`AnimationBar.vue` `rgba(15,17,21,0.78)`；`LoadingOverlay.vue` `rgba(15,17,21,0.72)` → 抽成 CSS 变量（如 `--viewer-canvas-bg`、`--viewer-overlay-bg`）。

【我给用户的建议取舍（待其确认，未拍板）】**UI 跟随明暗、3D 视口背景不跟随**（视口背景仍由「显示 → 背景」控制、默认深色）——理由：Blender/Maya 等主流三维软件即使 UI 是亮色，视口也常保持深色，更利于判断形体与材质；跟随会破坏用户已调好的观感。

【行动约束】提出该方案时沙箱处于**只读**模式，实施需要用户批准写权限（用 sandbox_permissions 申请）。下一步动作：等用户回答"是否按此方案实施 / 是否只做跟随系统"，再动手。
- [2026-09-17 10:24] [行动指南] M6 完成（除真机验收）：7 项全部有结论，NSIS 安装包已产出，远端 881c4d7 — E:\AI-Coding\model-viewer 的 M6 收尾状态与交接。**M6 七项全部有结论：第 1~6 项完成，第 7 项已完成可自动化验证的全部内容**。远端 origin/main = **881c4d7**（本地与远端一致）。

【本轮 8 个提交，对应设计文档 §23~§29】
- 66a4994 文案修正；54abf35 M6-1 最近文件；5620a3c M6-2 手动轴向覆盖；ccdb45a M6-3 MTL 绝对路径接线；0d89ba6 M6-4 截图导出；82fd7c8 M6-6 文件关联+单实例；3e4804b M6-5 HDR/EXR 导入；949b614+881c4d7 M6-7 打包与基准。
- 关键教训已单独入库：0decba8645bc（MTLLoader 会把 baseUrl 拼在绝对贴图路径前，必须多一层 extractEmbeddedLocalPath）、867a37b1853a（WebGL 截图"渲染+读像素"必须同一同步任务；Tauri capability 漏 dialog:allow-save 只在运行时炸）。

【M6-7 最终结论（重要，此前"打不出安装包"的记录已作废）】
- **NSIS 安装包已成功产出**：`src-tauri/target/release/bundle/nsis/三维模型查看器_0.1.0_x64-setup.exe`（5.72 MiB）。前两次 `timeout: global` 是 GitHub 下载**瞬时**不通（当时 curl 复测 github.com:443 确实连不上），第三次重试即成功 —— **遇此报错先重试，别急着判定环境不可用**。
- **已按用户决定改配置**：`bundle.targets` 由 "all" 改为只打 **nsis**（避开 WiX3 的 .NET Framework 3.5 依赖；中文产品名在 NSIS 下没问题）；`identifier` 由 `com.model-viewer.app` 改为 `com.shinezer0.modelviewer`（消除 `.app` 结尾告警）。数据目录不受 identifier 影响（固定用 `~/.model-viewer/app`）。
- MSI 不用了：`light.exe` 失败已用「ASCII productName」A/B 试验排除中文名因素，属 WiX 运行时/安全策略问题。
- 基准：`scripts/make-benchmark-model.mjs`（默认 100,352 面 / 4.8MiB，传参可到 399,618 面）+ `tests/make-benchmark-model.test.js`（9 例自检）。**FPS 数值必须真机读**：打开 STL → `F` 适配 → `I` 显示 HUD → 记静止 5s 稳定 FPS 与转盘（`T`）FPS。

【验证基线】vitest **381/381（35 文件）**、cargo **47/47**、diagnose-sfc **15 组件**、pnpm build 成功、`pnpm tauri build` 成功出包。

【仅剩的用户侧验收（自动化测不到，建议装包后一次走完）】
① 双击关联文件直接打开、程序已运行时再双击应复用同一窗口（单实例）；② 最近文件重开（含中文路径）与失效路径提示；③ 切换模型轴向；④ 绝对路径 map_Kd 的 OBJ 贴图；⑤ 截图另存后画面完整；⑥ 导入 HDR → 存为主题 → 重启仍能复现（副本在 `~/.model-viewer/app/env/`）；⑦ 十万级三角面模型的 FPS。

【环境约束（仍有效）】vitest / vite / cargo 拉新依赖 / `pnpm tauri build` / git push 一律需 `sandbox_permissions: danger-full-access`；纯本地 git 命令不需要。安装包工具链走 github.com:443，本环境时通时不通（SSH 22 与 crates.io 稳定）。协作硬规约：**同一文件禁止在同一条消息里并发编辑**；PowerShell 里 git commit 的 `-m` 消息不要含双引号（会被拆成 pathspec）。
- [2026-09-17 14:19] [行动指南] 交接：远端 0115ac8（含光源开关 BUG 修复与诊断工具扩展），FBX 上轴/动画诊断与若干 UI 决策待办 — model-viewer 交接（远端 origin/main = **0115ac8**，本地与远端一致；工作区仅剩 memoir 的 PROJECT_MEMORY.md）。

【当前位置】M6 七项全部有结论（§23~§29）；此后陆续补齐：图标、视角切换平滑过渡、模型入场动画、两个侧栏布局修复、光源可视化、FBX 兼容性四项、以及一个开关遗漏实例化的启动级 BUG 修复。逐条细节与教训见记忆 3c567b7a6f86、87fd214ee38c、290801e17e4a、2813da304363、15ddd639a187、09c07c422deb、fc6adc9eaa2f、d2978e7e18b0、172dab5fa415（本轮）。
**验证基线**：vitest **434/434（38 文件）**、cargo **48/48**、`scripts/diagnose-sfc.cjs` 15 组件（已扩展"未声明名字"检查）、pnpm build 成功、`pnpm tauri build` 可产出 NSIS 安装包（含图标与文件关联）。

【FBX 后续（用户确认过症状，但本轮只做了四项：告警接管/单位识别/材质兜底/报错翻译，见 §35）】
1. 上轴：`UpAxisSign = -1` 与 X-up 不处理；且 loader 已自动转 Z-up 后用户再手动选「按 Z-up 处理」会**反向躺倒**（手动模式语义要相对"是否已转过"计算）。
2. 动画：three 只认标准 `AnimStack → AnimLayer → AnimCurveNode`，缺失时应用无提示；可做"加载诊断摘要"（版本/编码/蒙皮网格数/动画源节点数）来定位。
3. 若用户给出具体出问题的 FBX，优先精准修那一个文件。

【其它待用户确认】① 光源可视化是否改成"切到光照页自动显示"、标签是否加方位角/仰角、环境光要不要示意；② 适配视图 `F` 与层级树聚焦仍是瞬移（§31.4）；③ 设置页头部是否 sticky、`public/favicon.svg` 是否删除、图标源图是否移回 `public/`；④ 入场动画进阶项（§33.4）；⑤ 已知但刻意未改：`ViewerEngine.fitToObject` 返回的 `box` 取入参而非实算 `targetBox`。

【真机验收（自动化测不到）】启动正常 + 设置/最近文件读写；双击关联打开与单实例转交；最近文件重开与失效路径提示；切换模型轴向；截图另存；导入 HDR→存主题→重启复现；十万级三角面 FPS；视角过渡与入场动画观感；层级行按钮右对齐、滑块到底无横向滚动条；光源可视化开关；FBX 新提示（单位预选、降级告警、PBR 不再发黑、6.x 友好报错）。

【环境与流程约束】vitest / vite / cargo 拉新依赖 / `pnpm tauri build` / git push 需 `sandbox_permissions: danger-full-access`。**只读文件策略是逐次判定的**：每次写文件都要单独升级+授权，多文件改动前先请用户把会话切到 `workspace-write`（本会话已两次遇到）；策略切换后需重新 read 再 edit。`git commit -m` 消息不要含 ASCII 双引号。同一文件禁止在同一条消息里并发编辑。**上游行为/布局数值/框架内部实现类事实，动手前先读源码或 grep 核对，别凭记忆**（已因此踩过两次：误记 DisplayPanel 有 320px 滑块、漏一次 store 实例化）。
- [2026-09-21 18:17] [行动指南] 收尾状态：远端 5cf1ad5；PROJECT_MEMORY.md 受控导致每次记录后需再提交（两个方案待定）；push 需放宽沙箱 — model-viewer 本轮收尾状态：**远端 origin/main = 5cf1ad5**（本地与远端一致，工作区干净）。5cf1ad5 是 `chore(memory): 同步项目记忆（c06e4f0 提交推送状态与推送环境约束）`，只含 PROJECT_MEMORY.md 的 13 行更新；承载功能的提交是前一条 **c06e4f0**（34 文件：§36 性能优化 + §37 阴影与后处理 + §37.7 阴影 bug 修复）。

【环境约束｜每次收尾都会遇到】PROJECT_MEMORY.md **受版本控制**，而它由 dsh-memoir 自动维护 → **每次 memoir 记录后该文件都会变脏、需要再提交一次**；若这次提交动作又被记入记忆，就会再来一轮（本会话实际发生：c06e4f0 之后为补记该次提交又产生了 5cf1ad5）。两个候选方案**均未实施、待用户决定**：① 把 PROJECT_MEMORY.md 加入 .gitignore 并 `git rm --cached`，改为只在本地维护；② 保持现状，接受每次会话尾声多一个 `chore(memory)` 提交。属版本控制策略变更，不要擅自改。

【推送约束（已两次验证）】`git push` 必须 `sandbox_permissions: danger-full-access`：受限沙箱下 ssh 经 sh.exe 包装会报 `couldn't create signal pipe, Win32 error 5` / `Could not read from remote repository`（不是密钥问题）。用 `$env:GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20'` 加 `git push` 可一次成功。git commit 的 -m 消息避开 ASCII 双引号（PowerShell 会拆成 pathspec），多段内容用多个 -m 传；`git add/commit/log/status` 等纯本地命令不需要放宽。

【验证基线】vitest **498/498（42 文件）**、`scripts/diagnose-sfc.cjs` 15/15、`pnpm build` 成功；未跑 cargo test（零 Rust 改动）。

【仍未做（用户侧真机验收）】① 阴影是否真的出现（刚修的 bug，需用户确认；快照 shadow 段的 lightCasts / catcher 应为 true）；② 五个后处理通道的实际画面与兼容性（AO/泛光在半透明背景与「仅线框」下是否异常）；③ 用 §29.4 基准测 GTAO 默认开带来的性能代价 —— 数字仍缺。
- [2026-10-03 16:51] [行动指南] pnpm add 被目录 Windows 文件权限挡住（grantWrite/Win32 5）：用 diagnose-windows-sandbox-acl 脚本一次不受限修复后重跑 — 环境约束（Windows）：`pnpm add` 可能被**工作区目录的 Windows 文件权限**挡住，而不是网络或 pnpm 配置问题。

【现象】`pnpm add -D <packages>` 报 `SetNamedSecurityInfoW failed (Win32 5): grantWrite(E:\AI-Coding\model-viewer)`，进程直接退出、包没装。根因是该目录缺少 `WRITE_OWNER`（脚本观测：`writeDac=true, writeOwner=false`），pnpm 无法给自己配置工作区授权。

【处理路径（已走通一次）】用技能 `diagnose-windows-sandbox-acl` 的脚本，**一次不受限运行**（脚本要写权限，受限令牌下跑它只会把沙箱限制误报成缺权限）：
`& '<skill-dir>\scripts\diagnose-windows-sandbox-acl.ps1' -Path '<失败的目录>' -AllowRoot '<授权目录>' -Out '<持久的恢复目录>'`
它先备份、再给该目录补上当前登录用户的完全控制，并在同一轮自校验（本次 `writeOwner` false→true，verification=verified），最后打印逐条撤销的恢复命令。**随后重跑同一条 `pnpm add` 即成功**。
报告与备份落在 `E:\AI-Coding\dsh-acl-recovery\`（`acl-report-*.jsonl` + `acl-backup-*.json` 及其 `.ps1`）；恢复命令**未执行**（那次权限改动正是安装成功的前提）。注意该目录在工作区之外。

【复用要点】① 见到 `grantWrite(<workspace>)` / `SetNamedSecurityInfoW failed` 先想到**目录权限**，别去折腾 registry 或代理；② 脚本必须不受限运行，且**一次调用**即完成诊断+修复，不要拆成两次；③ 本项目的 `-Out` 不要放在技能资源目录（技能卸载即删）。

【同类经验（本会话已确认）】vitest / vite / cargo 拉新依赖 / `pnpm tauri build` / `git push` 在受限沙箱下都需 `sandbox_permissions: danger-full-access`：vitest 与 vite 是子进程命名管道限制（`spawn EPERM`），git push 是 ssh 经 `sh.exe` 包装（`couldn't create signal pipe`）。纯本地 git 命令与 `node scripts/diagnose-sfc.cjs` 不需要放宽。

## 备注 Notes

- [2026-09-17 10:18] [备注] 远端已建立：origin=git@github.com:shiNeZer0/model-viewer.git；push 需 danger-full-access；gc 已把 pack 从 47.79MiB 清到 2.87MiB — model-viewer 的远端仓库与环境约束（2026-09 建立，已验证推送成功）：

- **远端**：`origin` = `git@github.com:shiNeZer0/model-viewer.git`（SSH 协议），主分支 `main` 已 `-u` 跟踪 `origin/main`。
- **推送命令需要放宽沙箱**：`git push` 走 ssh 时 Git 会经 `sh.exe` 包装，在受限沙箱下报
  `sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5`，随后 git 报
  `Could not read from remote repository`。**这不是 SSH/密钥/权限问题**，是沙箱命名管道限制——
  用 `sandbox_permissions: danger-full-access` 重试同一条命令即可成功（本次即如此）。
  建议的 ssh 选项（避免交互卡住）：`GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"`。
  注意：`git add/commit/log/status/gc/fsck` 等纯本地命令**不需要**放宽，只有 push/pull 这类走 ssh 的才需要。
- **推送前体检结论（可复用）**：140 个受控文件，无 `node_modules/`、`src-tauri/target/`、`.env`、`.db`、密钥类文件入库；
  `.gitignore` 覆盖 node_modules/dist/target。
- **仓库体积已清理（已完成，2026-09）**：清理前 `in-pack: 12146 / size-pack: 47.79 MiB`，
  而可达对象合计只有约 4 MiB —— pack 里混着大量**不可达历史**（早期 `git add -A` 留下的悬空对象）。
  执行 `git gc --prune=now` 后：**pack 47.79 MiB → 2.87 MiB，对象 12146 → 424**，
  `git fsck` 无 error/missing，HEAD 未变且与 `origin/main` 一致、提交数仍为 24。
  **结论：以后遇到"可达文件很少但 pack 很大"，先用 `git rev-list --objects --all` 对比最大可达对象，
  确认是悬空对象后直接 `git gc --prune=now` 即可**（推送本来只传可达对象，所以清理纯属本地瘦身）。
- 注意：仓库根目录的 `PROJECT_MEMORY.md` 是 dsh-memoir 维护的记忆文件，**受版本控制**，记忆更新后需要一并提交再推送。
