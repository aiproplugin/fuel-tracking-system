import { describe, expect, it } from "vitest";
import { siteScopeWhere } from "@/server/services/actor";

describe("siteScopeWhere (supervisor data scoping)", () => {
  it("scopes a supervisor to their own site", () => {
    expect(siteScopeWhere({ id: "u1", role: "SUPERVISOR", siteId: "site-1" })).toEqual({
      siteId: "site-1",
    });
  });

  it("gives a supervisor WITHOUT a site nothing (never everything)", () => {
    const where = siteScopeWhere({ id: "u1", role: "SUPERVISOR", siteId: null });
    expect(where.siteId).toBeDefined();
    expect(where.siteId).not.toBeNull();
  });

  it("does not scope managers or admins", () => {
    expect(siteScopeWhere({ id: "u1", role: "MANAGER", siteId: "site-1" })).toEqual({});
    expect(siteScopeWhere({ id: "u1", role: "ADMIN", siteId: null })).toEqual({});
  });
});
