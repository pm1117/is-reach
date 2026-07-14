// リストエントリのステータス表示定義（要件 F5 / ui-spec 2.3）。
// トーンは ui-spec 3.3 に沿い「返信あり」= success、他は neutral（仮置き提案 — 承認時に調整可）。
import type { EntryStatus } from "@is-reach/shared";
import type { EnumLabel } from "./types";

export const ENTRY_STATUS_LABELS: Record<EntryStatus, EnumLabel> = {
  not_started: { label: "未着手", tone: "neutral" },
  generated: { label: "生成済み", tone: "neutral" },
  sent: { label: "送信済み", tone: "neutral" },
  replied: { label: "返信あり", tone: "success" },
};
