import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gzipJsonlStore, type AuditArchiveRow } from "@/server/services/audit-archive-store";

/**
 * Real disk round-trip for the archive store. The service tests use a fake
 * store to exercise the abort paths; these prove the REAL writer produces a
 * file the REAL verifier accepts — and rejects every way it can be wrong.
 */

let dir: string;

function row(id: string, overrides: Partial<AuditArchiveRow> = {}): AuditArchiveRow {
  return {
    id,
    actorId: "user-1",
    action: "LOGIN_SUCCESS",
    entityType: "user",
    entityId: "user-1",
    before: null,
    after: { ok: true, nested: { deep: [1, 2, 3] } },
    ipAddress: "10.0.0.5",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "audit-archive-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("gzipJsonlStore", () => {
  it("writes gzipped JSON Lines that verify against the selected ids", async () => {
    const file = join(dir, "ok.jsonl.gz");
    const rows = [row("1"), row("2"), row("3")];

    await gzipJsonlStore.write(file, rows);
    const result = await gzipJsonlStore.verify(file, ["1", "2", "3"]);

    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.reason).toBeNull();
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips the full row, JSON columns included", async () => {
    const file = join(dir, "fidelity.jsonl.gz");
    const original = row("42", { before: { a: [1, { b: null }] }, after: { c: "ü€" } });

    await gzipJsonlStore.write(file, [original]);
    const text = gunzipSync(await readFile(file)).toString("utf8");

    expect(JSON.parse(text.trim())).toEqual(original);
  });

  it("creates the archive directory when it does not exist", async () => {
    const file = join(dir, "nested", "deeper", "created.jsonl.gz");
    await gzipJsonlStore.write(file, [row("1")]);
    await expect(gzipJsonlStore.verify(file, ["1"])).resolves.toMatchObject({ ok: true });
  });

  it("rejects a missing file", async () => {
    const result = await gzipJsonlStore.verify(join(dir, "nope.jsonl.gz"), ["1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing");
  });

  it("rejects an empty file", async () => {
    const file = join(dir, "empty.jsonl.gz");
    await writeFile(file, Buffer.alloc(0));
    const result = await gzipJsonlStore.verify(file, ["1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("rejects a file that is not valid gzip", async () => {
    const file = join(dir, "plain.jsonl.gz");
    await writeFile(file, Buffer.from("not gzip at all", "utf8"));
    const result = await gzipJsonlStore.verify(file, ["1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("gzip");
  });

  it("rejects a truncated archive (count mismatch)", async () => {
    const file = join(dir, "short.jsonl.gz");
    await gzipJsonlStore.write(file, [row("1"), row("2")]);

    const result = await gzipJsonlStore.verify(file, ["1", "2", "3"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("2 rows but 3 were selected");
  });

  it("rejects an archive holding the RIGHT COUNT of the WRONG rows", async () => {
    const file = join(dir, "swapped.jsonl.gz");
    await gzipJsonlStore.write(file, [row("7"), row("8")]);

    const result = await gzipJsonlStore.verify(file, ["1", "2"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not present in the archive");
  });

  it("rejects malformed JSON inside the archive", async () => {
    const file = join(dir, "corrupt.jsonl.gz");
    await writeFile(file, gzipSync(Buffer.from('{"id":"1"}\n{not json}\n', "utf8")));

    const result = await gzipJsonlStore.verify(file, ["1", "2"]);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("malformed JSON");
  });
});
