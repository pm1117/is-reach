// 深掘りジョブ状態の表示定義（ui-spec 4.5 の表に完全準拠 — 決定）。
// キーを shared の z.infer 型（DeepDiveJobState）の Record にすることで全状態の網羅を型保証する。
import type { DeepDiveJobState } from "@is-reach/shared";
import type { EnumLabel } from "./types";

export const DEEP_DIVE_JOB_STATE_LABELS: Record<DeepDiveJobState, EnumLabel> = {
  queued: { label: "待機中", tone: "neutral" },
  collecting: { label: "収集中", tone: "primary" },
  analyzing: { label: "分析中", tone: "primary" },
  done: { label: "完了", tone: "success" },
  failed: { label: "失敗", tone: "danger" },
};
