/**
 * 错误码 → 用户可读文案（纯函数，可单测）。
 *
 * 后端统一以 `CODE: 详情` 的字符串形式返回错误（见 asset_scope.rs 的 GrantError::code），
 * 这里把错误码翻译成中文提示，避免把技术细节直接甩给用户。
 */

const ERROR_TEMPLATES = {
  UNSUPPORTED_FORMAT: (detail) => `不支持的文件格式：${detail}`,
  FILE_NOT_FOUND: (detail) => `文件不存在：${detail}`,
  NOT_A_FILE: (detail) => `该路径不是文件：${detail}`,
  PERMISSION_DENIED: (detail) => `没有读取权限：${detail}`,
  GRANT_REFUSED_PROTECTED_DIR: (detail) =>
    `出于安全考虑，拒绝对该目录整树授权（磁盘根目录或用户主目录）：${detail}`,
  GRANT_LIMIT_EXCEEDED: (detail) =>
    `已授权路径数量达到上限（${detail}），请在设置页撤销部分授权后重试`,
  INVALID_GRANT_MODE: (detail) => `授权模式非法：${detail}`,
  IO_ERROR: (detail) => `读取文件失败：${detail}`,
  GRANT_APPLY_FAILED: (detail) => `授权失败：${detail}`,
  GRANT_FAILED: (detail) => `授权过程出错：${detail}`,
  PROBE_FAILED: (detail) => `文件探测失败：${detail}`,
  LOAD_FAILED: (detail) => `模型解析失败：${detail}`,
  FORMAT_NOT_IMPLEMENTED: (detail) => `该格式的加载器尚未实现（计划在 M5 提供）：${detail}`,
  LOAD_CANCELLED: () => '已取消加载',
}

/** 把任意抛出物归一成字符串 */
export function rawErrorMessage(error) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error.message === 'string') return error.message
  return String(error ?? '')
}

/** 拆出 `CODE: 详情`，解析失败时返回 null */
export function splitErrorCode(message) {
  if (typeof message !== 'string') return null
  const separatorIndex = message.indexOf(':')
  if (separatorIndex <= 0) return null
  const code = message.slice(0, separatorIndex).trim()
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return null
  return { code, detail: message.slice(separatorIndex + 1).trim() }
}

/** 面向用户的错误文案；未知错误码原样返回，避免信息丢失 */
export function describeError(error) {
  const message = rawErrorMessage(error)
  const split = splitErrorCode(message)
  if (!split) return message || '未知错误'
  const template = ERROR_TEMPLATES[split.code]
  return template ? template(split.detail) : message
}
