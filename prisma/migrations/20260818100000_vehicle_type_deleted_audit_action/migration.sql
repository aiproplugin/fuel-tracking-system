-- Audit action for vehicle-type deletion.
--
-- Deliberately distinct from SETTINGS_CHANGED (which vehicle-type create and
-- update use): a deletion is irreversible and must be greppable in the audit
-- trail on its own, matching SITE_DELETED and COMPANY_DELETED.
--
-- Additive only, and alone in its migration: PostgreSQL forbids USING a new
-- enum value in the same transaction that adds it, so keeping it separate
-- leaves the value safely committed before any code references it.
ALTER TYPE "AuditAction" ADD VALUE 'VEHICLE_TYPE_DELETED';
