CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`pair` text,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_cat_ts` ON `activity_log` (`category`,`timestamp`);--> statement-breakpoint
CREATE INDEX `activity_ts` ON `activity_log` (`timestamp`);--> statement-breakpoint
CREATE TABLE `bot_volumes` (
	`bot_id` text PRIMARY KEY NOT NULL,
	`last_known_volume` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`old_value` text,
	`new_value` text NOT NULL,
	`changed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_losses` (
	`date` text PRIMARY KEY NOT NULL,
	`total_loss` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decision_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`action` text NOT NULL,
	`pair` text,
	`reasoning` text DEFAULT '' NOT NULL,
	`active_pairs` text DEFAULT '[]' NOT NULL,
	`calm_pairs` text DEFAULT '[]' NOT NULL,
	`portfolio` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decisions_ts` ON `decision_log` (`timestamp`);--> statement-breakpoint
CREATE TABLE `pet_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type_ts` ON `pet_events` (`type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `events_ts` ON `pet_events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `pet_state` (
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
	`evolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `pnl_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`balance` real NOT NULL,
	`equity` real NOT NULL,
	`unrealized_pnl` real NOT NULL,
	`num_positions` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pnl_ts` ON `pnl_snapshots` (`timestamp`);--> statement-breakpoint
CREATE TABLE `risk_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`peak_equity` real DEFAULT 100 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_outcomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trade_id` integer NOT NULL,
	`realized_pnl` real NOT NULL,
	`outcome` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outcomes_trade_id` ON `trade_outcomes` (`trade_id`);--> statement-breakpoint
CREATE INDEX `outcomes_outcome_ts` ON `trade_outcomes` (`outcome`,`timestamp`);--> statement-breakpoint
CREATE INDEX `outcomes_ts` ON `trade_outcomes` (`timestamp`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`treadfi_id` text,
	`pair` text NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`reasoning` text DEFAULT '' NOT NULL,
	`mm_params` text DEFAULT '{}' NOT NULL,
	`account_name` text,
	`exchange` text,
	`source` text DEFAULT 'ai' NOT NULL,
	`submitted_at` integer,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_treadfi_id_uniq` ON `trades` (`treadfi_id`);--> statement-breakpoint
CREATE INDEX `trades_status_ts` ON `trades` (`status`,`timestamp`);--> statement-breakpoint
CREATE INDEX `trades_pair_ts` ON `trades` (`pair`,`timestamp`);--> statement-breakpoint
CREATE INDEX `trades_ts` ON `trades` (`timestamp`);