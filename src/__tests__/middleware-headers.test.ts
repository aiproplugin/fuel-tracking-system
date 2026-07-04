import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";

function run(url = "https://fuel.internal.example/login") {
  return middleware(new NextRequest(url));
}

/** Pull one CSP directive (e.g. "script-src") out of the header value. */
function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `) || part === name) ?? ""
  );
}

describe("security headers middleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("in production: nonce-based CSP with NO 'unsafe-inline' in script-src", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = run();
    const csp = res.headers.get("content-security-policy") ?? "";
    const scriptSrc = directive(csp, "script-src");

    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("sets the full set of production security headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = run();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=(self)");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("mints a fresh nonce per request", () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = run().headers.get("content-security-policy") ?? "";
    const b = run().headers.get("content-security-policy") ?? "";
    const nonceA = a.match(/'nonce-([^']+)'/)?.[1];
    const nonceB = b.match(/'nonce-([^']+)'/)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });

  it("in development: no HSTS and a permissive dev script-src", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = run("http://localhost:3000/login");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(directive(csp, "script-src")).toContain("'unsafe-inline'");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});
