DROP INDEX `sessions_completed_idx`;--> statement-breakpoint
CREATE INDEX `sessions_history_idx` ON `sessions` (`completed_at`,`id`);--> statement-breakpoint
ALTER TABLE `account_profile` ADD `server_revision` integer;--> statement-breakpoint
ALTER TABLE `account_profile` ADD `deleted` integer DEFAULT false NOT NULL;