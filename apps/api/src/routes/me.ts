// GET /api/v1/me — 自ユーザー・所属テナント・ロールの取得（design-detail 2.2「認証・自身」）。
// 第 1 段の縦貫通ルート: JWT 認証 → 認可 → withTenantContext（RLS）→ レスポンス契約
// までを 1 本通す。他エンドポイントは第 2 段でこのパターンに従って実装する
// （routes/ 配下に screening / lists / entries / deep-dive-jobs / messages /
// templates / users / tenant / audit-logs / deletion-requests を追加予定）。
import { meResponseSchema, type MeResponse } from "@is-reach/shared";
import type { TenantDb } from "../db/tenant-db.js";
import type { AuthContext } from "../types.js";

interface MeRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  tenant_name: string;
}

/**
 * 自ユーザーを解決する。見つからない場合は null（呼び出し側で 404 に正規化）。
 * - JWT は有効でも users 行がない（招待未受諾・無効化済み等）ケースがあるため
 *   invitation_status = 'active' に限定する。
 * - role は DB の users.role を返す（表示上の情報源）。認可判定は JWT の
 *   app_metadata.role（middleware/auth.ts）で行っており、両者の同期は
 *   ロール変更 API（第 2 段）が担う。
 */
export async function getMe(tenantDb: TenantDb, auth: AuthContext): Promise<MeResponse | null> {
  return tenantDb.withTenantContext(auth.tenantId, async (tx) => {
    const result = await tx.query<MeRow>(
      `select u.id, u.email, u.display_name, u.role, t.name as tenant_name
         from users u
         join tenants t on t.id = u.tenant_id
        where u.auth_user_id = $1
          and u.invitation_status = 'active'`,
      [auth.authUserId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    // DB 由来の値も契約スキーマで確定させてから返す（role の CHECK と shared enum の同期ずれ検知）。
    // 不適合はリクエスト不正（400）ではなくサーバー側のデータ不整合なので、
    // ZodError をそのまま漏らさず内部エラー（→ グローバルハンドラで 500 INTERNAL）にする。
    const me = meResponseSchema.safeParse({
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
      },
      tenant: {
        id: auth.tenantId,
        name: row.tenant_name,
      },
    });
    if (!me.success) {
      throw new Error(`users 行が /me の契約に適合しません: ${me.error.message}`);
    }
    return me.data;
  });
}
