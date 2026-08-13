import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the collaborators the route composes, so we test the SECURITY CONTRACT
// (authn/authz, rate limit, session-derived scope, audit) — not report SQL.
// The override lookup is real: the route resolves effective permissions per
// request exactly as tRPC does, and returns no overrides here so each role
// falls back to its default bundle.
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    userPermissionOverride: {
      findMany: vi.fn<() => Promise<Array<{ permission: string; mode: "GRANT" | "DENY" }>>>(() =>
        Promise.resolve([]),
      ),
    },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/services/reports/report.service", () => ({ runReport: vi.fn() }));
vi.mock("@/server/services/audit.service", () => ({ recordAuditEvent: vi.fn() }));

import type { ReportResult } from "@/server/services/reports/report-types";
import { auth } from "@/server/auth";
import { recordAuditEvent } from "@/server/services/audit.service";
import { runReport } from "@/server/services/reports/report.service";
import { exportRateLimiter } from "@/server/security/rate-limit";
import { GET } from "@/app/api/reports/export/route";

const authMock = vi.mocked(auth);
const runReportMock = vi.mocked(runReport);
const recordAuditMock = vi.mocked(recordAuditEvent);

const SITE_REAL = "11111111-1111-1111-1111-111111111111";
const SITE_SPOOFED = "22222222-2222-2222-2222-222222222222";

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "u-sup",
      username: "sup",
      displayName: "Sup",
      role: "SUPERVISOR",
      siteId: SITE_REAL,
      defaultTankId: null,
      mustChangePassword: false,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
}

const RESULT: ReportResult = {
  key: "vehicle-usage",
  columns: [{ key: "plate", label: "Plate", type: "text" }],
  rows: [{ plate: "ABC-123" }],
  summary: [],
  totalRows: 1,
  truncated: false,
  meta: { title: "t", generatedAt: "now", scopeNote: "s", range: { from: null, to: null } },
};

function request(query: string): Request {
  return new Request(`http://localhost/api/reports/export?${query}`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

describe("report export route — security contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportRateLimiter.reset();
    mockDb.userPermissionOverride.findMany.mockResolvedValue([]);
    runReportMock.mockResolvedValue(RESULT);
    authMock.mockResolvedValue(sessionUser() as any);
  });

  it("401s an unauthenticated request", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(401);
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("403s a session that must change its password", async () => {
    authMock.mockResolvedValue(sessionUser({ mustChangePassword: true }) as any);
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(403);
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("403s an OPERATOR (no reports access)", async () => {
    authMock.mockResolvedValue(sessionUser({ role: "OPERATOR" }) as any);
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(403);
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("429s once the per-user export budget is spent", async () => {
    // Exhaust the window for this user id before the request.
    for (let i = 0; i < 20; i++) exportRateLimiter.consume("u-sup");
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("builds the Actor from the SESSION, ignoring a spoofed siteId query param", async () => {
    const res = await GET(request(`reportKey=vehicle-usage&format=csv&siteId=${SITE_SPOOFED}`));
    expect(res.status).toBe(200);

    // Identity and scope come from the session, never the query string.
    expect(runReportMock).toHaveBeenCalledTimes(1);
    const actorArg = runReportMock.mock.calls[0]![0];
    expect(actorArg).toMatchObject({ id: "u-sup", role: "SUPERVISOR", siteId: SITE_REAL });
    // …and the actor carries server-resolved permissions, so the service scopes
    // on the same set that authorized the request.
    expect(actorArg.permissions.has("report.export")).toBe(true);
    expect(actorArg.permissions.has("report.view.site")).toBe(true);
    expect(actorArg.permissions.has("report.view.all")).toBe(false);
  });

  it("403s a user whose report.export permission is revoked by override", async () => {
    // Same session, same role — only the stored override differs, proving the
    // route re-resolves permissions per request rather than trusting the JWT.
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "report.export", mode: "DENY" },
    ]);
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(403);
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("records a REPORT_EXPORTED audit event on success", async () => {
    const res = await GET(request("reportKey=vehicle-usage&format=csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const event = recordAuditMock.mock.calls[0]![0];
    expect(event).toMatchObject({
      actorId: "u-sup",
      action: "REPORT_EXPORTED",
      entityType: "report",
      entityId: "vehicle-usage",
    });
  });
});
