CREATE TABLE `cron_task` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `prompt` text NOT NULL,
  `agent` text,
  `model` text,
  `schedule_kind` text NOT NULL,
  `schedule_value` text NOT NULL,
  `timezone` text,
  `status` text NOT NULL,
  `timeout_ms` integer,
  `max_retries` integer,
  `last_run_id` text,
  `last_run_at` integer,
  `last_run_status` text,
  `last_error` text,
  `next_run_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cron_task_project_idx` ON `cron_task` (`project_id`);
--> statement-breakpoint
CREATE INDEX `cron_task_status_next_idx` ON `cron_task` (`status`,`next_run_at`);
--> statement-breakpoint
CREATE TABLE `cron_run` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `session_id` text,
  `status` text NOT NULL,
  `attempt` integer NOT NULL,
  `time_started` integer,
  `time_completed` integer,
  `error_message` text,
  `logs` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `cron_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cron_run_task_idx` ON `cron_run` (`task_id`);
--> statement-breakpoint
CREATE INDEX `cron_run_session_idx` ON `cron_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `cron_run_status_idx` ON `cron_run` (`status`);
--> statement-breakpoint
ALTER TABLE `session` ADD `cron_run_id` text;
--> statement-breakpoint
CREATE INDEX `session_cron_run_idx` ON `session` (`cron_run_id`);
