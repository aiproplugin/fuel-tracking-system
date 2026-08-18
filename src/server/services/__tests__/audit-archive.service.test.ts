import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    auditLog: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import type { ArchiveStore, AuditArchiveRow } from "@/server/services/audit-archive-store";
import { archiveAuditLog, subtractMonths } from "@/server/services/audit-archive.service";

const NOW = new Date("2026-08-18T07:00:00.000Z");

/** An audit_log row as Prisma returns it (id is a BigInt). */
function auditRow(id: number, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    actorId: "user-1",
    action: "LOGIN_SUCCESS",
    entityType: "user",
    entityId: "user-1",
    before: null,
    after: { ok: true },
    ipAddress: "10.0.0.5",
    createdAt: new Date(createdAt),
    ...overrides,
  };
}

/** In-memory store that behaves like a healthy disk. */
function workingStore(): ArchiveStore & { written: Map<string, AuditArchiveRow[]> } {
  const written = new Map<string, AuditArchiveRow[]>();
  return {
    written,
    write: vi.fn(async (filePath: string, rows: AuditArchiveRow[]) => {
      written.set(filePath, rows);
    }),
    verify: vi.fn(async (filePath: string, expectedIds: readonly string[]) => {
      const rows = written.get(filePath);
      if (!rows) {
        return { ok: false, rowCount: 0, reason: "missing", sha256: null };
      }
      const seen = new Set(rows.map((row) => row.id));
      const ok = rows.length === expectedIds.length && expectedIds.every((id) => seen.has(id));
      return {
        ok,
        rowCount: rows.length,
        reason: ok ? null : "mismatch",
        sha256: "deadbeef",
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.auditLog.deleteMany.mockImplementation((args: { where: { id: { in: bigint[] } } }) =>
    Promise.resolve({ count: args.where.id.in.length }),
  );
});

describe("subtractMonths", () => {
  it("subtracts whole months", () => {
    expect(subtractMonths(new Date("2026-08-18T07:00:00Z"), 12).toISOString()).toBe(
      "2025-08-18T07:00:00.000Z",
    );
  });

  it("clamps the day when the target month is shorter", () => {
    // 31 March minus 1 month is 28 Feb (2026 is not a leap year), never 3 March.
    expect(subtractMonths(new Date("2026-03-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});

describe("archiveAuditLog — retention window", () => {
  it("selects only rows older than the retention window", async () => {
    mockDb.auditLog.findMany.mockResolvedValue([]);

    await archiveAuditLog({ retentionMonths: 12, now: NOW, store: workingStore() });

    const args = mockDb.auditLog.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    // 12 months back from 2026-08-18.
    expect(args.where.createdAt.lt.toISOString()).toBe("2025-08-18T07:00:00.000Z");
  });

  it("is a clean no-op when nothing is old enough — no write, no delete, no audit", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue([]);

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("NOTHING_TO_ARCHIVE");
    expect(result.deleted).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("honours a custom retention window", async () => {
    mockDb.auditLog.findMany.mockResolvedValue([]);

    await archiveAuditLog({ retentionMonths: 24, now: NOW, store: workingStore() });

    const args = mockDb.auditLog.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(args.where.createdAt.lt.toISOString()).toBe("2024-08-18T07:00:00.000Z");
  });

  it("rejects a nonsensical retention window rather than guessing", async () => {
    await expect(archiveAuditLog({ retentionMonths: 0, now: NOW })).rejects.toThrow(/at least 1/);
    await expect(archiveAuditLog({ retentionMonths: -5, now: NOW })).rejects.toThrow();
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe("archiveAuditLog — the happy path", () => {
  const rows = [
    auditRow(10, "2024-01-01T00:00:00.000Z"),
    auditRow(11, "2024-02-01T00:00:00.000Z"),
    auditRow(12, "2024-03-01T00:00:00.000Z"),
  ];

  it("writes, verifies, then deletes EXACTLY the archived ids", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue(rows);

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("ARCHIVED");
    expect(result.selected).toBe(3);
    expect(result.deleted).toBe(3);

    // Delete targets the exact id list — never a date predicate, so a row
    // written during the run cannot be swept away unarchived.
    const deleteArgs = mockDb.auditLog.deleteMany.mock.calls[0]?.[0] as {
      where: { id: { in: bigint[] } };
    };
    expect(deleteArgs.where.id.in).toEqual([10n, 11n, 12n]);
    expect(deleteArgs.where).not.toHaveProperty("createdAt");
  });

  it("verifies BEFORE deleting", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue(rows);
    const order: string[] = [];
    vi.mocked(store.verify).mockImplementation(async () => {
      order.push("verify");
      return { ok: true, rowCount: 3, reason: null, sha256: "abc" };
    });
    mockDb.auditLog.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 3 };
    });

    await archiveAuditLog({ now: NOW, store });

    expect(order).toEqual(["verify", "delete"]);
  });

  it("serializes BigInt ids as strings, preserving full fidelity", async () => {
    const store = workingStore();
    // Beyond 2^53: a JS number would silently lose precision here.
    mockDb.auditLog.findMany.mockResolvedValue([
      auditRow(1, "2024-01-01T00:00:00.000Z", { id: 9007199254740993n }),
    ]);

    await archiveAuditLog({ now: NOW, store });

    const written = [...store.written.values()][0]!;
    expect(written[0]!.id).toBe("9007199254740993");
    expect(() => JSON.stringify(written)).not.toThrow();
  });

  it("preserves the before/after JSON documents intact", async () => {
    const store = workingStore();
    const before = { name: "Old Depot", nested: { deep: [1, 2, 3] } };
    const after = { name: "New Depot", nested: { deep: [4] } };
    mockDb.auditLog.findMany.mockResolvedValue([
      auditRow(20, "2024-01-01T00:00:00.000Z", { before, after }),
    ]);

    await archiveAuditLog({ now: NOW, store });

    const written = [...store.written.values()][0]!;
    expect(written[0]!.before).toEqual(before);
    expect(written[0]!.after).toEqual(after);
  });

  it("records AUDIT_ARCHIVED with the window, count, and archive filename", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue(rows);

    const result = await archiveAuditLog({ now: NOW, store, actorId: "admin-1" });

    const audit = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; actorId: string | null; after: Record<string, unknown> };
    };
    expect(audit.data.action).toBe("AUDIT_ARCHIVED");
    expect(audit.data.actorId).toBe("admin-1");
    expect(audit.data.after).toMatchObject({
      archiveFile: result.archivePath,
      rowCount: 3,
      retentionMonths: 12,
    });
    expect(audit.data.after.window).toMatchObject({
      oldest: "2024-01-01T00:00:00.000Z",
      newest: "2024-03-01T00:00:00.000Z",
    });
  });

  it("records AUDIT_ARCHIVED only AFTER the delete succeeds", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue(rows);
    const order: string[] = [];
    mockDb.auditLog.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 3 };
    });
    mockDb.auditLog.create.mockImplementation(async () => {
      order.push("audit");
      return {};
    });

    await archiveAuditLog({ now: NOW, store });

    expect(order).toEqual(["delete", "audit"]);
  });

  it("attributes an unattended run to no actor, marked via cli", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue(rows);

    await archiveAuditLog({ now: NOW, store });

    const audit = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { actorId: string | null; after: { via: string } };
    };
    expect(audit.data.actorId).toBeNull();
    expect(audit.data.after.via).toBe("cli");
  });
});

describe("archiveAuditLog — failure aborts with ZERO rows removed", () => {
  const rows = [auditRow(10, "2024-01-01T00:00:00.000Z"), auditRow(11, "2024-02-01T00:00:00.000Z")];

  beforeEach(() => {
    mockDb.auditLog.findMany.mockResolvedValue(rows);
  });

  it("a failed WRITE deletes nothing and records nothing", async () => {
    const store = workingStore();
    vi.mocked(store.write).mockRejectedValue(new Error("ENOSPC: no space left on device"));

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("VERIFICATION_FAILED");
    expect(result.deleted).toBe(0);
    expect(result.failureReason).toContain("ENOSPC");
    expect(store.verify).not.toHaveBeenCalled();
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("a MISSING archive file deletes nothing", async () => {
    const store = workingStore();
    vi.mocked(store.verify).mockResolvedValue({
      ok: false,
      rowCount: 0,
      reason: "archive file is missing or unreadable",
      sha256: null,
    });

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("VERIFICATION_FAILED");
    expect(result.deleted).toBe(0);
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("a ROW-COUNT MISMATCH deletes nothing", async () => {
    const store = workingStore();
    vi.mocked(store.verify).mockResolvedValue({
      ok: false,
      rowCount: 1,
      reason: "archive holds 1 rows but 2 were selected",
      sha256: "abc",
    });

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("VERIFICATION_FAILED");
    expect(result.deleted).toBe(0);
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it("a verifier that THROWS deletes nothing", async () => {
    const store = workingStore();
    vi.mocked(store.verify).mockRejectedValue(new Error("disk read error"));

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("VERIFICATION_FAILED");
    expect(result.deleted).toBe(0);
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("a store that silently writes the WRONG rows deletes nothing", async () => {
    const store = workingStore();
    // Writes a different row set than the one selected — count matches, ids do not.
    vi.mocked(store.write).mockImplementation(async (filePath) => {
      store.written.set(filePath, [
        { ...auditRow(99, "2024-01-01T00:00:00.000Z"), id: "99", createdAt: "x" } as never,
        { ...auditRow(98, "2024-01-01T00:00:00.000Z"), id: "98", createdAt: "x" } as never,
      ]);
    });

    const result = await archiveAuditLog({ now: NOW, store });

    expect(result.outcome).toBe("VERIFICATION_FAILED");
    expect(result.deleted).toBe(0);
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe("archiveAuditLog — dry run", () => {
  it("reports what would happen and touches nothing", async () => {
    const store = workingStore();
    mockDb.auditLog.findMany.mockResolvedValue([auditRow(10, "2024-01-01T00:00:00.000Z")]);

    const result = await archiveAuditLog({ now: NOW, store, dryRun: true });

    expect(result.outcome).toBe("DRY_RUN");
    expect(result.selected).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.archivePath).toContain(".jsonl.gz");
    expect(store.write).not.toHaveBeenCalled();
    expect(mockDb.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
