/**
 * 性能快照的文本化（纯函数，可单测）。
 *
 * 用途：把 ViewerEngine.getPerfSnapshot() 的结构化数据压成一段可粘贴的文本，
 * 让两次测量能逐行比对。本项目的真机帧率基准只能人工采集（无头环境测不出有意义的数字），
 * 这份文本就是比对的载体——没有它，"优化有没有效果"只能靠感觉。
 */

/** 数值缺失时的占位符：与真实的 0 区分开，避免把"没读到"误读成"开销为零" */
const DASH = '—'

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : DASH
}

/** 快照里**实际生效**的后处理 pass 名称（enabled === false 的会被 passes 循环跳过） */
export function activePassNames(postFx) {
  const passes = Array.isArray(postFx?.passes) ? postFx.passes : []
  return passes.filter((pass) => pass?.enabled !== false).map((pass) => pass.name ?? 'Pass')
}

/**
 * 语义层"真正在出效果"的通道名。
 * 与 activePassNames 的区别：这里用的是通道自己的恒等判定（饱和度=1、AO 强度=0 这类
 * 虽然开着但等于没开的情况会被排除），比看 pass 的 enabled 更贴近"实际跑了几趟"。
 */
export function activeChannelLabels(postFx) {
  const channels = Array.isArray(postFx?.channels) ? postFx.channels : []
  return channels
    .filter((channel) => channel?.enabled && !channel?.identity)
    .map((channel) => channel.label ?? channel.id ?? '通道')
}

/**
 * 把 getPerfSnapshot() 的结果格式化成多行文本。
 * @param {object} snapshot
 * @returns {string} 输入非法时返回空串（调用方可据此提示"渲染器尚未就绪"）
 */
export function formatPerfSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return ''

  const postFx = snapshot.postFx ?? {}
  const render = snapshot.render ?? {}
  const lighting = snapshot.lighting ?? {}
  const buffer = snapshot.drawingBuffer ?? {}
  const names = activePassNames(postFx)
  const channels = activeChannelLabels(postFx)

  return [
    `[性能快照] ${snapshot.at ?? DASH}`,
    `FPS=${num(snapshot.fps)}｜累计帧=${num(snapshot.renderedFrames)}｜循环=${
      snapshot.running ? '运行中' : '已空闲'
    }`,
    `绘制缓冲=${num(buffer.width)}×${num(buffer.height)}｜dpr=${num(
      snapshot.devicePixelRatio,
    )}｜像素比上限=${num(snapshot.pixelRatioLimit ?? snapshot.maxPixelRatio)}｜低性能模式=${
      snapshot.lowPerformance ? '开' : '关'
    }`,
    `后处理=${postFx.enabled ? '开' : '关'}｜MSAA=${num(postFx.samples)}｜色调映射=${
      postFx.toneMapping ?? DASH
    }｜曝光=${num(postFx.exposure)}｜饱和度=${num(postFx.saturation)}`,
    `生效 pass=${names.length ? names.join(' → ') : '无'}｜恒等饱和度 pass 已跳过=${
      postFx.saturationPassSkipped ? '是' : '否'
    }`,
    `效果通道=${channels.length ? channels.join('、') : '无'}`,
    `三角面=${num(render.triangles)}｜drawCall=${num(render.calls)}｜几何体=${num(
      render.geometries,
    )}｜贴图=${num(render.textures)}`,
    `平行光=${num(lighting.directional)}｜半球光=${
      lighting.hemisphere ? '开' : '关'
    }｜空闲阈值=${num(snapshot.idleMs)}ms`,
    `GPU=${snapshot.gpu ?? DASH}｜${snapshot.webglVersion ?? DASH}`,
  ].join('\n')
}
