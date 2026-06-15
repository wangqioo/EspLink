CREATE TABLE IF NOT EXISTS `firmware_releases` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `board_type` VARCHAR(64) NOT NULL,
  `version` VARCHAR(64) NOT NULL,
  `artifact_url` TEXT NOT NULL,
  `sha256` VARCHAR(128) NOT NULL,
  `size_bytes` INT NULL,
  `channel` VARCHAR(32) NOT NULL DEFAULT 'stable',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `force_update` BOOLEAN NOT NULL DEFAULT FALSE,
  `release_notes` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE KEY `firmware_releases_board_type_channel_version_key` (`board_type`, `channel`, `version`),
  KEY `firmware_releases_board_type_channel_is_active_idx` (`board_type`, `channel`, `is_active`),
  KEY `firmware_releases_board_type_version_idx` (`board_type`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
