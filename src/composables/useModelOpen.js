/**
 * 「打开模型」的编排逻辑：取来源 → 授权（桌面）→ 加载 → 上屏 → 记录。
 *
 * 组件只负责触发与展示；平台差异（系统对话框 vs file input、asset 协议 vs blob URL）
 * 全部由 src/platform 承担，这里只处理两端的共同流程。
 */

import { ElMessage } from 'element-plus'

import { LoadCancelledError, createLoadToken, loadModel } from '../core/three/ModelLoader.js'
import { collectModelStats } from '../core/three/stats.js'
import {
  capabilities,
  describeError,
  openModelAtPath,
  openModelSources,
  subscribeModelDrop,
} from '../platform/index.js'
import { touchRecentFile } from '../platform/storage/index.js'
import { useDisplayStore } from '../stores/displayStore.js'
import { useModelStore } from '../stores/modelStore.js'
import { useRecentStore } from '../stores/recentStore.js'
import { useSettingsStore } from '../stores/settingsStore.js'

/**
 * @param {import('vue').ShallowRef} engineRef useViewerEngine() 返回的引擎引用
 */
export function useModelOpen(engineRef) {
  const model = useModelStore()
  const settings = useSettingsStore()
  const display = useDisplayStore()
  const recent = useRecentStore()

  let currentToken = null
  /** 当前打开的来源句柄（Web 端持有 blob URL，需要在替换时释放） */
  let currentHandle = null

  /** 取消加载：three 的 loader 无法中断网络请求，这里只丢弃其结果 */
  function cancelLoading() {
    if (!currentToken) return
    currentToken.cancel()
    currentToken = null
    model.reset()
    ElMessage.info('已取消加载')
  }

  async function recordRecent(source) {
    try {
      await touchRecentFile({
        filePath: source.id,
        fileName: source.name,
        formatId: source.loadFormatId,
        sizeBytes: source.sizeBytes,
      })
      // 写成功后再刷新列表：新记录立刻出现、被重开的条目移到最前
      await recent.refresh()
    } catch (error) {
      // 最近文件只是便利功能，写失败不能影响查看模型
      console.warn('[useModelOpen] 写入最近文件失败', error)
    }
  }

  async function openSource(source) {
    const engine = engineRef.value
    if (!engine) {
      ElMessage.error('渲染器尚未就绪，请稍后重试')
      return
    }

    // 同一时刻只允许一个加载在途：新的加载会让旧的结果作废
    currentToken?.cancel()
    const token = createLoadToken()
    currentToken = token

    model.beginLoading({ path: source.id, fileName: source.name, formatId: source.loadFormatId })
    model.setSizeBytes(source.sizeBytes)
    for (const warning of source.warnings) model.addWarning(warning)

    const startedAt = performance.now()

    try {
      const result = await loadModel({
        url: source.url,
        formatId: source.loadFormatId,
        assetMap: source.assetMap,
        renderer: engine.renderer,
        token,
        onProgress: (event) => model.setProgress(event),
        onResourceError: (resourceUrl) => model.addMissingResource(resourceUrl),
      })
      if (token.cancelled) return

      // 上屏（引擎内部会释放上一个模型的 GPU 资源）+ 统计
      const { disposal, shadeWarnings } = engine.setModel(result.root, {
        fit: true,
        // 动画片段交给引擎建 AnimationMixer（有动画才会创建控制器）
        animations: result.animations,
        // 轴向修正需要知道格式（3MF 自动按 Z-up 处理）
        formatId: source.loadFormatId,
      })
      const stats = collectModelStats(result.root, { animationCount: result.animations.length })
      model.setReady({ root: result.root, stats })
      // loader 侧产生的提示（缺 MTL、3MF 单位说明等）一并展示
      for (const warning of result.warnings ?? []) model.addWarning(warning)
      // 着色模式相关的提示（如「模型过大已跳过线框」）交给显示面板展示
      if (shadeWarnings?.length) display.setNotes(shadeWarnings)

      if (disposal) {
        console.info('[useModelOpen] 切换模型时释放了上一个模型的资源', disposal)
      }

      ElMessage.success(`${source.name} 加载完成（${Math.round(performance.now() - startedAt)} ms）`)
      void recordRecent(source)
    } catch (error) {
      if (error instanceof LoadCancelledError) {
        model.reset()
        return
      }
      const message = describeError(error)
      model.setError(message)
      ElMessage.error(message)
    } finally {
      if (currentToken === token) currentToken = null
    }
  }

  /**
   * 打开一组来源。
   * 新来源的 blob URL 要等新模型上屏后再释放旧的，避免切换期间旧模型引用失效。
   */
  async function openFromSources(handle) {
    const sources = handle?.sources ?? []
    if (!sources.length) {
      ElMessage.error('所选文件中没有受支持的三维模型格式')
      handle?.dispose?.()
      return
    }

    const [first, ...rest] = sources
    if (rest.length) {
      ElMessage.info(`${capabilities.runtimeLabel}：一次只打开一个模型，已忽略其余 ${rest.length} 个文件`)
    }

    const previousHandle = currentHandle
    currentHandle = handle
    await openSource(first)
    previousHandle?.dispose?.()
  }

  /** 打开模型：桌面端弹系统对话框，Web 端弹文件选择框 */
  async function openViaDialog() {
    try {
      const handle = await openModelSources({ grantMode: settings.grantMode })
      await openFromSources(handle)
    } catch (error) {
      ElMessage.error(describeError(error))
    }
  }

  /**
   * 订阅拖放：桌面端走原生事件（绝对路径），Web 端走 HTML5 drop（File 对象）。
   * @param {HTMLElement|null} target HTML5 拖放目标（桌面端忽略）
   * @returns {Promise<Function>} 取消订阅函数
   */
  async function registerDropTarget(target = null) {
    try {
      return await subscribeModelDrop(target, async (handle) => {
        await openFromSources(handle)
      })
    } catch (error) {
      console.warn('[useModelOpen] 订阅拖放事件失败', error)
      return () => {}
    }
  }

  /**
   * 按历史路径重新打开（桌面端）。
   *
   * 关键点：**不能复用上次的内存授权** —— asset 协议 scope 只活在当前进程里，
   * 重开时必须对父目录重新走一遍 allow_asset_paths（openModelAtPath 内部完成）。
   * 路径已失效（文件被移动/删除/改名）时给出提示，并保留该条记录让用户自行移除。
   */
  async function openRecentPath(filePath) {
    if (!filePath) return
    try {
      const handle = await openModelAtPath(filePath, { grantMode: settings.grantMode })
      await openFromSources(handle)
    } catch (error) {
      ElMessage.error(`${describeError(error)}｜该记录可能已失效，可从最近列表中移除`)
    }
  }

  /** 适配视图：把相机拉到能完整看到模型的距离（M1 会增加标准视图预设） */
  function fitView() {
    engineRef.value?.fitToObject()
  }

  return { openViaDialog, openRecentPath, registerDropTarget, cancelLoading, fitView }
}
