-- No FK on session_id: a deleted session leaves jobs orphaned, but the
-- worker's recovery pass tolerates that (it'll fail the job after the
-- session lookup throws). Keeping the column FK-free lets us enqueue jobs
-- for sessions in any state of creation, simplifies test setup, and avoids
-- needing CASCADE behavior across session deletion (which already has its
-- own bespoke cleanup path).
CREATE TABLE `prompt_job` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `directory` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL,
  `attempt` integer NOT NULL,
  `max_attempts` integer NOT NULL,
  `next_run_at` integer,
  `time_started` integer,
  `time_completed` integer,
  `error_message` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_job_session_idx` ON `prompt_job` (`session_id`);
--> statement-breakpoint
CREATE INDEX `prompt_job_status_next_idx` ON `prompt_job` (`status`,`next_run_at`);
