CREATE TABLE `account_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`visibility` text NOT NULL,
	`avatar_path` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`weight_unit` text NOT NULL,
	`length_unit` text NOT NULL,
	`timezone` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_goals` (
	`effective_week` text PRIMARY KEY NOT NULL,
	`target_days` integer NOT NULL,
	`timezone` text NOT NULL
);
