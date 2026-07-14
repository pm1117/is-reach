// 日時フォーマット標準 `YYYY-MM-DD HH:mm`（JST — ui-spec 1.3）
import { describe, expect, it } from "vitest";
import { formatDateTimeJst } from "@/lib/format/date";

describe("formatDateTimeJst", () => {
  it("ISO 8601（UTC）を JST の YYYY-MM-DD HH:mm に整形する", () => {
    expect(formatDateTimeJst("2026-07-10T02:05:00Z")).toBe("2026-07-10 11:05");
  });

  it("日付をまたぐ変換（UTC 15 時以降は JST 翌日）", () => {
    expect(formatDateTimeJst("2026-12-31T15:30:00Z")).toBe("2027-01-01 00:30");
  });

  it("パース不能な入力はプレースホルダを返す（画面を壊さない）", () => {
    expect(formatDateTimeJst("not-a-date")).toBe("—");
    expect(formatDateTimeJst("")).toBe("—");
  });
});
