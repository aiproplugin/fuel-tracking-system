-- Per-user permission overrides.
--
-- Additive only: a NEW, EMPTY table. Every existing user therefore has zero
-- overrides, so their effective permissions equal their role's default bundle
-- and behaviour is identical to the pre-RBAC role gates on deploy.
CREATE TYPE "PermissionMode" AS ENUM ('GRANT', 'DENY');

CREATE TABLE "user_permission_override" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "mode" "PermissionMode" NOT NULL,
    "granted_by" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_override_pkey" PRIMARY KEY ("id")
);

-- One row per (user, permission): a simultaneous GRANT and DENY of the same
-- permission is structurally impossible, so an effective set is never ambiguous.
CREATE UNIQUE INDEX "user_permission_override_user_id_permission_key"
    ON "user_permission_override"("user_id", "permission");

-- Every protected request resolves this user's overrides; keep that lookup indexed.
CREATE INDEX "user_permission_override_user_id_idx"
    ON "user_permission_override"("user_id");

-- Overrides die with the user they belong to; the granting admin is retained
-- for the audit trail and must never be deleted out from under a live row.
ALTER TABLE "user_permission_override"
    ADD CONSTRAINT "user_permission_override_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permission_override"
    ADD CONSTRAINT "user_permission_override_granted_by_fkey"
    FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
