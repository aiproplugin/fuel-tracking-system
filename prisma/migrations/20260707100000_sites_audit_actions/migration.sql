-- AlterEnum
-- Sites admin page: audit site renames (SITE_UPDATED) and deletions (SITE_DELETED).
-- (SITE_CREATED already exists from the Phase 2 audit-actions migration.)
ALTER TYPE "AuditAction" ADD VALUE 'SITE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SITE_DELETED';
