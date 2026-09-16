-- 删除模板示例表 tasks（查看器完全不用它）。
-- 迁移保持 append-only：0000 里创建 tasks 的历史不动，这里用一个新 version 删掉，
-- 这样已有的 app.db（含 0000 已执行的记录）也会在下次启动时自动清理。
DROP TABLE IF EXISTS tasks;
