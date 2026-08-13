import { describe, expect, it } from "vitest";
import { effectiveSiteId, siteScopeWhere } from "@/server/services/actor";
import { testActor } from "@/server/services/__tests__/test-actor";

/**
 * Data scoping is driven by the actor's REPORT-SCOPE permission, not their
 * role. The role-based cases below are the pre-RBAC behaviour (a user with no
 * overrides) and must not change; the override cases prove the scope really
 * does follow the permission.
 */
describe("siteScopeWhere — role defaults (unchanged behaviour)", () => {
  it("scopes a supervisor to their own site", () => {
    expect(siteScopeWhere(testActor("SUPERVISOR", { siteId: "site-1" }))).toEqual({
      siteId: "site-1",
    });
  });

  it("gives a supervisor WITHOUT a site nothing (never everything)", () => {
    const where = siteScopeWhere(testActor("SUPERVISOR", { siteId: null }));
    expect(where.siteId).toBeDefined();
    expect(where.siteId).not.toBeNull();
  });

  it("does not scope managers or admins", () => {
    expect(siteScopeWhere(testActor("MANAGER", { siteId: "site-1" }))).toEqual({});
    expect(siteScopeWhere(testActor("ADMIN", { siteId: null }))).toEqual({});
  });
});

describe("siteScopeWhere — permission overrides", () => {
  it("widens a supervisor granted report.view.all to every site", () => {
    const actor = testActor("SUPERVISOR", {
      siteId: "site-1",
      permissions: ["report.view.all", "masterdata.view"],
    });
    expect(siteScopeWhere(actor)).toEqual({});
  });

  it("narrows a manager denied report.view.all to their own site", () => {
    const actor = testActor("MANAGER", {
      siteId: "site-2",
      permissions: ["report.view.site", "masterdata.view"],
    });
    expect(siteScopeWhere(actor)).toEqual({ siteId: "site-2" });
  });

  it("FAILS CLOSED for an actor with no scope permission at all", () => {
    const actor = testActor("MANAGER", { siteId: "site-2", permissions: ["masterdata.view"] });
    expect(siteScopeWhere(actor)).toEqual({ siteId: "__none__" });
  });
});

describe("effectiveSiteId", () => {
  it("pins a site-scoped actor to their own site, ignoring any request", () => {
    const actor = testActor("SUPERVISOR", { siteId: "site-1" });
    expect(effectiveSiteId(actor, "site-999")).toBe("site-1");
  });

  it("lets an all-sites actor narrow to a requested site", () => {
    expect(effectiveSiteId(testActor("MANAGER"), "site-3")).toBe("site-3");
  });

  it("returns undefined (all sites) for an all-sites actor with no request", () => {
    expect(effectiveSiteId(testActor("ADMIN"), null)).toBeUndefined();
  });

  it("FAILS CLOSED for an actor with no scope permission", () => {
    const actor = testActor("OPERATOR", { siteId: "site-1", permissions: ["fuel.issue"] });
    expect(effectiveSiteId(actor, "site-1")).toBe("__none__");
  });
});
