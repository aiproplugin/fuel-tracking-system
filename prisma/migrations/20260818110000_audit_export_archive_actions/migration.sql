-- Audit actions for long-term audit-trail management.
--
--   AUDIT_EXPORTED — a read-only export of the trail was downloaded. Kept
--                    distinct from REPORT_EXPORTED so "who read the audit
--                    trail" is greppable on its own.
--   AUDIT_ARCHIVED — rows were archived to durable storage and only then
--                    removed from the hot table. This event stays behind in
--                    audit_log so the archival is itself accountable.
--
-- Additive only, and alone in its migration: PostgreSQL forbids USING a new
-- enum value in the same transaction that adds it.
ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_ARCHIVED';
