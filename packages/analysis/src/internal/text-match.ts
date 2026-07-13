// キーワード照合の正規化（screening / classify で共用する内部ユーティリティ）。
//
// 【照合規則 — 決定】
// - 大文字小文字を区別しない（toLowerCase）
// - NFKC 正規化により全角英数字・半角カナ等の表記ゆれを吸収する
//   （日本語と英語が混在する前提。例: "Ｒｅａｃｔ" と "react" が一致する）
// - 部分一致（includes）で照合する

/** 照合用の正規化（NFKC + 小文字化）。表示用テキストには使わない */
export function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/** haystack 群のいずれかに needle が部分一致するか（両辺とも正規化済みであること） */
export function anyIncludes(
  normalizedHaystacks: readonly string[],
  normalizedNeedle: string,
): boolean {
  return normalizedHaystacks.some((haystack) => haystack.includes(normalizedNeedle));
}
