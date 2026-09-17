# 三维模型查看器（model-viewer）

参考微软已下架的 **3D 查看器**，用 Tauri 2 + Vue 3 + Element Plus + Three.js 实现的三维模型查看器。

**同一份代码同时支持两种形态**：

| 形态 | 运行方式 | 打开文件的方式 | 持久化 |
|---|---|---|---|
| 桌面版 | Tauri 2 + WebView2 | 系统对话框 / 从资源管理器拖入（走 asset 协议） | SQLite（`~/.model-viewer/app/app.db`） |
| Web 预览 | 任意静态托管 / 开发服务器 | 文件选择框 / 拖入页面 | localStorage |

## 环境要求

- Node.js 22（见 `.nvmrc`）+ pnpm（**不使用 npm**，仓库已删除 `package-lock.json`）
- Rust stable-msvc + Visual Studio 生成工具（桌面版必需）
- Windows 需安装 WebView2 运行时（Win11 自带）

## 常用命令

```bash
pnpm install            # 安装依赖（构建时会自动复制 Draco/Basis 解码器到 public/）

# 开发
pnpm tauri dev          # 桌面版开发（Tauri 会自动拉起 vite:5173 并打开窗口）
pnpm dev                # 仅前端；浏览器打开 http://localhost:5173 即为 Web 预览模式

# 构建
pnpm tauri build        # 桌面安装包（内部执行 pnpm build，base=/）
pnpm build:web          # Web 构建（base=./，可直接部署到静态托管的子目录）
pnpm preview            # 本地托管 dist/ 预览 Web 构建产物

# 测试
pnpm test               # 前端单测（vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 单测
```

> 若依赖的构建脚本被 pnpm 拦截，检查 `pnpm-workspace.yaml` 的 `allowBuilds`。

## 已实现

**M0 — 打开与查看**

- 打开 / 拖入 **GLB、GLTF、STL**，自动适配视图，支持旋转、平移、缩放与**转盘模式**
- 模型统计：网格数、顶点数、三角面数、材质与贴图数、点/线数、骨骼蒙皮
- **格式真实性校验**：按文件头魔数嗅探，扩展名与真实格式不一致时按真实格式加载并提示
- 内置 **Draco / KTX2(Basis) / Meshopt** 解码能力（解码器本地化，完全离线）
- 桌面端的安全授权模型：只对用户主动打开/拖入的文件所在目录开放 asset 协议读取，可在设置页查看与撤销
- 外部资源缺失（`.bin` / `.mtl` / 贴图）不静默失败，会在信息面板列出

**M1 — 相机与显示**

- **7 个标准视图**（前/后/左/右/顶/底/等轴测）+ 重置视图；快捷键 `1`~`7` / `F` / `R` / `T` / `W`
- **8 种着色模式**：实体(贴图)、实体(无贴图)、平面着色、实体+线框、仅线框、顶点色、法线、UV 棋盘格；
  切换只换材质引用，切回后原始材质 100% 还原；线框有两道面数阈值保护（超限退化为结构边或跳过并提示）
- **背景**：纯色 / 渐变 / 真透明（棋盘格）；**坐标轴**（带 X/Y/Z 标签）与自适应地面网格
- **后处理**：色调映射（无/线性/ACES/AgX/Neutral）、曝光、饱和度；可整体关闭退回直渲路径
- **空闲停渲染**：静止 N 秒后彻底停掉 rAF（CPU 归零），任意操作自动唤醒
- 显示设置会持久化（桌面 SQLite / Web localStorage）

**M2 — 模型检查**

- **层级树**：完整对象树（节点名/类型/三角面数），支持逐节点**显示隐藏**、**聚焦**（相机对准该节点）、全部显示/隐藏/重置；
  用户的手动隐藏会被单独记录，切着色模式或重新摆放都不会被覆盖；节点数超过 5000 会截断显示并提示
- **边界框与尺寸**：Box3Helper 线框 + CSS2D 长宽高标注 + 最小角坐标（快捷键 `B`）
- **单位换算**：可声明模型原始单位（mm/cm/m/in），尺寸换算为易读单位（支持自动挑选）；默认按原始数值显示，避免给出虚假精度
- 以上设置均持久化

**M3 — 光照与环境**

- **三点光源**：主光 / 补光 / 轮廓光，各自可调启用、强度、颜色、方位、仰角、半径
- **环境贴图（IBL）**：程序化渐变 / RoomEnvironment（影棚）/ 关闭，可调强度与天空·地平·地面三色；
  支持把环境贴图直接当作背景（全景观感）
- **半球环境光**：可开关并调节强度与天空/地面色
- **5 个内置光照预设**：影棚 / 黄昏 / 森林 / 全景 / 无环境（切换预设会同时套用它的背景与色调）
- **自定义光照主题**：把当前「光照 + 背景 + 色调」存为主题，支持应用/重命名/删除，持久化到数据库

## 计划中

| 里程碑 | 内容 |
|---|---|
| M4 | 动画片段选择与播放控制（播放/暂停/停止/倍速） |
| M5 | FBX、OBJ(+MTL)、PLY、3MF |
| M6 | 最近文件、文件关联（双击打开）、截图导出、打包与性能回归 |

## 目录结构

```
src/
  platform/          平台适配层（唯一的双端差异所在）
    tauri.js         桌面后端：系统对话框、asset 协议授权、原生拖放
    web.js           Web 后端：file input、blob URL、HTML5 拖放
    storage/         持久化后端：tauri-sqlite / web-local
    sniff.js         文件头格式嗅探（与 Rust 共享测试向量）
  core/three/        Three.js 引擎层（与框架无关，可单测的部分已抽为纯函数）
  components/        UI 组件（layout / viewer / panels 分层）
  composables/       流程编排（打开模型、引擎生命周期）
  stores/            Pinia 状态
src-tauri/
  src/asset_scope.rs 格式判定、授权计划与受保护目录（纯逻辑 + 单测）
  src/commands/      按功能拆分的 Tauri 命令（全部 async + 日志）
  migrations/        SQLite 迁移（append-only）
tests/fixtures/      前后端共用的测试数据（格式嗅探向量）
docs/设计文档.md      完整设计方案与接口契约
```

## 已知限制

- **Web 预览**：浏览器无法访问本地路径，因此不能按路径重新打开、没有目录授权与文件关联；多文件格式（glTF + `.bin` + 贴图、OBJ + `.mtl`）必须**一次全选**，否则外部资源会缺失。
- 未实现的格式在界面上有明确标注，不会被静默忽略。

## 开发约定

见 `CLAUDE.md`（设计文档要求、前后端编码规范、跨平台注意事项）。
