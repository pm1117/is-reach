/** className 結合ユーティリティ（false/null/undefined/空文字を除外して結合する） */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}
