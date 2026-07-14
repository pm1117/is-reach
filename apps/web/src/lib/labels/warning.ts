// 出力検証 WarningCode → 日本語要約（design-detail 3.5 — 決定 E8）。
// dossier / messages の両 feature で使うため lib に置く（feature 間 import 禁止 — ui-spec U3）。
import type { WarningCode } from "@is-reach/shared";

export const WARNING_CODE_LABELS: Record<WarningCode, string> = {
  SKELETON_MISSING: "テンプレート骨子の欠落",
  LENGTH_EXCEEDED: "文字数制約の超過",
  URL_IN_OUTPUT: "本文への URL の混入",
  DELIMITER_TAG_IN_OUTPUT: "区切りタグの混入",
  INJECTION_PATTERN_REFLECTED: "指示文らしきパターンの反映",
  OFF_TOPIC_SUSPECTED: "主題から外れた内容の疑い",
  EVIDENCE_URL_UNKNOWN: "出典不明の根拠 URL",
};

/** 警告配列の要約文（バナー表示用）。code のみを使い、外部由来の detail は使わない */
export function summarizeWarningCodes(codes: ReadonlyArray<WarningCode>): string {
  return [...new Set(codes)].map((code) => WARNING_CODE_LABELS[code]).join("、");
}
