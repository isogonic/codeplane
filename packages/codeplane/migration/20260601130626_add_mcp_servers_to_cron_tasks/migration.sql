-- Adds cron-task-level MCP server affordances. Each scheduled task can list
-- which MCP servers should be enabled for its runs (null = all, []=none).
ALTER TABLE `cron_task` ADD COLUMN `mcp_servers` text;
