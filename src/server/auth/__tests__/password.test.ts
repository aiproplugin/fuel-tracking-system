import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing (argon2id)", () => {
  it("produces an argon2id hash and verifies the correct password", async () => {
    const hash = await hashPassword("Str0ng!Passw0rd#2026");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Str0ng!Passw0rd#2026")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Str0ng!Passw0rd#2026");
    expect(await verifyPassword(hash, "Wr0ng!Passw0rd#2026")).toBe(false);
  });

  it("returns false (does not throw) for a malformed stored hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
  });

  it("produces unique hashes for the same password (random salt)", async () => {
    const first = await hashPassword("Str0ng!Passw0rd#2026");
    const second = await hashPassword("Str0ng!Passw0rd#2026");
    expect(first).not.toBe(second);
  });
});
