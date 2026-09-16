-- M0 起引入查看器所需的四张表（单个 version 建全部表，不一张表一个 version）
-- 说明：模板示例表 tasks 暂不删除，待用户确认后再单独清理

CREATE TABLE IF NOT EXISTS viewer_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                       -- JSON 字符串
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 仅存用户自定义“光照主题”；内置预设写在代码里，便于随版本调优
CREATE TABLE IF NOT EXISTS lighting_themes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  payload    TEXT NOT NULL,                       -- 光照 + 环境完整快照 JSON（含 schemaVersion）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recent_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  path           TEXT NOT NULL UNIQUE,
  file_name      TEXT NOT NULL,
  format         TEXT NOT NULL,
  size_bytes     INTEGER,
  camera_state   TEXT,                            -- 预留：上次相机位姿 JSON
  last_opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  open_count     INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recent_files_opened ON recent_files (last_opened_at DESC);

-- 记录已授权的目录，用于启动时重新授予 asset 协议 scope
CREATE TABLE IF NOT EXISTS granted_dirs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dir_path   TEXT NOT NULL UNIQUE,
  recursive  INTEGER DEFAULT 1,
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
