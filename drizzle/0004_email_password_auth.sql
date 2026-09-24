ALTER TABLE `users` ADD `password_hash` text;
--> statement-breakpoint
CREATE TABLE `sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_email` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_email_idx` ON `sessions` (`user_email`);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);
