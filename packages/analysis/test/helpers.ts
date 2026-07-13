// テスト用の固定値・ビルダ。UUID は決定的に採番する（テストの再現性のため乱数は使わない）。
import { markUntrusted, type UntrustedText } from "@is-reach/shared";
import type { CollectedPage, CompanyRecord, SignalRecord } from "../src/index.js";

/** 鮮度判定の基準時刻（全テストで固定） */
export const EVALUATED_AT = "2026-07-13T00:00:00.000Z";

/** 決定的な UUID 採番（例: companyUuid(1) → "00000000-0000-4000-8000-000000000001"） */
export function uuidAt(n: number, block = "8000"): string {
  return `00000000-0000-4000-${block}-${String(n).padStart(12, "0")}`;
}
export const companyUuid = (n: number): string => uuidAt(n, "8000");
export const signalUuid = (n: number): string => uuidAt(n, "9000");

export function buildCompany(n: number, overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: companyUuid(n),
    name: `テスト企業 ${n}`,
    domain: `example-${n}.co.jp`,
    industry: "SaaS",
    employeeRange: "r_50_100",
    region: "tokyo",
    ...overrides,
  };
}

export function buildSignal(
  n: number,
  companyN: number,
  overrides: Partial<SignalRecord> = {},
): SignalRecord {
  return {
    id: signalUuid(n),
    companyId: companyUuid(companyN),
    kind: "job_posting",
    summary: `シグナル ${n} の要約`,
    keywords: [],
    sourceUrl: `https://example-${companyN}.co.jp/signals/${n}`,
    collectedAt: "2026-07-10T02:00:00Z",
    ...overrides,
  };
}

export function untrusted(text: string, sourceUrl: string, collectedAt: string): UntrustedText {
  return markUntrusted({ text, sourceUrl, collectedAt });
}

export function buildPage(
  url: string,
  overrides: Partial<Pick<CollectedPage, "fetchedAt">> & {
    title?: string | null;
    text?: string;
  } = {},
): CollectedPage {
  const fetchedAt = overrides.fetchedAt ?? "2026-07-10T02:00:00Z";
  const title = overrides.title === undefined ? `ページ ${url}` : overrides.title;
  return {
    url,
    fetchedAt,
    title: title === null ? null : untrusted(title, url, fetchedAt),
    text: untrusted(overrides.text ?? `本文 ${url}`, url, fetchedAt),
  };
}
