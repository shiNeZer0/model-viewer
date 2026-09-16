#[cfg_attr(mobile, tauri::mobile_entry_point)]
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_log::{Target, TargetKind};

mod app_state;
mod asset_scope;
mod commands;

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
        let home = dirs::home_dir().expect("failed to get home directory");
        let dir = home.join(".model-viewer").join("app");
        std::fs::create_dir_all(&dir).expect("failed to create app directory");
        dir
    };
    let log_path = app_dir.join("app.log").to_string_lossy().to_string();
    let db_path = format!("sqlite:{}", app_dir.join("app.db").to_string_lossy());

    tauri::Builder::default()
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
        ])
        .setup(|_app| {
            log::info!("model-viewer app initialised");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
