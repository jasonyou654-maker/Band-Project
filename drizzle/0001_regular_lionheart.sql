CREATE TABLE `dataset_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`split` text NOT NULL,
	`instrument` text NOT NULL,
	`source_type` text NOT NULL,
	`audio_object_key` text NOT NULL,
	`reference_object_key` text NOT NULL,
	`license` text NOT NULL,
	`consented_for_training` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `score_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operations` text NOT NULL,
	`consented_for_training` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcription_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`filename` text NOT NULL,
	`target_instrument` text NOT NULL,
	`source_type` text NOT NULL,
	`strict_rhythm` integer NOT NULL,
	`source_object_key` text NOT NULL,
	`result_object_key` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
