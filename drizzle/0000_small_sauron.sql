CREATE TABLE `editor_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`version` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
