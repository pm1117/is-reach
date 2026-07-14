// Supabase Auth の管理操作（ユーザー招待・app_metadata 更新・無効化）の抽象。
// design-detail 5 章: 招待は Supabase Auth の招待メール機能を利用（E1）。
// JWT の app_metadata（tenant_id / role）はここでのみ書き込む。
//
// service_role キーは Auth Admin API（/auth/v1/admin/*）にのみ使用する。
// DB（PostgREST）クエリへの使用は禁止（design-detail 6.1 — RLS バイパス防止）。
// 実装はこの抽象に閉じ、ルート・テストはモックを注入する。
import { roleSchema, uuidSchema, type Role } from "@is-reach/shared";
import { z } from "zod";

export interface InviteResult {
  /** Supabase Auth 側のユーザー ID（users.auth_user_id に対応） */
  authUserId: string;
}

export interface AuthAdmin {
  /** 招待メールを送信し、Auth ユーザーを作成する（app_metadata に tenant_id / role を格納） */
  inviteUserByEmail(
    email: string,
    appMetadata: { tenant_id: string; role: Role },
  ): Promise<InviteResult>;
  /** app_metadata を更新する（ロール変更時の JWT 側同期） */
  updateUserAppMetadata(
    authUserId: string,
    appMetadata: { tenant_id: string; role: Role },
  ): Promise<void>;
  /** 認証を無効化する（無効化ユーザーのログイン遮断。DELETE /users/:userId — 2.2） */
  disableUser(authUserId: string): Promise<void>;
}

/** AuthAdmin が未設定（SUPABASE_URL / SERVICE_ROLE_KEY なし）の場合に投げる */
export class AuthAdminUnavailableError extends Error {
  constructor() {
    super("認証管理機能が未設定です（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）");
    this.name = "AuthAdminUnavailableError";
  }
}

/** 未設定環境用: 利用時に AuthAdminUnavailableError で失敗する */
export function createUnconfiguredAuthAdmin(): AuthAdmin {
  return {
    inviteUserByEmail: () => Promise.reject(new AuthAdminUnavailableError()),
    updateUserAppMetadata: () => Promise.reject(new AuthAdminUnavailableError()),
    disableUser: () => Promise.reject(new AuthAdminUnavailableError()),
  };
}

const inviteResponseSchema = z.object({
  // GoTrue の invite レスポンス: { id: <auth user id>, ... }
  id: uuidSchema,
});

export interface SupabaseAuthAdminOptions {
  url: string;
  serviceRoleKey: string;
  /** テスト注入用 */
  fetchImpl?: typeof fetch;
}

/**
 * Supabase Auth Admin API（GoTrue Admin）実装。
 * - POST /auth/v1/invite（招待メール）
 * - PUT /auth/v1/admin/users/:id（app_metadata 更新・ban）
 */
export function createSupabaseAuthAdmin(options: SupabaseAuthAdminOptions): AuthAdmin {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.url.replace(/\/+$/, "");
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function call(path: string, method: string, body: unknown): Promise<unknown> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // レスポンス本文は外部サービス由来のためログにも全文は残さない（ステータスのみ）
      throw new Error(`Supabase Auth Admin API が失敗しました（HTTP ${response.status}）`);
    }
    return response.json();
  }

  return {
    async inviteUserByEmail(email, appMetadata) {
      // app_metadata の role は enum を再検証してから送る（型迂回の遮断）
      const role = roleSchema.parse(appMetadata.role);
      const tenantId = uuidSchema.parse(appMetadata.tenant_id);
      const raw = await call("/auth/v1/invite", "POST", {
        email,
        data: {},
        app_metadata: { tenant_id: tenantId, role },
      });
      const parsed = inviteResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Supabase Auth Admin API の招待レスポンスを解釈できません");
      }
      return { authUserId: parsed.data.id };
    },

    async updateUserAppMetadata(authUserId, appMetadata) {
      const role = roleSchema.parse(appMetadata.role);
      const tenantId = uuidSchema.parse(appMetadata.tenant_id);
      await call(`/auth/v1/admin/users/${uuidSchema.parse(authUserId)}`, "PUT", {
        app_metadata: { tenant_id: tenantId, role },
      });
    },

    async disableUser(authUserId) {
      // ban_duration を長期に設定してログインを遮断する（GoTrue の無効化相当）
      await call(`/auth/v1/admin/users/${uuidSchema.parse(authUserId)}`, "PUT", {
        ban_duration: "87600h", // 10 年
      });
    },
  };
}
