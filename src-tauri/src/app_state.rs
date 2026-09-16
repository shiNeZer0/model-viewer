//! 运行时状态：本进程内已授予 asset 协议访问权的路径集合。
//!
//! 职责划分：
//! - Rust 侧只维护“本次运行期间”的授权（因为 scope 是进程内状态）；
//! - 持久化由前端写入 `granted_dirs` 表，启动时再回灌进来（见设计文档 §5.2）。

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

/// 一条授权记录。`is_dir` 决定撤销时调用 forbid_directory 还是 forbid_file。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantRecord {
    pub path: PathBuf,
    pub is_dir: bool,
    pub recursive: bool,
    pub granted_at_ms: u64,
}

impl GrantRecord {
    pub fn new(path: PathBuf, is_dir: bool, recursive: bool) -> Self {
        Self {
            path,
            is_dir,
            recursive,
            granted_at_ms: now_ms(),
        }
    }
}

/// 当前 UNIX 时间戳（毫秒）。取不到系统时间时回退 0，避免因时钟问题让授权失败。
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct AppState {
    grants: Mutex<Vec<GrantRecord>>,
}

impl AppState {
    /// 互斥锁被 poison 时继续取用内部数据：授权状态不值得让整个进程 panic。
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<GrantRecord>> {
        self.grants.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Vec<GrantRecord> {
        self.lock().clone()
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// 幂等插入；已存在同路径同语义的记录时返回 false。
    pub fn insert(&self, record: GrantRecord) -> bool {
        let mut grants = self.lock();
        let duplicated = grants
            .iter()
            .any(|g| g.path == record.path && g.is_dir == record.is_dir && g.recursive == record.recursive);
        if duplicated {
            return false;
        }
        grants.push(record);
        true
    }

    /// 是否已存在“覆盖”该请求的授权：
    /// 1) 同路径且已有授权的递归能力不弱于请求；
    /// 2) 或该路径位于某个已递归授权目录之下（避免同一目录下多个文件占满额度）。
    pub fn covers(&self, path: &Path, is_dir: bool, recursive: bool) -> bool {
        self.lock().iter().any(|grant| {
            if grant.path == path && grant.is_dir == is_dir && (grant.recursive || !recursive) {
                return true;
            }
            grant.is_dir && grant.recursive && path.starts_with(&grant.path)
        })
    }

    /// 清空并返回原记录，供撤销时逐条 forbid。
    pub fn clear(&self) -> Vec<GrantRecord> {
        std::mem::take(&mut *self.lock())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(path: &str, is_dir: bool, recursive: bool) -> GrantRecord {
        GrantRecord::new(PathBuf::from(path), is_dir, recursive)
    }

    #[test]
    fn insert_is_idempotent() {
        let state = AppState::default();
        assert!(state.insert(rec("E:\\models", true, true)));
        assert!(!state.insert(rec("E:\\models", true, true)));
        assert_eq!(state.len(), 1);
    }

    #[test]
    fn same_path_with_different_recursive_is_distinct() {
        let state = AppState::default();
        assert!(state.insert(rec("E:\\models", true, false)));
        assert!(state.insert(rec("E:\\models", true, true)));
        assert_eq!(state.len(), 2);
    }

    #[test]
    fn covers_accepts_weaker_request() {
        let state = AppState::default();
        state.insert(rec("E:\\models", true, true));
        assert!(state.covers(Path::new("E:\\models"), true, false));
        assert!(state.covers(Path::new("E:\\models"), true, true));
    }

    #[test]
    fn recursive_grant_covers_descendants() {
        let state = AppState::default();
        state.insert(rec("E:\\models", true, true));
        assert!(state.covers(Path::new("E:\\models\\sub\\a.glb"), false, false));
        assert!(state.covers(Path::new("E:\\models\\a.obj"), false, false));
        // 前缀相同但不是子目录，不能算覆盖
        assert!(!state.covers(Path::new("E:\\models2\\a.glb"), false, false));
    }

    #[test]
    fn non_recursive_grant_does_not_cover_descendants() {
        let state = AppState::default();
        state.insert(rec("E:\\models", true, false));
        assert!(!state.covers(Path::new("E:\\models\\sub\\a.glb"), false, false));
        assert!(!state.covers(Path::new("E:\\models\\a.obj"), false, false));
    }

    #[test]
    fn covers_rejects_stronger_request_and_other_kind() {
        let state = AppState::default();
        state.insert(rec("E:\\models", true, false));
        // 已有授权不是递归的，无法覆盖递归请求
        assert!(!state.covers(Path::new("E:\\models"), true, true));
        // 目录授权不覆盖同名文件授权
        assert!(!state.covers(Path::new("E:\\models"), false, false));
        assert!(!state.covers(Path::new("E:\\other"), true, false));
    }

    #[test]
    fn clear_drains_records() {
        let state = AppState::default();
        state.insert(rec("E:\\a", true, true));
        state.insert(rec("E:\\b", false, false));
        let cleared = state.clear();
        assert_eq!(cleared.len(), 2);
        assert_eq!(state.len(), 0);
    }
}
