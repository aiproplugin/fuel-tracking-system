import { describe, expect, it } from "vitest";
import { loginInputSchema, passwordSchema, strictObject, usernameSchema } from "@/lib/validation";
import { z } from "zod";

describe("strictObject", () => {
  it("accepts objects with exactly the declared keys", () => {
    const schema = strictObject({ liters: z.number().positive() });
    expect(schema.safeParse({ liters: 42 }).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const schema = strictObject({ liters: z.number().positive() });
    expect(schema.safeParse({ liters: 42, injected: "x" }).success).toBe(false);
  });
});

describe("usernameSchema", () => {
  it("accepts a valid username", () => {
    expect(usernameSchema.safeParse("nimal.perera").success).toBe(true);
  });

  it("rejects usernames with spaces or special characters", () => {
    expect(usernameSchema.safeParse("nimal perera").success).toBe(false);
    expect(usernameSchema.safeParse("nimal;drop--").success).toBe(false);
  });

  it("rejects usernames shorter than 3 characters", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
  });
});

describe("passwordSchema (account creation policy)", () => {
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Str0ng!Passw0rd#2026").success).toBe(true);
  });

  it("rejects passwords shorter than 12 characters", () => {
    expect(passwordSchema.safeParse("Sh0rt!pw").success).toBe(false);
  });

  it("rejects passwords missing a symbol", () => {
    expect(passwordSchema.safeParse("NoSymbolPassw0rd").success).toBe(false);
  });

  it("rejects passwords missing an uppercase letter", () => {
    expect(passwordSchema.safeParse("nouppercase!passw0rd").success).toBe(false);
  });
});

describe("loginInputSchema", () => {
  it("accepts a normal login payload and tolerates Auth.js extras", () => {
    const result = loginInputSchema.safeParse({
      username: "nimal",
      password: "whatever",
      csrfToken: "injected-by-authjs",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty credentials", () => {
    expect(loginInputSchema.safeParse({ username: "", password: "" }).success).toBe(false);
  });
});
