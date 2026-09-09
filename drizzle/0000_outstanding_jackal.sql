CREATE TABLE `sheets` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`instrument` text NOT NULL,
	`genre` text NOT NULL,
	`difficulty` text NOT NULL,
	`musical_key` text NOT NULL,
	`bpm` integer NOT NULL,
	`uploader` text NOT NULL,
	`avatar` text NOT NULL,
	`accent` text NOT NULL,
	`music_xml` text NOT NULL,
	`processing_mode` text NOT NULL,
	`processing_provider` text NOT NULL,
	`processing_warnings` text NOT NULL,
	`source_object_key` text,
	`created_at` integer NOT NULL
);
