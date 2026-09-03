-- CreateTable
CREATE TABLE `collector_pairings` (
    `id` VARCHAR(191) NOT NULL,
    `collector_id` VARCHAR(191) NOT NULL,
    `code_hash` VARCHAR(191) NOT NULL,
    `encrypted_collector_key` TEXT NOT NULL,
    `backend_url` VARCHAR(2048) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collector_pairings_code_hash_key`(`code_hash`),
    INDEX `collector_pairings_collector_id_expires_at_idx`(`collector_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `collector_pairings` ADD CONSTRAINT `collector_pairings_collector_id_fkey` FOREIGN KEY (`collector_id`) REFERENCES `sms_collectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
