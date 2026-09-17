//! 导入环境贴图（HDR / EXR）的落盘命令。
//!
//! 前端选到文件后调用这里把它**复制进应用数据目录** `~/.model-viewer/app/env/`：
//! - asset 协议的读取权限只在本次运行内有效，主题要能跨会话复现就必须有一个稳定路径；
//! - 复制之后用户移动/删除原文件也不会让已保存的主题失效。
//!
//! 文件名带**内容哈希**：同一个文件重复导入不会产生第二份副本，不同文件同名也不会互相覆盖。
//! 哈希用自实现的 FNV-1a，而不是 `DefaultHasher` —— 后者明确不保证跨版本稳定，
//! 一旦变化会让旧主题指向一个不存在的文件名。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{asset_scope::EnvironmentFormat, paths};

/// FNV-1a 64 位：实现短、结果完全确定，用于文件名去重足够
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 把任意名字收敛成安全的文件名主干：去掉路径分隔符与 Windows 非法字符
pub fn sanitize_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    // 只留空/全点的名字退回默认值，避免出现 ".hdr" 这种隐藏文件
    if trimmed.is_empty() {
        "environment".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 副本文件名：`studio-1a2b3c4d5e6f7788.hdr`
pub fn stored_file_name(stem: &str, hash: u64, extension: &str) -> String {
    format!("{}-{:016x}.{}", stem, hash, extension)
}

/// 导入结果（前端 `store_environment_map` 的返回体）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEnvironment {
    /// 副本的绝对路径（前端拿它去授权并作为 asset URL 的来源）
    pub stored_path: String,
    pub file_name: String,
    pub bytes: u64,
    /// true = 之前已有一份内容相同的副本，本次没有重复复制
    pub reused: bool,
    /// 原始文件名（用于界面展示"导入自 xxx.hdr"）
    pub source_name: String,
}

/// 校验源文件并算出目标目录（纯逻辑，便于单测）
fn plan_store(source: &Path, target_dir: &Path) -> Result<(EnvironmentFormat, String), String> {
    if !source.exists() {
        return Err(format!("FILE_NOT_FOUND: {}", source.display()));
    }
    let metadata = std::fs::metadata(source)
        .map_err(|error| format!("IO_ERROR: 读取文件信息失败: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("NOT_A_FILE: {}", source.display()));
    }
    if metadata.len() == 0 {
        return Err("ENVIRONMENT_EMPTY: 环境贴图文件为空".to_string());
    }

    let format = EnvironmentFormat::from_path(source)
        .ok_or_else(|| "ENVIRONMENT_UNSUPPORTED: 只支持 .hdr 与 .exr 环境贴图".to_string())?;
    let _ = target_dir;
    Ok((format, format.as_str().to_string()))
}

/// 同步实现（命令层搬到 blocking 线程池）；`target_dir` 显式传入以便测试用临时目录
pub fn store_blocking(source: &Path, target_dir: &Path) -> Result<StoredEnvironment, String> {
    let (format, extension) = plan_store(source, target_dir)?;

    let bytes = std::fs::read(source).map_err(|error| {
        format!("IO_ERROR: 读取环境贴图失败（{}）: {error}", source.display())
    })?;

    let source_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("environment.{extension}"));
    let stem = sanitize_stem(
        source
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
            .as_str(),
    );
    let file_name = stored_file_name(&stem, fnv1a64(&bytes), format.as_str());
    let target = target_dir.join(&file_name);

    // 内容相同则复用（同哈希 → 同文件名 → 内容必然相同）
    let reused = target.is_file();
    if !reused {
        paths::ensure_dir(target_dir)?;
        std::fs::write(&target, &bytes).map_err(|error| {
            format!("IO_ERROR: 写入环境贴图副本失败（{}）: {error}", target.display())
        })?;
    }

    Ok(StoredEnvironment {
        stored_path: target.to_string_lossy().into_owned(),
        file_name,
        bytes: bytes.len() as u64,
        reused,
        source_name,
    })
}

/// 把用户选择的 HDR/EXR 复制进应用数据目录，返回副本路径。
#[tauri::command]
pub async fn store_environment_map(path: String) -> Result<StoredEnvironment, String> {
    log::info!("store_environment_map 开始: {path}");
    let source = PathBuf::from(&path);
    let target_dir = paths::environment_dir()?;

    let stored = tauri::async_runtime::spawn_blocking(move || store_blocking(&source, &target_dir))
        .await
        .map_err(|error| format!("IO_ERROR: 内部任务失败 {error}"))?
        .map_err(|error| {
            log::warn!("store_environment_map 失败: {error}");
            error
        })?;

    log::info!(
        "store_environment_map 完成: {}（{} 字节，复用={}）",
        stored.file_name,
        stored.bytes,
        stored.reused
    );
    Ok(stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mv-env-{}-{tag}", std::process::id()));
        // 先清干净：本进程里重复跑测试时残留文件会让"目录里有几个文件"的断言失真
        std::fs::remove_dir_all(&dir).ok();
        paths::ensure_dir(&dir).unwrap();
        dir
    }

    fn write_sample(dir: &Path, name: &str, payload: &[u8]) -> PathBuf {
        paths::ensure_dir(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, payload).unwrap();
        path
    }

    #[test]
    fn fnv1a64_结果稳定且对内容敏感() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_ne!(fnv1a64(b"a"), fnv1a64(b"b"));
    }

    #[test]
    fn sanitize_stem_去掉路径与非法字符() {
        assert_eq!(sanitize_stem("studio"), "studio");
        assert_eq!(sanitize_stem("C:\\env\\studio"), "C__env_studio");
        assert_eq!(sanitize_stem("a:b*c?"), "a_b_c_");
        assert_eq!(sanitize_stem(""), "environment");
        assert_eq!(sanitize_stem("   "), "environment");
        // 以点开头会被当成隐藏文件，这里去掉
        assert_eq!(sanitize_stem(".hidden"), "hidden");
    }

    #[test]
    fn stored_file_name_带十六位哈希() {
        assert_eq!(
            stored_file_name("studio", 0x1a2b_3c4d_5e6f_7788, "hdr"),
            "studio-1a2b3c4d5e6f7788.hdr"
        );
    }

    #[test]
    fn store_blocking_复制进目标目录并去重() {
        let source_dir = temp_dir("src");
        let target_dir = temp_dir("dst");
        let payload = b"#?RADIANCE\nfake-hdr-payload";
        let source = write_sample(&source_dir, "studio.hdr", payload);

        let first = store_blocking(&source, &target_dir).unwrap();
        assert!(!first.reused);
        assert_eq!(first.source_name, "studio.hdr");
        assert_eq!(first.bytes, payload.len() as u64);
        assert!(first.file_name.starts_with("studio-"));
        assert!(first.file_name.ends_with(".hdr"));
        assert_eq!(std::fs::read(&first.stored_path).unwrap(), payload);

        // 同一内容再导入一次：复用同一份副本，不产生第二个文件
        let second = store_blocking(&source, &target_dir).unwrap();
        assert!(second.reused);
        assert_eq!(second.stored_path, first.stored_path);
        let count = std::fs::read_dir(&target_dir).unwrap().count();
        assert_eq!(count, 1);

        // 内容不同则生成第二个文件
        let other = write_sample(&source_dir, "studio.hdr", b"#?RADIANCE\nanother-payload");
        let third = store_blocking(&other, &target_dir).unwrap();
        assert!(!third.reused);
        assert_ne!(third.stored_path, first.stored_path);
        assert_eq!(std::fs::read_dir(&target_dir).unwrap().count(), 2);

        std::fs::remove_dir_all(&source_dir).ok();
        std::fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn store_blocking_拒绝非环境贴图与空文件() {
        let source_dir = temp_dir("reject");
        let target_dir = temp_dir("reject-dst");

        let png = write_sample(&source_dir, "sky.png", b"\x89PNG\r\n\x1a\n");
        assert!(store_blocking(&png, &target_dir)
            .unwrap_err()
            .starts_with("ENVIRONMENT_UNSUPPORTED"));

        let empty = write_sample(&source_dir, "empty.exr", b"");
        assert!(store_blocking(&empty, &target_dir)
            .unwrap_err()
            .starts_with("ENVIRONMENT_EMPTY"));

        assert!(store_blocking(&source_dir.join("missing.hdr"), &target_dir)
            .unwrap_err()
            .starts_with("FILE_NOT_FOUND"));

        // 目录而不是文件
        assert!(store_blocking(&source_dir, &target_dir)
            .unwrap_err()
            .starts_with("NOT_A_FILE"));

        // 失败路径不应往目标目录里写东西
        assert_eq!(std::fs::read_dir(&target_dir).unwrap().count(), 0);

        std::fs::remove_dir_all(&source_dir).ok();
        std::fs::remove_dir_all(&target_dir).ok();
    }
}
