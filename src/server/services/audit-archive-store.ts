import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * DURABLE STORAGE for archived audit rows — gzipped JSON Lines (.jsonl.gz).
 *
 * JSONL, not CSV: `before` and `after` are JSON columns, and flattening them
 * into CSV cells would be lossy in exactly the records we are promising to
 * preserve. One JSON document per line restores row-for-row and streams.
 *
 * The store is an INTERFACE so the archive service can be tested against a
 * fake that simulates a failed write or a corrupted file, without touching a
 * real disk. Verification is a genuine read-back of what landed on disk — never
 * an assumption that the write succeeded because it did not throw.
 */

/** One archived row. `id` is BigInt in the DB; carried as a decimal string. */
export interface AuditArchiveRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface VerifyResult {
  ok: boolean;
  /** Rows actually read back from the file (0 when unreadable). */
  rowCount: number;
  /** Why verification failed, for the operator. Null when ok. */
  reason: string | null;
  /** SHA-256 of the archive bytes, recorded in the audit event. */
  sha256: string | null;
}

export interface ArchiveStore {
  write(filePath: string, rows: AuditArchiveRow[]): Promise<void>;
  /** Read the file back and prove it holds EXACTLY these ids. */
  verify(filePath: string, expectedIds: readonly string[]): Promise<VerifyResult>;
}

/**
 * BigInt-safe JSON. `AuditLog.id` is a BigInt and JSON.stringify throws on it
 * ("Do not know how to serialize a BigInt"), so ids are converted to strings at
 * the row-building boundary and this stays a plain stringify.
 */
function toJsonLine(row: AuditArchiveRow): string {
  return JSON.stringify(row);
}

export const gzipJsonlStore: ArchiveStore = {
  async write(filePath, rows) {
    await mkdir(dirname(filePath), { recursive: true });
    const body = rows.map(toJsonLine).join("\n") + "\n";
    await writeFile(filePath, gzipSync(Buffer.from(body, "utf8")));
  },

  async verify(filePath, expectedIds) {
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch {
      return {
        ok: false,
        rowCount: 0,
        reason: "archive file is missing or unreadable",
        sha256: null,
      };
    }

    if (bytes.length === 0) {
      return { ok: false, rowCount: 0, reason: "archive file is empty", sha256: null };
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");

    let text: string;
    try {
      text = gunzipSync(bytes).toString("utf8");
    } catch {
      return { ok: false, rowCount: 0, reason: "archive file is not valid gzip", sha256 };
    }

    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    const seen = new Set<string>();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id !== "string") {
          return { ok: false, rowCount: lines.length, reason: "archived row has no id", sha256 };
        }
        seen.add(parsed.id);
      } catch {
        return {
          ok: false,
          rowCount: lines.length,
          reason: "archive contains malformed JSON",
          sha256,
        };
      }
    }

    if (lines.length !== expectedIds.length) {
      return {
        ok: false,
        rowCount: lines.length,
        reason: `archive holds ${lines.length} rows but ${expectedIds.length} were selected`,
        sha256,
      };
    }

    // Count alone is not enough: the file must hold exactly the rows we are
    // about to delete, not merely the same NUMBER of rows.
    const missing = expectedIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        rowCount: lines.length,
        reason: `${missing.length} selected row(s) are not present in the archive`,
        sha256,
      };
    }

    return { ok: true, rowCount: lines.length, reason: null, sha256 };
  },
};
