// スクリーニング検索（パイプライン ② — basic-design 4.2。LLM 不使用・同期・純粋ロジック）。
//
// 【フィルタ規則 — 決定】
// - 企業属性（industries / employeeRanges / regions）: 指定された非空配列ごとに AND。
//   各条件は「企業の属性値が配列のいずれかに一致（facets の区分値どうしの完全一致）」。
//   属性が null の企業は当該条件を満たさない。空配列は「条件なし」として無視する。
// - シグナル条件（kinds / keywords / freshWithinDays）: 1 つのシグナルが指定された
//   すべての条件を同時に満たすときのみ「マッチしたシグナル」とする（シグナル内 AND）。
//   keywords は「いずれかのキーワードがヒット」で満たす（キーワード間 OR。ヒット数は加点対象）。
//   キーワード照合は大文字小文字を区別せず NFKC 正規化のうえ部分一致（→ internal/text-match.ts）。
// - シグナル条件が 1 つでも指定された場合、マッチしたシグナルが 0 件の企業は結果から除外する
//   （根拠のない企業を返さない — 要件 F1 受け入れ条件 2）。
// - シグナル条件が未指定の場合は属性のみで絞り込み、企業の全シグナルが（空条件を自明に
//   満たすため）根拠となる。シグナルを持たない企業も結果に含まれる（matchedSignals は空）。
// - freshWithinDays: 「ちょうど N 日前」は含み、それより古いものは除外する（境界は包含）。
//
// 【決定性 — 決定】
// 同一入力 → 同一スコア・同一順序。並び順は全順序（score 降順 → company.id 昇順、
// matchedSignals は collectedAt 降順 → signalId 昇順）で定め、入力配列の順序にも依存しない。
import { z } from "zod";
import {
  isoDateTimeSchema,
  screeningSearchRequestSchema,
  type MatchedSignal,
  type ScreeningSearchRequestInput,
  type ScreeningSearchResponse,
} from "@is-reach/shared";
import {
  companyRecordSchema,
  signalRecordSchema,
  type CompanyRecord,
  type SignalRecord,
} from "./inputs.js";
import { ageInDays, DAY_MS, scoreSignal } from "./scoring.js";
import { compareStrings } from "./internal/compare.js";
import { anyIncludes, normalizeForMatch } from "./internal/text-match.js";

const companiesSchema = z.array(companyRecordSchema);
const signalsSchema = z.array(signalRecordSchema);

export interface ScreeningInput {
  /** 検索対象の企業（共有プール。取得は apps/api の責務） */
  companies: readonly CompanyRecord[];
  /** 企業に紐づく公開シグナル（companyId が companies に無いものは無視される） */
  signals: readonly SignalRecord[];
  /** 検索条件（shared の契約。limit の既定 200・最大 500 はスキーマが適用する） */
  request: ScreeningSearchRequestInput;
  /**
   * 鮮度判定・鮮度ボーナスの基準時刻（ISO 8601）。
   * 決定性のため現在時刻は内部で取得しない。通常は呼び出し側が検索実行時刻を渡す。
   */
  evaluatedAt: string;
}

/** 属性条件: 空配列・未指定は「条件なし」。null 属性は指定条件を満たさない */
function attributeMatches(filter: readonly string[] | undefined, value: string | null): boolean {
  if (filter === undefined || filter.length === 0) return true;
  if (value === null) return false;
  return filter.includes(value);
}

/**
 * スクリーニング検索を実行する（同期・決定的）。
 *
 * 入力はすべてスキーマ検証してから使う。検証に失敗した場合は ZodError を投げる
 * （呼び出し側 = apps/api が VALIDATION_FAILED 等に変換する）。
 */
export function runScreeningSearch(input: ScreeningInput): ScreeningSearchResponse {
  const request = screeningSearchRequestSchema.parse(input.request);
  const companies = companiesSchema.parse(input.companies);
  const signals = signalsSchema.parse(input.signals);
  const evaluatedAtMs = Date.parse(isoDateTimeSchema.parse(input.evaluatedAt));

  const kinds = request.signals?.kinds ?? [];
  const keywords = request.signals?.keywords ?? [];
  const freshWithinDays = request.signals?.freshWithinDays;
  const hasSignalCondition =
    kinds.length > 0 || keywords.length > 0 || freshWithinDays !== undefined;
  // 正規化後に同一になるキーワード（例: "React" と "REACT"）は 1 語に正規化する
  // （「ヒットした検索キーワードの異なり数」で加点するため二重加点を防ぐ — scoring.ts）
  const normalizedKeywords = [...new Set(keywords.map(normalizeForMatch))];
  /** freshWithinDays の境界（この時刻ちょうどに収集されたシグナルは含む） */
  const freshSinceMs =
    freshWithinDays === undefined ? undefined : evaluatedAtMs - freshWithinDays * DAY_MS;

  // シグナルを企業 id で索引化（companies に無い companyId のシグナルは自然に使われない）。
  // 同一 id の重複行は企業と同じく先勝ちで 1 件に正規化する（スコア二重加点・根拠重複の防止）
  const signalsByCompany = new Map<string, SignalRecord[]>();
  const seenSignalIds = new Set<string>();
  for (const signal of signals) {
    if (seenSignalIds.has(signal.id)) continue;
    seenSignalIds.add(signal.id);
    const bucket = signalsByCompany.get(signal.companyId);
    if (bucket === undefined) {
      signalsByCompany.set(signal.companyId, [signal]);
    } else {
      bucket.push(signal);
    }
  }

  /** 1 シグナルがヒットした検索キーワードの異なり数（照合対象は summary + 抽出キーワード） */
  const countKeywordHits = (signal: SignalRecord): number => {
    if (normalizedKeywords.length === 0) return 0;
    const haystacks = [signal.summary, ...signal.keywords].map(normalizeForMatch);
    let hits = 0;
    for (const needle of normalizedKeywords) {
      if (anyIncludes(haystacks, needle)) hits += 1;
    }
    return hits;
  };

  const matched: ScreeningSearchResponse["results"] = [];
  const seenCompanyIds = new Set<string>();

  for (const company of companies) {
    // 同一 id の重複行は先勝ちで 1 件に正規化する（結果の重複を防ぐ）
    if (seenCompanyIds.has(company.id)) continue;
    seenCompanyIds.add(company.id);

    if (
      !attributeMatches(request.attributes?.industries, company.industry) ||
      !attributeMatches(request.attributes?.employeeRanges, company.employeeRange) ||
      !attributeMatches(request.attributes?.regions, company.region)
    ) {
      continue;
    }

    // シグナル条件をすべて満たすシグナルだけがマッチ（根拠・スコアの対象）になる
    const matchedSignals: { signal: SignalRecord; keywordHits: number; collectedAtMs: number }[] =
      [];
    for (const signal of signalsByCompany.get(company.id) ?? []) {
      if (kinds.length > 0 && !kinds.includes(signal.kind)) continue;
      const collectedAtMs = Date.parse(signal.collectedAt);
      if (freshSinceMs !== undefined && collectedAtMs < freshSinceMs) continue;
      const keywordHits = countKeywordHits(signal);
      if (normalizedKeywords.length > 0 && keywordHits === 0) continue;
      matchedSignals.push({ signal, keywordHits, collectedAtMs });
    }

    // シグナル条件があるのにマッチ根拠が 1 件も無い企業は返さない（要件 F1 受け入れ条件 2）
    if (hasSignalCondition && matchedSignals.length === 0) continue;

    const score = matchedSignals.reduce(
      (sum, entry) =>
        sum +
        scoreSignal({
          keywordHits: entry.keywordHits,
          ageDays: ageInDays(entry.collectedAtMs, evaluatedAtMs),
        }),
      0,
    );

    // 根拠は新しい順（同時刻は signalId 昇順）で返す — 決定的な全順序
    matchedSignals.sort(
      (a, b) => b.collectedAtMs - a.collectedAtMs || compareStrings(a.signal.id, b.signal.id),
    );
    const evidence: MatchedSignal[] = matchedSignals.map(({ signal }) => ({
      signalId: signal.id,
      kind: signal.kind,
      summary: signal.summary,
      sourceUrl: signal.sourceUrl,
      collectedAt: signal.collectedAt,
    }));

    matched.push({
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain,
        industry: company.industry,
        employeeRange: company.employeeRange,
        region: company.region,
      },
      score,
      matchedSignals: evidence,
    });
  }

  // score 降順 → company.id 昇順の全順序（入力順に依存しない決定的な並び）
  matched.sort((a, b) => b.score - a.score || compareStrings(a.company.id, b.company.id));

  return {
    results: matched.slice(0, request.limit),
    total: matched.length,
  };
}
