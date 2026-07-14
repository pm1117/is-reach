// 日時表示の標準フォーマット: `YYYY-MM-DD HH:mm`（JST — ui-spec 1.3。仮置き → PR6a で確定提案）。
// API の日時は ISO 8601（UTC — design-detail 2.1）で受け取り、表示時に JST へ変換する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * ISO 8601（UTC）文字列を `YYYY-MM-DD HH:mm`（JST）へ整形する。
 * パース不能な入力はプレースホルダ「—」を返す（外部由来データの欠損で画面を壊さない）。
 */
export function formatDateTimeJst(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return (
    `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())} ` +
    `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`
  );
}
