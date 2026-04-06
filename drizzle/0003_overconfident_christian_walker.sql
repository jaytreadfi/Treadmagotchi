PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pet_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text DEFAULT 'Treadmagotchi' NOT NULL,
	`hunger` real DEFAULT 100 NOT NULL,
	`happiness` real DEFAULT 100 NOT NULL,
	`energy` real DEFAULT 100 NOT NULL,
	`health` real DEFAULT 100 NOT NULL,
	`mood` text DEFAULT 'content' NOT NULL,
	`stage` text DEFAULT 'EGG' NOT NULL,
	`cumulative_volume` real DEFAULT 0 NOT NULL,
	`consecutive_losses` integer DEFAULT 0 NOT NULL,
	`last_trade_time` integer,
	`last_save_time` integer NOT NULL,
	`is_alive` integer DEFAULT true NOT NULL,
	`evolved_at` integer,
	`egg_id` integer,
	`character_id` text,
	`map_id` text DEFAULT 'cozy'
);
--> statement-breakpoint
INSERT INTO `__new_pet_state`("id", "name", "hunger", "happiness", "energy", "health", "mood", "stage", "cumulative_volume", "consecutive_losses", "last_trade_time", "last_save_time", "is_alive", "evolved_at", "egg_id", "character_id", "map_id") SELECT "id", "name", "hunger", "happiness", "energy", "health", "mood", "stage", "cumulative_volume", "consecutive_losses", "last_trade_time", "last_save_time", "is_alive", "evolved_at", "egg_id", "character_id", "map_id" FROM `pet_state`;--> statement-breakpoint
DROP TABLE `pet_state`;--> statement-breakpoint
ALTER TABLE `__new_pet_state` RENAME TO `pet_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `trades` ADD `volume` real;