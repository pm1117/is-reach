// @is-reach/analysis: スクリーニング（フィルタ + ルールベーススコア — LLM 不使用・要件 F1）と
// 深掘り収集結果の前処理（kind 分類・重複除去・ソース優先度順の整理 — design-detail 3.3 S5）。
// 依存は @is-reach/shared のみ（basic-design 2.2）。外部サイトアクセス・LLM・DB には触れない
// 純粋ロジックで、データの取得・永続化・prompt との結線は apps/api（PR5b）が行う。
export {
  collectedPageSchema,
  companyRecordSchema,
  signalRecordSchema,
  type CollectedPage,
  type CompanyRecord,
  type SignalRecord,
} from "./inputs.js";
export {
  DAY_MS,
  SCREENING_SCORE_WEIGHTS,
  ageInDays,
  freshnessBonus,
  scoreSignal,
} from "./scoring.js";
export { runScreeningSearch, type ScreeningInput } from "./screening.js";
export {
  PAGE_KIND_PRIORITY,
  classifyPageKind,
  collectedPageKindSchema,
  type CollectedPageKind,
} from "./classify.js";
export { prepareDossierSources, type DossierSource } from "./preprocess.js";
