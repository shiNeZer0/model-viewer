#[cfg_attr(mobile, tauri::mobile_entry_point)]
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_log::{Target, TargetKind};

mod app_state;
mod asset_scope;
mod commands;
mod open_request;
mod paths;

/// 第二个实例被拦下时，把待打开文件转发给主窗口的事件名（前端在 platform 层订阅）
const OPEN_MODEL_EVENT: &str = "open-model-path";

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/0000_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_viewer_tables",
            sql: include_str!("../migrations/0001_viewer.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "drop_template_tasks_table",
            sql: include_str!("../migrations/0002_drop_tasks.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let app_dir = {
        let dir = paths::app_dir().expect("failed to resolve app directory");
        std::fs::create_dir_all(&dir).expect("failed to create app directory");
        dir
    };
    let log_path = app_dir.join("app.log").to_string_lossy().to_string();
    let db_path = format!("sqlite:{}", app_dir.join("app.db").to_string_lossy());

    tauri::Builder::default()
        // 单实例插件**必须第一个注册**：第二个进程要在其它插件初始化之前就被拦下，
        // 否则会出现两个窗口各持一份 SQLite 连接、日志句柄等资源。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let path = open_request::first_model_path(&argv);
            log::info!("检测到重复启动: argv={argv:?} 待打开文件={path:?}");

            // 把已有窗口拉到前台：用户以为程序没反应才会去双击第二次
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = path {
                    if let Err(error) = window.emit(OPEN_MODEL_EVENT, path) {
                        log::warn!("转发待打开文件失败: {error}");
                    }
                }
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(log_path),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_path, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::asset::probe_model_file,
            commands::asset::allow_asset_paths,
            commands::asset::list_asset_grants,
            commands::asset::revoke_asset_grants,
            commands::screenshot::save_screenshot,
            commands::environment::store_environment_map,
            open_request::startup_model_path,
        ])
        .setup(|_app| {
            log::info!("model-viewer app initialised");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
