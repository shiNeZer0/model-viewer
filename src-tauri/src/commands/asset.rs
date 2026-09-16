//! 文件探测与 asset 协议授权相关命令。
//!
//! 全部命令都是 `async`，文件 IO 通过 `spawn_blocking` 移到线程池，避免阻塞主线程；
//! 每个命令的关键节点都有日志，便于通过 `~/.model-viewer/app/app.log` 排障。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    app_state::{AppState, GrantRecord},
    asset_scope::{
        ensure_dir_grantable, extension_label, is_zip_container, plan_grant, sniff_format,
        GrantError, GrantMode, GrantPlan, ModelFormat, MAX_GRANTED_PATHS, PROBE_HEAD_BYTES,
    },
};

/// 打开模型前的探测结果（前端 `probe_model_file` 的返回体）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProbe {
    pub path: String,
    pub file_name: String,
    pub exists: bool,
    pub format: Option<String>,
    pub sniffed_format: Option<String>,
    pub mismatched: bool,
    pub size_bytes: u64,
    pub modified_at_ms: Option<u64>,
    pub is_zip_container: bool,
}

/// 单条授权结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetGrant {
    pub path: String,
    pub file_name: String,
    pub format: String,
    pub size_bytes: u64,
    pub granted_directory: Option<String>,
    pub granted_recursive: bool,
    pub newly_granted: bool,
}

/// 单条授权失败（批量调用时不想因一个坏文件丢掉全部结果）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantFailure {
    pub path: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowReport {
    pub grants: Vec<AssetGrant>,
    pub errors: Vec<GrantFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantInfo {
    pub path: String,
    pub is_directory: bool,
    pub recursive: bool,
    pub granted_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeReport {
    pub revoked: usize,
}

/// 读取文件头部用于格式嗅探；一次 read 可能不足量，这里循环补齐
fn read_head(path: &Path, max_bytes: usize) -> Result<Vec<u8>, GrantError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|error| GrantError::from_io(error, path))?;
    let mut buffer = vec![0u8; max_bytes];
    let mut filled = 0usize;
    while filled < max_bytes {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(GrantError::from_io(error, path)),
        }
    }
    buffer.truncate(filled);
    Ok(buffer)
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn modified_at_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn probe_blocking(path: &Path) -> Result<FileProbe, GrantError> {
    if !path.exists() {
        return Err(GrantError::FileNotFound(path.to_path_buf()));
    }
    let metadata = std::fs::metadata(path).map_err(|error| GrantError::from_io(error, path))?;
    if !metadata.is_file() {
        return Err(GrantError::NotAFile(path.to_path_buf()));
    }

    let declared = ModelFormat::from_path(path);
    if declared.is_none() {
        return Err(GrantError::UnsupportedFormat(extension_label(path)));
    }

    let head = read_head(path, PROBE_HEAD_BYTES)?;
    let sniffed = sniff_format(&head, metadata.len());
    let mismatched = matches!((declared, sniffed), (Some(a), Some(b)) if a != b);

    Ok(FileProbe {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name_of(path),
        exists: true,
        format: declared.map(|format| format.as_str().to_string()),
        sniffed_format: sniffed.map(|format| format.as_str().to_string()),
        mismatched,
        size_bytes: metadata.len(),
        modified_at_ms: modified_at_ms(&metadata),
        is_zip_container: is_zip_container(&head),
    })
}

struct PreparedGrant {
    plan: GrantPlan,
    size_bytes: u64,
}

fn prepare_grant(path: &Path, mode: GrantMode) -> Result<PreparedGrant, GrantError> {
    if !path.exists() {
        return Err(GrantError::FileNotFound(path.to_path_buf()));
    }
    let metadata = std::fs::metadata(path).map_err(|error| GrantError::from_io(error, path))?;
    if !metadata.is_file() {
        return Err(GrantError::NotAFile(path.to_path_buf()));
    }

    let plan = plan_grant(path, mode)?;
    ensure_dir_grantable(&plan, dirs::home_dir().as_deref())?;

    Ok(PreparedGrant {
        plan,
        size_bytes: metadata.len(),
    })
}

/// 把授权计划落到 asset 协议 scope 上。已覆盖则跳过（幂等），返回是否新授予。
fn apply_grant(app: &AppHandle, state: &AppState, prepared: &PreparedGrant) -> Result<bool, GrantError> {
    let plan = &prepared.plan;
    let (target, is_dir, recursive) = match &plan.dir {
        Some(dir) => (dir.clone(), true, plan.recursive),
        None => (plan.file.clone(), false, false),
    };

    if state.covers(&target, is_dir, recursive) {
        return Ok(false);
    }
    if state.len() >= MAX_GRANTED_PATHS {
        return Err(GrantError::LimitExceeded(MAX_GRANTED_PATHS));
    }

    let scope = app.asset_protocol_scope();
    let applied = if is_dir {
        scope.allow_directory(&target, recursive)
    } else {
        scope.allow_file(&target)
    };
    applied.map_err(|error| GrantError::ScopeApply(error.to_string()))?;

    state.insert(GrantRecord::new(target, is_dir, recursive));
    Ok(true)
}

/// 探测模型文件：存在性、扩展名、真实格式（魔数）、大小与修改时间。
/// 失败时返回带错误码的字符串（如 `UNSUPPORTED_FORMAT: .txt`）。
#[tauri::command]
pub async fn probe_model_file(path: String) -> Result<FileProbe, String> {
    log::info!("probe_model_file 开始: {path}");
    let target = PathBuf::from(&path);

    let probe = tauri::async_runtime::spawn_blocking(move || probe_blocking(&target))
        .await
        .map_err(|error| format!("PROBE_FAILED: 内部任务失败 {error}"))?
        .map_err(|error| {
            let code = error.code();
            log::warn!("probe_model_file 失败: {code}");
            code
        })?;

    log::info!(
        "probe_model_file 完成: {} 扩展名={:?} 嗅探={:?} 大小={} 字节",
        probe.file_name,
        probe.format,
        probe.sniffed_format,
        probe.size_bytes
    );
    Ok(probe)
}

/// 为用户选中的（或拖入的）模型文件授予 asset 协议读取权限。
///
/// 单文件调用时，若失败直接以 `Err(错误码)` 返回；批量调用（如启动时回灌历史授权）
/// 则逐条返回，避免一个坏路径让全部授权作废。
#[tauri::command]
pub async fn allow_asset_paths(
    app: AppHandle,
    paths: Vec<String>,
    grant_mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<AllowReport, String> {
    let mode = GrantMode::parse(grant_mode.as_deref()).map_err(|error| error.code())?;
    let requested_count = paths.len();
    let targets: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    log::info!("allow_asset_paths 开始: {requested_count} 个路径, 模式={mode:?}");

    let prepared = tauri::async_runtime::spawn_blocking(move || {
        targets
            .into_iter()
            .map(|path| {
                let result = prepare_grant(&path, mode);
                (path, result)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| format!("GRANT_FAILED: 内部任务失败 {error}"))?;

    let mut report = AllowReport {
        grants: Vec::new(),
        errors: Vec::new(),
    };

    for (path, result) in prepared {
        match result {
            Err(error) => {
                let code = error.code();
                log::warn!("授权失败 {}: {code}", path.display());
                report.errors.push(GrantFailure {
                    path: path.to_string_lossy().into_owned(),
                    code,
                });
            }
            Ok(prepared_grant) => match apply_grant(&app, &state, &prepared_grant) {
                Ok(newly_granted) => {
                    let plan = &prepared_grant.plan;
                    log::info!(
                        "授权成功 {}: 目录={:?} 递归={} 新增={}",
                        path.display(),
                        plan.dir,
                        plan.recursive,
                        newly_granted
                    );
                    report.grants.push(AssetGrant {
                        path: path.to_string_lossy().into_owned(),
                        file_name: file_name_of(&path),
                        format: plan.format.as_str().to_string(),
                        size_bytes: prepared_grant.size_bytes,
                        granted_directory: plan
                            .dir
                            .as_ref()
                            .map(|dir| dir.to_string_lossy().into_owned()),
                        granted_recursive: plan.dir.is_some() && plan.recursive,
                        newly_granted,
                    });
                }
                Err(error) => {
                    let code = error.code();
                    log::warn!("授权落地失败 {}: {code}", path.display());
                    report.errors.push(GrantFailure {
                        path: path.to_string_lossy().into_owned(),
                        code,
                    });
                }
            },
        }
    }

    log::info!(
        "allow_asset_paths 完成: 成功 {} 条, 失败 {} 条",
        report.grants.len(),
        report.errors.len()
    );

    if requested_count == 1 && report.grants.is_empty() && report.errors.len() == 1 {
        return Err(report.errors.remove(0).code);
    }

    Ok(report)
}

/// 本次运行期间已授予的路径清单（供设置页展示）
#[tauri::command]
pub async fn list_asset_grants(state: State<'_, AppState>) -> Result<Vec<GrantInfo>, String> {
    let grants = state
        .snapshot()
        .into_iter()
        .map(|record| GrantInfo {
            path: record.path.to_string_lossy().into_owned(),
            is_directory: record.is_dir,
            recursive: record.recursive,
            granted_at_ms: record.granted_at_ms,
        })
        .collect::<Vec<_>>();
    log::info!("list_asset_grants: {} 条", grants.len());
    Ok(grants)
}

/// 撤销全部授权。
///
/// Tauri 的 scope 没有“清空”接口，但 `forbid_*` 的优先级高于 allow（见 tauri scope 源码注释），
/// 因此对每个已授权路径追加禁止规则即可达到撤销效果。
#[tauri::command]
pub async fn revoke_asset_grants(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RevokeReport, String> {
    let records = state.clear();
    let scope = app.asset_protocol_scope();
    let mut revoked = 0usize;

    for record in &records {
        let result = if record.is_dir {
            scope.forbid_directory(&record.path, record.recursive)
        } else {
            scope.forbid_file(&record.path)
        };
        match result {
            Ok(()) => revoked += 1,
            Err(error) => log::error!("撤销授权失败 {}: {error}", record.path.display()),
        }
    }

    log::info!("revoke_asset_grants: 已撤销 {revoked}/{} 条", records.len());
    Ok(RevokeReport { revoked })
}
