// シグナル種別の表示定義（決定 A3-1 / ui-spec 2.3 — マッチ根拠のバッジ表示）。
// 種別は状態でないためトーンは一律 neutral（仮置き — 画面側で強調が必要になれば調整）。
import type { SignalKind } from "@is-reach/shared";
import type { EnumLabel } from "./types";

export const SIGNAL_KIND_LABELS: Record<SignalKind, EnumLabel> = {
  job_posting: { label: "求人", tone: "neutral" },
  tech_blog: { label: "技術ブログ", tone: "neutral" },
  press_release: { label: "プレスリリース", tone: "neutral" },
};
