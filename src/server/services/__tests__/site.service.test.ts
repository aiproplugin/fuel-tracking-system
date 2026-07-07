import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    site: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { createSite, deleteSite, updateSite } from "@/server/services/site.service";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`db error ${code}`, {
    code,
    clientVersion: "6.19.3",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
});

describe("createSite", () => {
  it("creates and audits SITE_CREATED", async () => {
    mockDb.site.create.mockResolvedValue({ id: "site-1", name: "Main Depot" });

    const result = await createSite("admin-1", { name: "Main Depot" });

    expect(result).toEqual({ id: "site-1", name: "Main Depot" });
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditArg.data.action).toBe("SITE_CREATED");
  });

  it("maps a duplicate name (P2002) to a friendly CONFLICT", async () => {
    mockDb.site.create.mockRejectedValue(knownRequestError("P2002"));

    await expect(createSite("admin-1", { name: "Main Depot" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("updateSite", () => {
  it("renames and audits SITE_UPDATED with before/after", async () => {
    mockDb.site.findUnique.mockResolvedValue({ id: "site-1", name: "Old Name" });
    mockDb.site.update.mockResolvedValue({});

    await updateSite("admin-1", { id: "site-1", name: "New Name" });

    expect(mockDb.site.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1" }, data: { name: "New Name" } }),
    );
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; before: { name: string }; after: { name: string } };
    };
    expect(auditArg.data.action).toBe("SITE_UPDATED");
    expect(auditArg.data.before.name).toBe("Old Name");
    expect(auditArg.data.after.name).toBe("New Name");
  });

  it("rejects unknown sites", async () => {
    mockDb.site.findUnique.mockResolvedValue(null);
    await expect(updateSite("admin-1", { id: "ghost", name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.site.update).not.toHaveBeenCalled();
  });

  it("maps a duplicate name (P2002) to a friendly CONFLICT", async () => {
    mockDb.site.findUnique.mockResolvedValue({ id: "site-1", name: "Old Name" });
    mockDb.site.update.mockRejectedValue(knownRequestError("P2002"));

    await expect(
      updateSite("admin-1", { id: "site-1", name: "Taken Name" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("deleteSite", () => {
  it("blocks deletion when tanks are attached", async () => {
    mockDb.site.findUnique.mockResolvedValue({
      id: "site-1",
      name: "Main Depot",
      _count: { tanks: 2, users: 0 },
    });

    await expect(deleteSite("admin-1", { id: "site-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.site.delete).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("blocks deletion when users are attached", async () => {
    mockDb.site.findUnique.mockResolvedValue({
      id: "site-1",
      name: "Main Depot",
      _count: { tanks: 0, users: 3 },
    });

    await expect(deleteSite("admin-1", { id: "site-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.site.delete).not.toHaveBeenCalled();
  });

  it("rejects unknown sites", async () => {
    mockDb.site.findUnique.mockResolvedValue(null);
    await expect(deleteSite("admin-1", { id: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes an empty site and audits SITE_DELETED", async () => {
    mockDb.site.findUnique.mockResolvedValue({
      id: "site-1",
      name: "Main Depot",
      _count: { tanks: 0, users: 0 },
    });
    mockDb.site.delete.mockResolvedValue({});

    await deleteSite("admin-1", { id: "site-1" });

    expect(mockDb.site.delete).toHaveBeenCalledWith({ where: { id: "site-1" } });
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; before: { name: string } };
    };
    expect(auditArg.data.action).toBe("SITE_DELETED");
    expect(auditArg.data.before.name).toBe("Main Depot");
  });

  it("maps a late FK violation (P2003) to a friendly PRECONDITION_FAILED", async () => {
    mockDb.site.findUnique.mockResolvedValue({
      id: "site-1",
      name: "Main Depot",
      _count: { tanks: 0, users: 0 },
    });
    mockDb.site.delete.mockRejectedValue(knownRequestError("P2003"));

    await expect(deleteSite("admin-1", { id: "site-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
