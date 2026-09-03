-- Preserve expired inbound SMS as audit-visible records while making them unusable for OTP delivery.
ALTER TABLE `sms_messages`
  MODIFY `status` ENUM('NEW', 'MATCHED', 'UNMATCHED', 'PROCESSED', 'IGNORED', 'DUPLICATE', 'NEEDS_REVIEW', 'EXPIRED') NOT NULL DEFAULT 'NEW';
