-- Per-role session timeouts (session_policy) and per-sign-in activity tracking
-- (user_session).
--
-- Both tables start EMPTY and that is a valid state:
--   * session_policy   — an absent row means "use the code default" in
--                        src/lib/session-policy.ts, so no seed is required.
--   * user_session     — sessions issued before this migration carry no `sid`
--                        claim and are rejected by the jwt callback, which
--                        forces one clean re-login on deploy. Intended.

-- CreateTable
CREATE TABLE "session_policy" (
    "role" "Role" NOT NULL,
    "idle_minutes" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_policy_pkey" PRIMARY KEY ("role")
);

-- Last line of defence behind the Zod schema and the service validator: even a
-- direct psql UPDATE cannot disable the control on a privileged role or set an
-- unusable value. The privileged band (5..120) and the operator ceiling
-- (30 days) mirror SESSION_POLICY_CONFIG; a DB constraint must name the roles
-- literally, so a new role means revisiting this constraint as well as the
-- config entry.
--
-- NOTE the explicit IS NOT NULL on the privileged branch. A CHECK constraint
-- passes when its expression evaluates to NULL, and `NULL BETWEEN 5 AND 120` is
-- NULL, not FALSE — without it, a privileged role could be set to NULL
-- (= persistent, i.e. the control switched off) straight past the constraint.
ALTER TABLE "session_policy" ADD CONSTRAINT "session_policy_idle_minutes_bounds" CHECK (
    ("role" = 'OPERATOR' AND ("idle_minutes" IS NULL OR ("idle_minutes" BETWEEN 5 AND 43200)))
    OR ("role" <> 'OPERATOR' AND "idle_minutes" IS NOT NULL AND "idle_minutes" BETWEEN 5 AND 120)
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_session_user_id_idx" ON "user_session"("user_id");

-- Supports the prune job (scripts/prune-sessions.ts) sweeping by staleness.
CREATE INDEX "user_session_last_activity_at_idx" ON "user_session"("last_activity_at");

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
