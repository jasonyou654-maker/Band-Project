ALTER TABLE `score_revisions` ADD `owner_email` text NOT NULL;--> statement-breakpoint
ALTER TABLE `transcription_jobs` ADD `owner_email` text NOT NULL;--> statement-breakpoint
ALTER TABLE `transcription_jobs` ADD `remote_job_id` text;