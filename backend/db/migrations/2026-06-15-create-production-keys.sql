CREATE TABLE IF NOT EXISTS `production_keys` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `mac_address` VARCHAR(64) NOT NULL,
  `sn` VARCHAR(128) NULL,
  `psk_hash` VARCHAR(128) NOT NULL,
  `psk_encrypted` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `last_nonce` VARCHAR(128) NULL,
  `last_seen_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE KEY `production_keys_mac_address_key` (`mac_address`),
  KEY `production_keys_sn_idx` (`sn`),
  KEY `production_keys_is_active_idx` (`is_active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
