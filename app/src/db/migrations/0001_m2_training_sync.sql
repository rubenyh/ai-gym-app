CREATE TABLE `body_weight_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`measured_at` text NOT NULL,
	`weight_grams` integer NOT NULL,
	`server_revision` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_exercises` (
	`source_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`body_part` text,
	`target` text,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text NOT NULL,
	`equipment` text NOT NULL,
	`instructions` text NOT NULL,
	`load_mode` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_exercises_name_idx` ON `catalog_exercises` (`name`);--> statement-breakpoint
CREATE TABLE `catalog_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text NOT NULL,
	`equipment` text NOT NULL,
	`instructions` text NOT NULL,
	`load_mode` text NOT NULL,
	`archived` integer NOT NULL,
	`server_revision` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`base_revision` integer,
	`payload` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_op_id_unique` ON `outbox` (`op_id`);--> statement-breakpoint
CREATE INDEX `outbox_status_idx` ON `outbox` (`status`);--> statement-breakpoint
CREATE INDEX `outbox_aggregate_idx` ON `outbox` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE TABLE `performed_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`target_reps` integer,
	`target_load_grams` integer,
	`reps` integer,
	`load_grams` integer,
	`load_mode` text NOT NULL,
	`completed` integer NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `session_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `performed_sets_exercise_idx` ON `performed_sets` (`session_exercise_id`);--> statement-breakpoint
CREATE TABLE `planned_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`target_reps` integer,
	`target_load_grams` integer,
	`load_mode` text NOT NULL,
	FOREIGN KEY (`routine_exercise_id`) REFERENCES `routine_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planned_sets_exercise_idx` ON `planned_sets` (`routine_exercise_id`);--> statement-breakpoint
CREATE TABLE `program_days` (
	`program_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`routine_id` text NOT NULL,
	PRIMARY KEY(`program_id`, `weekday`),
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer NOT NULL,
	`origin` text NOT NULL,
	`coach_draft_id` text,
	`server_revision` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rest_timer` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ends_at` text NOT NULL,
	`duration_seconds` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reward_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routine_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`position` integer NOT NULL,
	`exercise_key` text NOT NULL,
	`exercise_name` text NOT NULL,
	`notes` text NOT NULL,
	`rest_seconds` integer,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routine_exercises_routine_idx` ON `routine_exercises` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text NOT NULL,
	`archived` integer NOT NULL,
	`origin` text NOT NULL,
	`server_revision` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`exercise_key` text NOT NULL,
	`exercise_name` text NOT NULL,
	`notes` text NOT NULL,
	`rest_seconds` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_exercises_session_idx` ON `session_exercises` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_exercises_key_idx` ON `session_exercises` (`exercise_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`timezone` text NOT NULL,
	`local_date` text,
	`notes` text NOT NULL,
	`server_revision` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_one_active_idx` ON `sessions` (`status`) WHERE status = 'active' AND deleted = 0;--> statement-breakpoint
CREATE INDEX `sessions_completed_idx` ON `sessions` (`completed_at`);--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`op_id` text NOT NULL,
	`local_doc` text,
	`server_doc` text,
	`server_revision` integer NOT NULL,
	`server_deleted` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`aggregate_type`, `aggregate_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`hydrated` integer DEFAULT false NOT NULL,
	`last_sync_at` text,
	`last_error` text
);
