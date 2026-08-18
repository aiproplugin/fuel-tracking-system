-- Audit action for the per-role session-timeout settings.
--
-- Additive only, and deliberately SPLIT from the table migration that follows:
-- PostgreSQL forbids USING a new enum value in the same transaction that adds
-- it, so the value is committed here before any later migration or application
-- code can reference it. Same pattern as 20260813120000_permission_audit_actions.
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_SETTINGS_UPDATED';
