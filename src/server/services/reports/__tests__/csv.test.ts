import { describe, expect, it } from "vitest";
import { reportToCsv } from "@/server/services/reports/csv";
import type { ReportResult } from "@/server/services/reports/report-types";

function makeResult(rows: ReportResult["rows"]): ReportResult {
  return {
    key: "vehicle-usage",
    columns: [
      { key: "note", label: "Note", type: "text" },
      { key: "liters", label: "Liters", type: "liters" },
    ],
    rows,
    summary: [],
    totalRows: rows.length,
    truncated: false,
    meta: { title: "Test", generatedAt: "2026-07-03T00:00:00.000Z", scopeNote: "All sites", range: { from: null, to: null } },
  };
}

describe("reportToCsv", () => {
  it("prepends a UTF-8 BOM and a CRLF header row", () => {
    const csv = reportToCsv(makeResult([]));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Note,Liters\r\n");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = reportToCsv(makeResult([{ note: 'a,"b"\nc', liters: 1234.5 }]));
    expect(csv).toContain('"a,""b""\nc"');
    // 1,234.5 L contains a comma from the thousands separator, so it is quoted.
    expect(csv).toContain('"1,234.5 L"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const csv = reportToCsv(makeResult([{ note: "=1+1", liters: 0 }]));
    expect(csv).toContain("'=1+1");
    expect(csv).not.toContain(",=1+1");
  });
});
