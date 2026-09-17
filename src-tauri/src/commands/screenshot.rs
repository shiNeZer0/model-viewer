//! 截图落盘命令。
//!
//! 为什么需要一个 Rust 命令：`tauri-plugin-dialog` 只能给出用户选择的**路径**，
//! 真正写文件需要 fs 能力或自建命令。这里选择自建命令（不引 tauri-plugin-fs），
//! 好处是能把"只允许写 PNG、必须已有父目录、内容必须是 PNG"这些约束收在一处，并可单测。
//!
//! 数据流：画布 `toDataURL('image/png')` → 前端剥掉 data URL 前缀 → base64 经 IPC 传入 →
//! 这里解码并校验魔数后写盘。截图通常 1~5 MB，base64 的 1.33 倍开销可以接受，
//! 换来的是不必给 fs 插件开口子。

use std::path::{Path, PathBuf};

use serde::Serialize;

/// PNG 文件头（8 字节）
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// 落盘结果（前端 `save_screenshot` 的返回体）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub path: String,
    pub bytes: usize,
}

/// 单个 base64 字符 → 6 位值；非字母表字符返回 None
fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// 标准 base64 解码（要求 `=` 填充）。
///
/// 手写而不是引入依赖：只有一个用途（截图），且这样能把各类畸形输入都用单测钉死。
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    // 标准 base64（带 = 填充）长度必为 4 的倍数。前端来自 canvas.toDataURL，
    // 一定是这种形态；这里严格一些能更早发现传参被截断/污染。
    if input.len() % 4 != 0 {
        return Err("base64 长度不是 4 的倍数".to_string());
    }

    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    let mut padding = 0usize;

    for byte in input.as_bytes().iter().copied() {
        if byte == b'=' {
            padding += 1;
            continue;
        }
        if padding > 0 {
            return Err("填充符之后仍出现数据".to_string());
        }
        let value = base64_value(byte)
            .ok_or_else(|| format!("非法 base64 字符 {:?}", byte as char))?;
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xFF) as u8);
        }
    }

    if padding > 2 {
        return Err("填充符数量非法".to_string());
    }
    Ok(output)
}

/// 判定字节流是否为 PNG（只看文件头，足够拦下"前端传了别的东西"）
pub fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= PNG_SIGNATURE.len() && bytes[..PNG_SIGNATURE.len()] == PNG_SIGNATURE
}

/// 校验落盘目标：必须是 .png，且父目录必须已经存在。
///
/// 刻意**不**自动创建目录：用户选的路径若不存在，悄悄建一串目录比明确报错更让人困惑
/// （也更危险）。保存对话框本身就是选已有目录里的文件。
pub fn validate_target_path(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "png" {
        return Err(format!(
            "SCREENSHOT_INVALID_PATH: 目前只支持保存为 .png（收到 .{extension}）"
        ));
    }

    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    if file_name.is_empty() {
        return Err("SCREENSHOT_INVALID_PATH: 路径缺少文件名".to_string());
    }

    let parent = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| "SCREENSHOT_INVALID_PATH: 路径缺少目录".to_string())?;
    if !parent.is_dir() {
        return Err(format!(
            "SCREENSHOT_INVALID_PATH: 目录不存在 {}",
            parent.display()
        ));
    }
    Ok(())
}

/// 解码并写盘（同步实现，便于单测；命令层负责搬到 blocking 线程池）
pub fn save_blocking(target: &Path, base64: &str) -> Result<SavedImage, String> {
    validate_target_path(target)?;

    let bytes = decode_base64(base64).map_err(|detail| format!("SCREENSHOT_DECODE_FAILED: {detail}"))?;
    if bytes.is_empty() {
        return Err("SCREENSHOT_DECODE_FAILED: 图像数据为空".to_string());
    }
    if !is_png(&bytes) {
        return Err("SCREENSHOT_DECODE_FAILED: 解码结果不是 PNG 图像".to_string());
    }

    std::fs::write(target, &bytes).map_err(|error| {
        format!(
            "SCREENSHOT_WRITE_FAILED: 写入失败（{}）: {error}",
            target.display()
        )
    })?;

    Ok(SavedImage {
        path: target.to_string_lossy().into_owned(),
        bytes: bytes.len(),
    })
}

/// 把前端传来的 PNG（base64）写到用户选择的路径。
#[tauri::command]
pub async fn save_screenshot(path: String, base64: String) -> Result<SavedImage, String> {
    log::info!("save_screenshot 开始: {path}（base64 {} 字符）", base64.len());
    let target = PathBuf::from(&path);

    // 解码 + 写盘可能是 MB 级操作，放线程池，别占主线程
    let saved = tauri::async_runtime::spawn_blocking(move || save_blocking(&target, &base64))
        .await
        .map_err(|error| format!("SCREENSHOT_WRITE_FAILED: 内部任务失败 {error}"))?
        .map_err(|error| {
            log::warn!("save_screenshot 失败: {error}");
            error
        })?;

    log::info!("save_screenshot 完成: {}（{} 字节）", saved.path, saved.bytes);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(file_name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("mv-shot-{}-{stamp}-{file_name}", std::process::id()))
    }

    /// 最小合法 PNG：真实文件头 + 一点载荷
    fn sample_png_bytes() -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"\x00\x00\x00\rIHDR-fake-payload");
        bytes
    }

    fn base64_of(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let mut buffer = 0u32;
            for (index, byte) in chunk.iter().enumerate() {
                buffer |= (*byte as u32) << (16 - index * 8);
            }
            let padding = 3 - chunk.len();
            for group in 0..4 {
                if group >= 4 - padding {
                    out.push('=');
                } else {
                    let index = ((buffer >> (18 - group * 6)) & 0x3F) as usize;
                    out.push(ALPHABET[index] as char);
                }
            }
        }
        out
    }

    #[test]
    fn decode_base64_标准向量() {
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man".to_vec());
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma".to_vec());
        assert_eq!(decode_base64("TQ==").unwrap(), b"M".to_vec());
        // 中文字节（UTF-8）
        assert_eq!(decode_base64("5rWL6K+V").unwrap(), "测试".as_bytes().to_vec());
    }

    #[test]
    fn decode_base64_拒绝畸形输入() {
        assert!(decode_base64("!!!!").is_err());
        assert!(decode_base64("TWFu=").is_err()); // 填充符后仍有数据
        assert!(decode_base64("TWF").is_err()); // 长度不是 4 的倍数
        assert!(decode_base64("T===").is_err()); // 填充符过多
        assert!(decode_base64("5rWL 6K+V").is_err()); // 空白不被容忍（前端已剥离）
    }

    #[test]
    fn decode_base64_与自建编码器互逆() {
        let payload = sample_png_bytes();
        let encoded = base64_of(&payload);
        assert_eq!(decode_base64(&encoded).unwrap(), payload);
    }

    #[test]
    fn is_png_只看文件头() {
        assert!(is_png(&sample_png_bytes()));
        assert!(!is_png(b"GIF89a"));
        assert!(!is_png(&[]));
    }

    #[test]
    fn validate_target_path_约束() {
        let dir = std::env::temp_dir();
        assert!(validate_target_path(&dir.join("shot.png")).is_ok());
        assert!(validate_target_path(&dir.join("shot.PNG")).is_ok()); // 大小写不敏感

        let wrong_extension = validate_target_path(&dir.join("shot.jpg")).unwrap_err();
        assert!(wrong_extension.starts_with("SCREENSHOT_INVALID_PATH"));

        let missing_dir =
            validate_target_path(&dir.join("definitely-not-here-12345").join("shot.png"))
                .unwrap_err();
        assert!(missing_dir.contains("目录不存在"));

        let no_file_name = validate_target_path(&dir).unwrap_err();
        assert!(no_file_name.starts_with("SCREENSHOT_INVALID_PATH"));
    }

    #[test]
    fn save_blocking_端到端写盘() {
        let target = temp_path("ok.png");
        let payload = sample_png_bytes();
        let saved = save_blocking(&target, &base64_of(&payload)).unwrap();

        assert_eq!(saved.bytes, payload.len());
        assert_eq!(std::fs::read(&target).unwrap(), payload);
        assert!(saved.path.contains("ok.png"));

        std::fs::remove_file(&target).ok();
    }

    #[test]
    fn save_blocking_拒绝非PNG与空数据() {
        let target = temp_path("reject.png");
        let not_png = base64_of(b"GIF89a-not-a-png");
        assert!(save_blocking(&target, &not_png)
            .unwrap_err()
            .contains("不是 PNG"));

        assert!(save_blocking(&target, "").unwrap_err().contains("图像数据为空"));

        let bad_base64 = save_blocking(&target, "###").unwrap_err();
        assert!(bad_base64.starts_with("SCREENSHOT_DECODE_FAILED"));

        // 失败路径不应留下任何文件
        assert!(!target.exists());
    }

    #[test]
    fn save_blocking_路径不合规时不写盘() {
        let target = temp_path("wrong.jpg");
        let error = save_blocking(&target, &base64_of(&sample_png_bytes())).unwrap_err();
        assert!(error.starts_with("SCREENSHOT_INVALID_PATH"));
        assert!(!target.exists());
    }
}
