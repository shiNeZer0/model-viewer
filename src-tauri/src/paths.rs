//! 应用数据目录的唯一事实源。
//!
//! lib.rs 需要它来放日志与数据库，环境贴图导入需要它来放副本；
//! 两处各写一遍 `home/.model-viewer/app` 迟早会漂移，因此集中在这里。

use std::path::PathBuf;

/// 应用数据目录：`<用户主目录>/.model-viewer/app`
///
/// 约定：`~` 不参与拼接，统一走 `dirs::home_dir()`（见 CLAUDE.md 跨平台要求）。
pub fn app_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "HOME_UNAVAILABLE: 无法定位用户主目录".to_string())?;
    Ok(home.join(".model-viewer").join("app"))
}

/// 导入环境贴图的存放目录：`<应用数据目录>/env`
///
/// 为什么要复制一份：asset 协议的读取权限只在本次运行内有效，而主题要能跨会话复现；
/// 把 HDR 复制到应用自己的目录后，用户之后移动/删除原文件也不会让主题失效。
pub fn environment_dir() -> Result<PathBuf, String> {
    Ok(app_dir()?.join("env"))
}

/// 确保目录存在（仅用于应用自己的数据目录，用户选的路径一律不自动创建）
pub fn ensure_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| {
        format!(
            "IO_ERROR: 无法创建目录（{}）: {error}",
            dir.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 应用数据目录在用户主目录下且不使用波浪号() {
        // 取不到 home 的极端环境下跳过（CI 容器一般不缺）
        let Ok(app) = app_dir() else { return };
        assert!(app.ends_with(PathBuf::from(".model-viewer").join("app")));
        assert!(!app.to_string_lossy().contains('~'));
        assert!(app.is_absolute());
    }

    #[test]
    fn 环境贴图目录是应用数据目录的子目录() {
        let Ok(app) = app_dir() else { return };
        let env = environment_dir().unwrap();
        assert_eq!(env, app.join("env"));
    }

    #[test]
    fn ensure_dir_可重复调用() {
        let target = std::env::temp_dir().join(format!("mv-paths-{}", std::process::id()));
        ensure_dir(&target).unwrap();
        ensure_dir(&target).unwrap();
        assert!(target.is_dir());
        std::fs::remove_dir_all(&target).ok();
    }
}
