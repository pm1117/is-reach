// ルールベーススコアの方式と重み（LLM 不使用 — 要件 F1）。
//
// 【スコア方式 — 実装フェーズの提案（人間確認対象）】
// 設計書（design-detail 2.3）はスコア式を規定していないため、以下の説明可能な加点方式を
// 提案として実装する。方式・重みはこのファイルの定数に集約し、変更はここだけで済むようにする。
//
//   企業スコア   = Σ（マッチした各シグナルのシグナルスコア）
//   シグナルスコア = SIGNAL_BASE（マッチしたこと自体の基礎点）
//                 + KEYWORD_HIT × そのシグナルにヒットした検索キーワードの異なり数
//                 + 鮮度ボーナス（収集日時が基準時刻からどれだけ新しいか。段階制）
//
// - マッチしていないシグナルはスコアにも根拠（matchedSignals）にも入れない（要件 F1）
// - 決定性: 同一入力（companies / signals / request / evaluatedAt）→ 同一スコア。
//   現在時刻を内部で参照しない（基準時刻 evaluatedAt は呼び出し側が渡す）
// - 重みはすべて整数のため、加算順序による浮動小数点誤差は発生しない

export const DAY_MS = 24 * 60 * 60 * 1000;

/** スクリーニングスコアの重み（一箇所に集約 — 人間確認対象の提案値） */
export const SCREENING_SCORE_WEIGHTS = {
  /** マッチしたシグナル 1 件あたりの基礎点 */
  signalBase: 10,
  /** 検索キーワード 1 語がそのシグナルにヒットするごとの加点 */
  keywordHit: 5,
  /**
   * 鮮度ボーナス（経過日数の少ない順に評価し、最初に該当した段の bonus を加点。
   * 境界は「ちょうど N 日前」を含む。どの段にも該当しなければ 0）
   */
  freshnessTiers: [
    { maxAgeDays: 7, bonus: 5 },
    { maxAgeDays: 30, bonus: 3 },
    { maxAgeDays: 90, bonus: 1 },
  ],
} as const;

/**
 * 収集日時の経過日数（基準時刻からの日数。未来日時は 0 に丸める）。
 * 決定性のため Date.now() は使わず、呼び出し側が基準時刻を渡す。
 */
export function ageInDays(collectedAtMs: number, evaluatedAtMs: number): number {
  return Math.max(0, (evaluatedAtMs - collectedAtMs) / DAY_MS);
}

/** 鮮度ボーナス（段階制。ちょうど maxAgeDays 日は当該段に含む） */
export function freshnessBonus(ageDays: number): number {
  for (const tier of SCREENING_SCORE_WEIGHTS.freshnessTiers) {
    if (ageDays <= tier.maxAgeDays) return tier.bonus;
  }
  return 0;
}

/** マッチした 1 シグナルのスコア */
export function scoreSignal(params: { keywordHits: number; ageDays: number }): number {
  return (
    SCREENING_SCORE_WEIGHTS.signalBase +
    SCREENING_SCORE_WEIGHTS.keywordHit * params.keywordHits +
    freshnessBonus(params.ageDays)
  );
}
