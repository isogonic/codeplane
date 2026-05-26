-- Adds explicit run-order override for prompt_job. NULL means "use natural id
-- order" (FIFO insertion). The new index lets `PromptQueue.claim` order by
-- `(status, sort_order, id)` without a table scan.
ALTER TABLE `prompt_job` ADD COLUMN `sort_order` integer;
--> statement-breakpoint
CREATE INDEX `prompt_job_status_sort_idx` ON `prompt_job` (`status`,`sort_order`);
