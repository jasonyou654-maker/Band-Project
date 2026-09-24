CREATE TABLE `content_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_email` text NOT NULL,
	`sheet_id` integer NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_email` text NOT NULL,
	`sheet_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_email`, `sheet_id`)
);
--> statement-breakpoint
CREATE TABLE `recent_items` (
	`user_email` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`user_email`, `item_type`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`bio` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `sheets` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `sheets` ADD `arrangement` text DEFAULT 'Solo arrangement' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `rights_declaration` text DEFAULT 'Personal / Educational Use' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `downloads` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `deleted_at` integer;