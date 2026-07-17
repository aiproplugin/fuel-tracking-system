import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    company: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import {
  createCompany,
  deleteCompany,
  updateCompany,
} from "@/server/services/company.service";

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

describe("createCompany", () => {
  it("creates and audits COMPANY_CREATED", async () => {
    mockDb.company.create.mockResolvedValue({ id: "co-1", name: "Multilac" });

    const result = await createCompany("admin-1", { name: "Multilac" });

    expect(result).toEqual({ id: "co-1", name: "Multilac" });
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditArg.data.action).toBe("COMPANY_CREATED");
  });

  it("maps a duplicate name (P2002) to a friendly CONFLICT", async () => {
    mockDb.company.create.mockRejectedValue(knownRequestError("P2002"));

    await expect(createCompany("admin-1", { name: "Multilac" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("updateCompany", () => {
  it("renames and audits COMPANY_UPDATED with before/after", async () => {
    mockDb.company.findUnique.mockResolvedValue({ id: "co-1", name: "Old Name" });
    mockDb.company.update.mockResolvedValue({});

    await updateCompany("admin-1", { id: "co-1", name: "Mandarina" });

    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; before: { name: string }; after: { name: string } };
    };
    expect(auditArg.data.action).toBe("COMPANY_UPDATED");
    expect(auditArg.data.before.name).toBe("Old Name");
    expect(auditArg.data.after.name).toBe("Mandarina");
  });

  it("rejects unknown companies", async () => {
    mockDb.company.findUnique.mockResolvedValue(null);
    await expect(updateCompany("admin-1", { id: "ghost", name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.company.update).not.toHaveBeenCalled();
  });
});

describe("deleteCompany (delete-when-empty guard)", () => {
  it("blocks deletion when sites are attached", async () => {
    mockDb.company.findUnique.mockResolvedValue({
      id: "co-1",
      name: "Macktiles",
      _count: { sites: 2, vehicles: 0 },
    });

    await expect(deleteCompany("admin-1", { id: "co-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.company.delete).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("blocks deletion when vehicles are attached", async () => {
    mockDb.company.findUnique.mockResolvedValue({
      id: "co-1",
      name: "Macktiles",
      _count: { sites: 0, vehicles: 4 },
    });

    await expect(deleteCompany("admin-1", { id: "co-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.company.delete).not.toHaveBeenCalled();
  });

  it("rejects unknown companies", async () => {
    mockDb.company.findUnique.mockResolvedValue(null);
    await expect(deleteCompany("admin-1", { id: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes an empty company and audits COMPANY_DELETED", async () => {
    mockDb.company.findUnique.mockResolvedValue({
      id: "co-1",
      name: "Macktiles",
      _count: { sites: 0, vehicles: 0 },
    });
    mockDb.company.delete.mockResolvedValue({});

    await deleteCompany("admin-1", { id: "co-1" });

    expect(mockDb.company.delete).toHaveBeenCalledWith({ where: { id: "co-1" } });
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; before: { name: string } };
    };
    expect(auditArg.data.action).toBe("COMPANY_DELETED");
    expect(auditArg.data.before.name).toBe("Macktiles");
  });

  it("maps a late FK violation (P2003) to a friendly PRECONDITION_FAILED", async () => {
    mockDb.company.findUnique.mockResolvedValue({
      id: "co-1",
      name: "Macktiles",
      _count: { sites: 0, vehicles: 0 },
    });
    mockDb.company.delete.mockRejectedValue(knownRequestError("P2003"));

    await expect(deleteCompany("admin-1", { id: "co-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
