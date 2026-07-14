// 認可マトリクスの宣言テーブル（design-detail 2.2 / 2.4 — 決定 E3 反映）。
// 全エンドポイントの必要ロールをこの 1 箇所で宣言する。権限を後から絞る場合も
// この表の 1 行の変更で済む（例: リスト削除を管理者のみへ）。
//
// - ルート登録は必ず registerRoute（middleware/authorize.ts）経由で行い、
//   この表にないルートは登録時に例外 = fail-closed。
// - DELETE /lists/:listId は design-detail 2.2 のとおり「全員」
//   （ui-spec の仮置き「作成者 + 管理者」との不整合は design-detail 優先で確定済み
//   — pr-plan 6 章 #1 / orchestrator 確定）。
// - パス実装は第 2 段。本段で実装するのは GET /me のみだが、表は 2.2 の全エンドポイント
//   を宣言して認可マトリクスを確定させる。
import type { Role } from "@is-reach/shared";

export type RouteMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RoutePolicy {
  method: RouteMethod;
  /** ベースパス /api/v1 を除いた Hono ルートパス（例: "/lists/:listId"） */
  path: string;
  /** 許可ロール（design-detail 2.4 の認可マトリクス） */
  roles: readonly Role[];
}

const ALL_ROLES: readonly Role[] = ["admin", "member"];
const ADMIN_ONLY: readonly Role[] = ["admin"];

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  // 認証・自身
  { method: "GET", path: "/me", roles: ALL_ROLES },

  // スクリーニング（要件 F1）
  { method: "POST", path: "/screening/searches", roles: ALL_ROLES },
  { method: "GET", path: "/screening/facets", roles: ALL_ROLES },

  // 企業リスト（要件 F1 / F5）
  { method: "GET", path: "/lists", roles: ALL_ROLES },
  { method: "POST", path: "/lists", roles: ALL_ROLES },
  { method: "GET", path: "/lists/:listId", roles: ALL_ROLES },
  { method: "PATCH", path: "/lists/:listId", roles: ALL_ROLES },
  { method: "DELETE", path: "/lists/:listId", roles: ALL_ROLES },
  { method: "GET", path: "/lists/:listId/entries", roles: ALL_ROLES },
  { method: "PATCH", path: "/entries/:entryId", roles: ALL_ROLES },

  // 深掘り（要件 F2）
  { method: "POST", path: "/deep-dive-jobs", roles: ALL_ROLES },
  { method: "GET", path: "/deep-dive-jobs/:jobId", roles: ALL_ROLES },
  { method: "POST", path: "/deep-dive-jobs/:jobId/retry", roles: ALL_ROLES },

  // ドシエ（要件 F3）
  { method: "GET", path: "/entries/:entryId/dossier", roles: ALL_ROLES },

  // メッセージ（要件 F4 / F5。E3: Message の個別編集はメンバーも可）
  { method: "POST", path: "/entries/:entryId/messages", roles: ALL_ROLES },
  { method: "GET", path: "/message-jobs/:jobId", roles: ALL_ROLES },
  { method: "GET", path: "/entries/:entryId/messages", roles: ALL_ROLES },
  { method: "GET", path: "/messages/:messageId", roles: ALL_ROLES },
  { method: "PATCH", path: "/messages/:messageId", roles: ALL_ROLES },
  { method: "POST", path: "/messages/:messageId/copy-events", roles: ALL_ROLES },

  // テンプレート（要件 F4 / 決定 E3: 変更系は管理者のみ・メンバーは閲覧と利用のみ）
  { method: "GET", path: "/templates", roles: ALL_ROLES },
  { method: "GET", path: "/templates/:templateId", roles: ALL_ROLES },
  { method: "POST", path: "/templates", roles: ADMIN_ONLY },
  { method: "PATCH", path: "/templates/:templateId", roles: ADMIN_ONLY },
  { method: "DELETE", path: "/templates/:templateId", roles: ADMIN_ONLY },

  // ユーザー・テナント管理（要件 F6。GET /users は担当者アサイン UI のため全員可 — 2.2）
  { method: "GET", path: "/users", roles: ALL_ROLES },
  { method: "POST", path: "/users/invitations", roles: ADMIN_ONLY },
  { method: "PATCH", path: "/users/:userId", roles: ADMIN_ONLY },
  { method: "DELETE", path: "/users/:userId", roles: ADMIN_ONLY },
  { method: "GET", path: "/tenant", roles: ADMIN_ONLY },
  { method: "PATCH", path: "/tenant", roles: ADMIN_ONLY },
  { method: "GET", path: "/audit-logs", roles: ADMIN_ONLY },

  // PII 削除（要件 6.3 / 決定 E4）
  { method: "POST", path: "/deletion-requests", roles: ADMIN_ONLY },
];

export function findRoutePolicy(method: RouteMethod, path: string): RoutePolicy | undefined {
  return ROUTE_POLICIES.find((policy) => policy.method === method && policy.path === path);
}

/** ルート登録時の必須参照。宣言のないルートは起動時例外（fail-closed） */
export function requireRoutePolicy(method: RouteMethod, path: string): RoutePolicy {
  const policy = findRoutePolicy(method, path);
  if (policy === undefined) {
    throw new Error(
      `認可マトリクス未宣言のルート: ${method} ${path}` +
        "（auth/route-policies.ts の ROUTE_POLICIES に必要ロールを宣言してください — fail-closed）",
    );
  }
  return policy;
}
