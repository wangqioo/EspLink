CREATE TABLE IF NOT EXISTS `firmware_ota_attempts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `mac_address` VARCHAR(64) NOT NULL,
  `board_type` VARCHAR(64) NOT NULL,
  `from_version` VARCHAR(64) NULL,
  `target_version` VARCHAR(64) NOT NULL,
  `release_id` INT NULL,
  `status` VARCHAR(32) NOT NULL,
  `error_code` VARCHAR(64) NULL,
  `error_message` TEXT NULL,
  `bytes_written` INT NULL,
  `started_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `finished_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  KEY `firmware_ota_attempts_mac_started_idx` (`mac_address`, `started_at`),
  KEY `firmware_ota_attempts_release_status_idx` (`release_id`, `status`),
  KEY `firmware_ota_attempts_board_target_idx` (`board_type`, `target_version`),
  CONSTRAINT `firmware_ota_attempts_mac_fk`
    FOREIGN KEY (`mac_address`) REFERENCES `devices` (`mac_address`)
    ON DELETE CASCADE,
  CONSTRAINT `firmware_ota_attempts_release_fk`
    FOREIGN KEY (`release_id`) REFERENCES `firmware_releases` (`id`)
    ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
