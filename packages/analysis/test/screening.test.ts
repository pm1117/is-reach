import { describe, expect, it } from "vitest";
import { runScreeningSearch } from "../src/index.js";
import { EVALUATED_AT, buildCompany, buildSignal, companyUuid, signalUuid } from "./helpers.js";

describe("runScreeningSearch: 属性フィルタ", () => {
  const companies = [
    buildCompany(1, { industry: "SaaS", employeeRange: "r_50_100", region: "tokyo" }),
    buildCompany(2, { industry: "製造", employeeRange: "r_50_100", region: "osaka" }),
    buildCompany(3, { industry: "SaaS", employeeRange: "r_100_300", region: "tokyo" }),
    buildCompany(4, { industry: null, employeeRange: null, region: null }),
  ];

  it("industries / employeeRanges / regions は AND で絞り込む", () => {
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: {
        attributes: { industries: ["SaaS"], employeeRanges: ["r_50_100"], regions: ["tokyo"] },
      },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.map((r) => r.company.id)).toEqual([companyUuid(1)]);
    expect(response.total).toBe(1);
  });

  it("同一条件内の複数値は OR（いずれかに一致）", () => {
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: { attributes: { industries: ["SaaS", "製造"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.map((r) => r.company.id)).toEqual([
      companyUuid(1),
      companyUuid(2),
      companyUuid(3),
    ]);
  });

  it("属性が null の企業は指定条件を満たさない", () => {
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: { attributes: { industries: ["SaaS", "製造"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.some((r) => r.company.id === companyUuid(4))).toBe(false);
  });

  it("空配列の条件は「条件なし」として無視する", () => {
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: { attributes: { industries: [] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.total).toBe(4);
  });
});

describe("runScreeningSearch: シグナル条件と根拠", () => {
  it("kinds: マッチした種別のシグナルだけが根拠になる（マッチしていないシグナルを入れない）", () => {
    const companies = [buildCompany(1)];
    const signals = [
      buildSignal(1, 1, { kind: "job_posting" }),
      buildSignal(2, 1, { kind: "tech_blog" }),
    ];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { kinds: ["job_posting"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.matchedSignals.map((s) => s.signalId)).toEqual([signalUuid(1)]);
  });

  it("シグナル条件があるのにマッチ 0 件の企業は結果から除外する（根拠が必ず付く）", () => {
    const companies = [buildCompany(1), buildCompany(2)];
    const signals = [buildSignal(1, 1, { kind: "press_release" })];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { kinds: ["press_release"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.map((r) => r.company.id)).toEqual([companyUuid(1)]);
    for (const result of response.results) {
      expect(result.matchedSignals.length).toBeGreaterThan(0);
    }
  });

  it("keywords: 大文字小文字を区別せず部分一致（summary と抽出キーワードの両方が対象）", () => {
    const companies = [buildCompany(1), buildCompany(2), buildCompany(3)];
    const signals = [
      buildSignal(1, 1, { summary: "React エンジニア募集" }),
      buildSignal(2, 2, { summary: "特に無し", keywords: ["react", "TypeScript"] }),
      buildSignal(3, 3, { summary: "Vue の求人" }),
    ];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { keywords: ["REACT"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.map((r) => r.company.id)).toEqual([companyUuid(1), companyUuid(2)]);
  });

  it("keywords: NFKC 正規化で全角英数の表記ゆれを吸収する（日英混在の前提）", () => {
    const companies = [buildCompany(1)];
    const signals = [buildSignal(1, 1, { summary: "Ｒｅａｃｔエンジニア採用強化中" })];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { keywords: ["react"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results).toHaveLength(1);
  });

  it("keywords は複数指定で OR（いずれかのヒットでマッチ）", () => {
    const companies = [buildCompany(1), buildCompany(2)];
    const signals = [
      buildSignal(1, 1, { summary: "Go の求人" }),
      buildSignal(2, 2, { summary: "デザイナー募集" }),
    ];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { keywords: ["Go", "React"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results.map((r) => r.company.id)).toEqual([companyUuid(1)]);
  });

  it("kinds + keywords + freshWithinDays はシグナル内 AND", () => {
    const companies = [buildCompany(1)];
    const signals = [
      // kind 不一致
      buildSignal(1, 1, { kind: "tech_blog", summary: "React の記事" }),
      // キーワード不一致
      buildSignal(2, 1, { kind: "job_posting", summary: "Vue の求人" }),
      // 古い
      buildSignal(3, 1, {
        kind: "job_posting",
        summary: "React の求人（古い）",
        collectedAt: "2026-01-01T00:00:00Z",
      }),
      // すべて満たす
      buildSignal(4, 1, {
        kind: "job_posting",
        summary: "React の求人",
        collectedAt: "2026-07-12T00:00:00Z",
      }),
    ];
    const response = runScreeningSearch({
      companies,
      signals,
      request: {
        signals: { kinds: ["job_posting"], keywords: ["React"], freshWithinDays: 30 },
      },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results[0]?.matchedSignals.map((s) => s.signalId)).toEqual([signalUuid(4)]);
  });

  it("シグナル条件が無い場合は全シグナルが根拠になり、シグナル無し企業も返る", () => {
    const companies = [buildCompany(1), buildCompany(2)];
    const signals = [buildSignal(1, 1), buildSignal(2, 1, { kind: "tech_blog" })];
    const response = runScreeningSearch({
      companies,
      signals,
      request: {},
      evaluatedAt: EVALUATED_AT,
    });
    const first = response.results.find((r) => r.company.id === companyUuid(1));
    const second = response.results.find((r) => r.company.id === companyUuid(2));
    expect(first?.matchedSignals).toHaveLength(2);
    expect(second?.matchedSignals).toEqual([]);
    expect(second?.score).toBe(0);
  });

  it("companies に存在しない companyId のシグナルは無視する", () => {
    const companies = [buildCompany(1)];
    const signals = [buildSignal(1, 99)];
    const response = runScreeningSearch({
      companies,
      signals,
      request: { signals: { kinds: ["job_posting"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results).toEqual([]);
    expect(response.total).toBe(0);
  });
});

describe("runScreeningSearch: freshWithinDays の境界", () => {
  const N = 7;
  const request = { signals: { freshWithinDays: N } };
  const companies = [buildCompany(1)];

  const search = (collectedAt: string) =>
    runScreeningSearch({
      companies,
      signals: [buildSignal(1, 1, { collectedAt })],
      request,
      evaluatedAt: EVALUATED_AT,
    });

  it("当日（基準時刻ちょうど）は含む", () => {
    expect(search(EVALUATED_AT).total).toBe(1);
  });

  it("ちょうど N 日前は含む（境界は包含）", () => {
    expect(search("2026-07-06T00:00:00.000Z").total).toBe(1);
  });

  it("N 日前より 1 ミリ秒でも古いと除外する", () => {
    expect(search("2026-07-05T23:59:59.999Z").total).toBe(0);
  });

  it("N+1 日前は除外する", () => {
    expect(search("2026-07-05T00:00:00.000Z").total).toBe(0);
  });

  it("未来の収集日時（時計ずれ）は新鮮側として含む", () => {
    expect(search("2026-07-13T01:00:00.000Z").total).toBe(1);
  });
});

describe("runScreeningSearch: スコアと順序の決定性", () => {
  const companies = [buildCompany(1), buildCompany(2), buildCompany(3)];
  const signals = [
    buildSignal(1, 1, { summary: "React の求人", collectedAt: "2026-07-12T00:00:00Z" }),
    buildSignal(2, 2, {
      summary: "React と TypeScript の求人",
      collectedAt: "2026-07-12T00:00:00Z",
    }),
    buildSignal(3, 2, { summary: "React 採用", collectedAt: "2026-03-01T00:00:00Z" }),
    buildSignal(4, 3, { summary: "React", collectedAt: "2026-07-12T00:00:00Z" }),
  ];
  const request = { signals: { keywords: ["React", "TypeScript"] } };

  it("同一入力 → 同一スコア・同一順序（深い等価）", () => {
    const a = runScreeningSearch({ companies, signals, request, evaluatedAt: EVALUATED_AT });
    const b = runScreeningSearch({ companies, signals, request, evaluatedAt: EVALUATED_AT });
    expect(a).toEqual(b);
  });

  it("入力配列の順序を変えても同一の結果になる（全順序による整列）", () => {
    const a = runScreeningSearch({ companies, signals, request, evaluatedAt: EVALUATED_AT });
    const b = runScreeningSearch({
      companies: [...companies].reverse(),
      signals: [...signals].reverse(),
      request,
      evaluatedAt: EVALUATED_AT,
    });
    expect(a).toEqual(b);
  });

  it("スコア: 基礎点 + キーワードヒット数 + 鮮度の重み付き加点になっている", () => {
    const response = runScreeningSearch({ companies, signals, request, evaluatedAt: EVALUATED_AT });
    const byId = new Map(response.results.map((r) => [r.company.id, r]));
    // 企業1: シグナル1件（キーワード1ヒット・1日前）= 10 + 5*1 + 5 = 20
    expect(byId.get(companyUuid(1))?.score).toBe(20);
    // 企業2: シグナル2件 = (10 + 5*2 + 5) + (10 + 5*1 + 0[134日前]) = 25 + 15 = 40
    expect(byId.get(companyUuid(2))?.score).toBe(40);
    // 企業3: シグナル1件（キーワード1ヒット・1日前）= 20
    expect(byId.get(companyUuid(3))?.score).toBe(20);
  });

  it("並び順は score 降順 → company.id 昇順、根拠は collectedAt 降順 → signalId 昇順", () => {
    const response = runScreeningSearch({ companies, signals, request, evaluatedAt: EVALUATED_AT });
    expect(response.results.map((r) => r.company.id)).toEqual([
      companyUuid(2), // score 40
      companyUuid(1), // score 20・id が小さい
      companyUuid(3), // score 20
    ]);
    expect(response.results[0]?.matchedSignals.map((s) => s.signalId)).toEqual([
      signalUuid(2), // 2026-07-12（新しい）
      signalUuid(3), // 2026-03-01
    ]);
  });

  it("同一 id のシグナルの重複行は 1 件に正規化する（スコア二重加点・根拠重複を防ぐ）", () => {
    const signal = buildSignal(1, 1, {
      summary: "React の求人",
      collectedAt: "2026-07-12T00:00:00Z",
    });
    const single = runScreeningSearch({
      companies: [buildCompany(1)],
      signals: [signal],
      request,
      evaluatedAt: EVALUATED_AT,
    });
    const duplicated = runScreeningSearch({
      companies: [buildCompany(1)],
      signals: [signal, { ...signal }],
      request,
      evaluatedAt: EVALUATED_AT,
    });
    expect(duplicated).toEqual(single);
    expect(duplicated.results[0]?.matchedSignals).toHaveLength(1);
  });

  it("正規化後に同一になるキーワードは 1 語として扱い二重加点しない", () => {
    const companies = [buildCompany(1)];
    const signalsOne = [
      buildSignal(1, 1, { summary: "React の求人", collectedAt: "2026-07-12T00:00:00Z" }),
    ];
    const base = runScreeningSearch({
      companies,
      signals: signalsOne,
      request: { signals: { keywords: ["React"] } },
      evaluatedAt: EVALUATED_AT,
    });
    const withDuplicateKeywords = runScreeningSearch({
      companies,
      signals: signalsOne,
      request: { signals: { keywords: ["React", "REACT", "Ｒｅａｃｔ"] } },
      evaluatedAt: EVALUATED_AT,
    });
    expect(withDuplicateKeywords.results[0]?.score).toBe(base.results[0]?.score);
  });

  it("同一 id の企業の重複行は先勝ちで 1 件に正規化する", () => {
    const response = runScreeningSearch({
      companies: [buildCompany(1, { name: "先の行" }), buildCompany(1, { name: "後の行" })],
      signals: [],
      request: {},
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.total).toBe(1);
    expect(response.results[0]?.company.name).toBe("先の行");
  });
});

describe("runScreeningSearch: limit と入力検証", () => {
  it("limit 未指定は shared スキーマの既定 200 を適用する（total は絞り込み前の件数）", () => {
    const companies = Array.from({ length: 250 }, (_, i) => buildCompany(i + 1));
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: {},
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results).toHaveLength(200);
    expect(response.total).toBe(250);
  });

  it("limit を指定すると先頭からその件数を返す", () => {
    const companies = [buildCompany(1), buildCompany(2), buildCompany(3)];
    const response = runScreeningSearch({
      companies,
      signals: [],
      request: { limit: 2 },
      evaluatedAt: EVALUATED_AT,
    });
    expect(response.results).toHaveLength(2);
    expect(response.total).toBe(3);
  });

  it("limit 501 は shared スキーマが拒否する", () => {
    expect(() =>
      runScreeningSearch({
        companies: [],
        signals: [],
        request: { limit: 501 },
        evaluatedAt: EVALUATED_AT,
      }),
    ).toThrowError();
  });

  it("不正な入力（enum 外 kind・不正 URL・不正日時）はスキーマ検証で拒否する", () => {
    const base = {
      companies: [buildCompany(1)],
      signals: [buildSignal(1, 1)],
      request: {},
      evaluatedAt: EVALUATED_AT,
    };
    expect(() =>
      runScreeningSearch({
        ...base,
        signals: [{ ...buildSignal(1, 1), kind: "sns" as never }],
      }),
    ).toThrowError();
    expect(() =>
      runScreeningSearch({
        ...base,
        signals: [buildSignal(1, 1, { sourceUrl: "javascript:alert(1)" })],
      }),
    ).toThrowError();
    expect(() => runScreeningSearch({ ...base, evaluatedAt: "2026/07/13" })).toThrowError();
  });
});
