// 操作エラーのトースト文言（ui-spec 4.3: サーバー由来の生メッセージは出さず、
// ユーザー向け文言 + 参照 ID を表示する）。
// feature 間 import 禁止のため features/lists にも同型のヘルパーがある（共通化候補 — 申し送り）。
import { ApiClientError } from "@/lib/api/client";

export function describeActionError(baseMessage: string, error: unknown): string {
  if (error instanceof ApiClientError && error.requestId !== null) {
    return `${baseMessage}（参照 ID: ${error.requestId}）`;
  }
  return baseMessage;
}
