/**
 * ポーリング間隔の既定値（design-detail 5 章 — 決定 E13）。
 * PR6b で実装する非同期ジョブ UX のポーリング部品は、この値を既定値として使うこと
 * （ui-spec 4.5 の「仮置き 5 秒」は E13 で上書き確定済み — pr-plan 6 章 #2）。
 */
export const POLLING_INTERVAL_MS = {
  /** メッセージ生成ジョブ（生成は短時間のため短め） */
  messageGeneration: 2_000,
  /** 深掘りジョブ: 実行中の詳細画面 */
  deepDiveDetail: 3_000,
  /** 深掘りジョブ: リスト一覧画面 */
  deepDiveList: 10_000,
} as const;
