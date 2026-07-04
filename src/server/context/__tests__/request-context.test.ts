import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture what the audit service writes without a real database.
vi.mock("@/server/db", () => ({
  db: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
}));

import { db } from "@/server/db";
import { runWithRequestContext } from "@/server/context/request-context";
import { recordAuditEvent } from "@/server/services/audit.service";

const create = vi.mocked(db.auditLog.create);
const lastIp = () => (create.mock.calls.at(-1)?.[0] as { data: { ipAddress: string | null } }).data.ipAddress;

describe("audit IP via AsyncLocalStorage request context", () => {
  beforeEach(() => create.mockClear());

  it("fills ipAddress from the bound request context", async () => {
    await runWithRequestContext({ ipAddress: "203.0.113.9" }, async () => {
      await recordAuditEvent({ action: "FUEL_ISSUED" });
    });
    expect(lastIp()).toBe("203.0.113.9");
  });

  it("records null when no context is bound", async () => {
    await recordAuditEvent({ action: "FUEL_ISSUED" });
    expect(lastIp()).toBeNull();
  });

  it("lets an explicit ipAddress win over the context (the login flow)", async () => {
    await runWithRequestContext({ ipAddress: "10.0.0.1" }, async () => {
      await recordAuditEvent({ action: "LOGIN_SUCCESS", ipAddress: "198.51.100.4" });
    });
    expect(lastIp()).toBe("198.51.100.4");
  });
});
