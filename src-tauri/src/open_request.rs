//! 「启动 / 二次打开请求」的参数解析。
//!
//! 双击关联文件（Windows 的注册表关联、macOS 的 open 事件最终都表现为"带参数的启动"）时，
//! 文件路径会作为命令行参数传进来。这里只做**纯解析**，便于单测；
//! 事件转发与窗口唤起由 lib.rs 的装配完成。
//!
//! 两个来源：
//! - 首次启动：前端在引擎就绪后调 `startup_model_path` 取一次；
//! - 已有实例在运行：单实例插件拦下第二个进程，由 lib.rs 把路径 emit 给主窗口。

use std::path::Path;

use crate::asset_scope::ModelFormat;

/// 去掉 `file://` 前缀（macOS/Linux 的某些入口会给 URL 形式）。
/// 说明：这里**不做**百分号解码，因此带空格/中文的 file:// 形式可能解析不到文件；
/// Windows 下的关联启动给的是纯路径，属于主用例。
fn strip_file_scheme(argument: &str) -> &str {
    argument.strip_prefix("file://").unwrap_or(argument)
}

/// 该参数是否是一个"受支持的模型文件路径"
///
/// 跳过 `-` 开头的参数：WebView2 / Tauri 自己会注入 `--flag` 形式的东西，
/// 误当成文件会让启动时弹一个莫名其妙的错误。
pub fn is_model_file_arg(argument: &str) -> bool {
    if argument.is_empty() || argument.starts_with('-') {
        return false;
    }
    ModelFormat::from_path(Path::new(strip_file_scheme(argument))).is_some()
}

/// 从命令行参数里取第一个模型文件（`args[0]` 是自身可执行文件路径，跳过）
pub fn first_model_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|argument| is_model_file_arg(argument))
        .map(|argument| strip_file_scheme(argument).to_string())
}

/// 首次启动时命令行里带的模型文件；没有则 None。
///
/// 前端只在引擎就绪时取一次（重复调用会重新解析 argv，因此调用方需自行保证只消费一次）。
#[tauri::command]
pub async fn startup_model_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let path = first_model_path(&args);
    log::info!("startup_model_path: 共 {} 个参数，待打开文件 {path:?}", args.len());
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn 跳过可执行文件自身与注入参数() {
        assert_eq!(first_model_path(&args(&["app.exe"])), None);
        // WebView2/Tauri 会塞 --flag，不能当成文件
        assert_eq!(
            first_model_path(&args(&["app.exe", "--allow-file-access", "-v"])),
            None
        );
    }

    #[test]
    fn 取第一个模型文件并忽略其它参数() {
        assert_eq!(
            first_model_path(&args(&["app.exe", "--flag", "E:\\models\\cube.glb"])),
            Some("E:\\models\\cube.glb".to_string())
        );
        // 多个文件时只取第一个（一次只显示一个模型是既定约束）
        assert_eq!(
            first_model_path(&args(&["app.exe", "a.obj", "b.stl"])),
            Some("a.obj".to_string())
        );
    }

    #[test]
    fn 扩展名大小写不敏感且拒绝非模型文件() {
        assert_eq!(
            first_model_path(&args(&["app.exe", "C:\\x\\MODEL.3MF"])),
            Some("C:\\x\\MODEL.3MF".to_string())
        );
        assert_eq!(first_model_path(&args(&["app.exe", "readme.txt"])), None);
        assert_eq!(first_model_path(&args(&["app.exe", "noext"])), None);
    }

    #[test]
    fn file_url_会去掉前缀() {
        assert_eq!(
            first_model_path(&args(&["app.exe", "file:///home/u/cube.gltf"])),
            Some("/home/u/cube.gltf".to_string())
        );
        assert!(is_model_file_arg("file:///E:/a/b.glb"));
    }

    #[test]
    fn 空参数安全() {
        assert_eq!(first_model_path(&[]), None);
        assert_eq!(first_model_path(&args(&["app.exe", ""])), None);
    }
}
