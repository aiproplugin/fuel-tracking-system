-- Audit actions for the permission system.
--
-- Additive only. Split into its own migration ahead of the override table
-- because PostgreSQL forbids USING a new enum value in the same transaction
-- that adds it — keeping these separate leaves the values safely committed
-- before any code or later migration references them.
ALTER TYPE "AuditAction" ADD VALUE 'PERMISSION_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'PERMISSION_DENIED';
ALTER TYPE "AuditAction" ADD VALUE 'PERMISSION_OVERRIDE_REMOVED';
