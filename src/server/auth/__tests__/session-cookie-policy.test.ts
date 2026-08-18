import { describe, expect, it } from "vitest";
import type { RoleName } from "@/lib/permissions";
import {
  applySessionCookiePolicy,
  rewriteSessionCookies,
  stripCookieExpiry,
} from "@/server/auth/session-cookie-policy";

const COOKIE = "authjs.session-token";

/** Stand-in for the real JWT decode; the rewriter takes it as a parameter. */
const roleResolver = (role: RoleName | null) => async () => role;

/** A session cookie exactly as Auth.js writes it: persistent, hardened. */
function authjsCookie(value: string, name = COOKIE): string {
  return `${name}=${value}; Path=/; Expires=Thu, 17 Sep 2026 08:00:00 GMT; Max-Age=2592000; HttpOnly; SameSite=Strict`;
}

/** The deletion cookie Auth.js writes on sign-out and on a rejected session. */
function deletionCookie(name = COOKIE): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
}

function hasAttribute(cookie: string, attribute: string): boolean {
  return cookie
    .split(";")
    .slice(1)
    .some((part) => part.trim().toLowerCase().startsWith(`${attribute}=`));
}

describe("stripCookieExpiry", () => {
  it("removes Expires and Max-Age and keeps every security attribute", () => {
    const result = stripCookieExpiry(authjsCookie("token-value"));
    expect(hasAttribute(result, "expires")).toBe(false);
    expect(hasAttribute(result, "max-age")).toBe(false);
    expect(result).toContain("authjs.session-token=token-value");
    expect(result).toContain("HttpOnly");
    expect(result).toContain("SameSite=Strict");
    expect(result).toContain("Path=/");
  });

  it("is case-insensitive about attribute names", () => {
    const result = stripCookieExpiry(
      `${COOKIE}=v; path=/; expires=Thu, 17 Sep 2026 08:00:00 GMT; MAX-AGE=60`,
    );
    expect(hasAttribute(result, "expires")).toBe(false);
    expect(hasAttribute(result, "max-age")).toBe(false);
    expect(result).toContain("path=/");
  });

  it("preserves a Secure flag", () => {
    const result = stripCookieExpiry(`${COOKIE}=v; Path=/; Max-Age=60; Secure; HttpOnly`);
    expect(result).toContain("Secure");
  });
});

describe("rewriteSessionCookies — per-role cookie type", () => {
  for (const role of ["SUPERVISOR", "MANAGER", "ADMIN"] as const) {
    it(`${role}: gets a browser-session cookie (no Expires, no Max-Age)`, async () => {
      const [cookie] = await rewriteSessionCookies(
        [authjsCookie("privileged-token")],
        COOKIE,
        roleResolver(role),
      );
      expect(hasAttribute(cookie!, "expires")).toBe(false);
      expect(hasAttribute(cookie!, "max-age")).toBe(false);
      expect(cookie).toContain("HttpOnly");
    });
  }

  it("OPERATOR: keeps a persistent cookie so pump tablets survive a restart", async () => {
    const [cookie] = await rewriteSessionCookies(
      [authjsCookie("operator-token")],
      COOKIE,
      roleResolver("OPERATOR"),
    );
    expect(hasAttribute(cookie!, "expires")).toBe(true);
    expect(hasAttribute(cookie!, "max-age")).toBe(true);
  });

  it("leaves the sign-out deletion cookie intact, so logout still logs out", async () => {
    const cookies = await rewriteSessionCookies([deletionCookie()], COOKIE, roleResolver("ADMIN"));
    // Max-Age=0 IS the deletion; stripping it would make sign-out a no-op.
    expect(cookies[0]).toBe(deletionCookie());
    expect(hasAttribute(cookies[0]!, "max-age")).toBe(true);
  });

  it("leaves the cookie untouched when the token cannot be decoded", async () => {
    const original = authjsCookie("garbage");
    const cookies = await rewriteSessionCookies([original], COOKIE, roleResolver(null));
    expect(cookies).toEqual([original]);
  });

  it("does not touch unrelated cookies", async () => {
    const csrf = "authjs.csrf-token=abc; Path=/; Max-Age=900; HttpOnly";
    const cookies = await rewriteSessionCookies(
      [csrf, authjsCookie("privileged-token")],
      COOKIE,
      roleResolver("ADMIN"),
    );
    expect(cookies[0]).toBe(csrf);
    expect(hasAttribute(cookies[1]!, "max-age")).toBe(false);
  });

  it("reassembles chunked cookies to read the role, and rewrites every chunk", async () => {
    let seenToken = "";
    const cookies = await rewriteSessionCookies(
      [authjsCookie("head-", `${COOKIE}.0`), authjsCookie("tail", `${COOKIE}.1`)],
      COOKIE,
      async (token) => {
        seenToken = token;
        return "ADMIN";
      },
    );
    expect(seenToken).toBe("head-tail");
    for (const cookie of cookies) {
      expect(hasAttribute(cookie, "expires")).toBe(false);
      expect(hasAttribute(cookie, "max-age")).toBe(false);
    }
  });

  it("passes through a response with no session cookie at all", async () => {
    const other = ["some.other=1; Path=/; Max-Age=60"];
    expect(await rewriteSessionCookies(other, COOKIE, roleResolver("ADMIN"))).toEqual(other);
  });
});

describe("applySessionCookiePolicy — response rewriting", () => {
  it("preserves status and non-cookie headers while rewriting the cookie", async () => {
    const response = new Response(null, {
      status: 302,
      headers: {
        location: "/admin",
        "set-cookie": authjsCookie("privileged-token"),
      },
    });

    const result = await applySessionCookiePolicy(response, COOKIE, roleResolver("ADMIN"));

    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("/admin");
    const [cookie] = result.headers.getSetCookie();
    expect(hasAttribute(cookie!, "expires")).toBe(false);
  });

  it("returns the original response untouched when nothing needs rewriting", async () => {
    const response = new Response("{}", {
      status: 200,
      headers: { "set-cookie": authjsCookie("operator-token") },
    });
    const result = await applySessionCookiePolicy(response, COOKIE, roleResolver("OPERATOR"));
    expect(result).toBe(response);
  });

  it("keeps the response body readable after rewriting", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "set-cookie": authjsCookie("privileged-token") },
    });
    const result = await applySessionCookiePolicy(response, COOKIE, roleResolver("ADMIN"));
    await expect(result.json()).resolves.toEqual({ ok: true });
  });
});
