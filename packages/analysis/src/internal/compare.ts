// 決定的な全順序のための文字列比較。
// localeCompare は実行環境の ICU / 既定ロケールに順序が依存し「環境非依存の決定性」を
// 崩すため使わない（UTF-16 コードユニット順の厳密比較で固定する）。
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
