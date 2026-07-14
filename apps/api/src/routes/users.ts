// ユーザー・テナント管理のうちユーザー系（design-detail 2.2 — 要件 F6）。
// - GET /users は担当者アサイン UI に必要なため全員可（2.2 本書決定）
// - 招待・ロール変更・無効化は管理者のみ（宣言テーブルが強制）
// - Supabase Auth 側の操作（招待メール・app_metadata・無効化）は AuthAdmin 抽象経由
import {
  inviteUserRequestSchema,
  paginationQuerySchema,
  roleSchema,
  tenantUserSchema,
  updateUserRoleRequestSchema,
  type TenantUser,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import { AuthAdminUnavailableError } from "../auth/auth-admin.js";
import type { AppEnv } from "../types.js";
import {
  parseDbContract,
  parseJsonBody,
  parseQuery,
  parseUuidParam,
  toIso,
} from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

interface UserRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string | null;
  role: string;
  invitation_status: string;
  created_at: Date | string;
}

const USER_SELECT = `
  select id, auth_user_id, email, display_name, role, invitation_status, created_at
    from users`;

function toTenantUser(row: UserRow): TenantUser {
  return parseDbContract(
    tenantUserSchema,
    {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      invitationStatus: row.invitation_status,
      createdAt: toIso(row.created_at),
    },
    "users 行",
  );
}

/** AuthAdmin 未設定は利用者向けには内部エラーとして返す（詳細はログのみ） */
function mapAuthAdminError(error: unknown): never {
  if (error instanceof AuthAdminUnavailableError) {
    throw new ApiHttpError("INTERNAL", "ユーザー管理機能が現在利用できません");
  }
  throw error;
}

export function registerUserRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "GET", "/users", async (c) => {
    const auth = c.get("auth");
    const page = parseQuery(c, paginationQuerySchema);
    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const total = await tx.query<{ n: string }>(`select count(*)::text as n from users`);
      const rows = await tx.query<UserRow>(
        `${USER_SELECT} order by created_at, id limit $1 offset $2`,
        [page.limit, page.offset],
      );
      return {
        items: rows.rows.map(toTenantUser),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    return c.json(result);
  });

  registerRoute(v1, "POST", "/users/invitations", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, inviteUserRequestSchema);

    // 事前チェック（重複メール）はテナントコンテキスト内で行う
    await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      await resolveActor(tx, auth);
      const existing = await tx.query(`select id from users where email = $1`, [body.email]);
      if (existing.rows.length > 0) {
        throw new ApiHttpError("RESOURCE_CONFLICT", "このメールアドレスは既に登録されています");
      }
    });

    // Supabase Auth へ招待（外部 API のためトランザクション外。
    // 以降の INSERT が失敗した場合は Auth 側にユーザーが残るが、再招待時に
    // Auth 側の重複エラーとして表面化する — MVP の許容事項として記録）
    let authUserId: string;
    try {
      const invited = await deps.authAdmin.inviteUserByEmail(body.email, {
        tenant_id: auth.tenantId,
        role: body.role,
      });
      authUserId = invited.authUserId;
    } catch (error) {
      mapAuthAdminError(error);
    }

    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const inserted = await tx.query<UserRow>(
        `insert into users (tenant_id, auth_user_id, email, role, invitation_status)
         values ($1, $2, $3, $4, 'invited')
         returning id, auth_user_id, email, display_name, role, invitation_status, created_at`,
        [auth.tenantId, authUserId, body.email, body.role],
      );
      const user = inserted.rows[0];
      if (user === undefined) throw new Error("users の INSERT が行を返しません");
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "user.invited",
        resourceType: "User",
        resourceId: user.id,
        metadata: { role: body.role },
        requestId,
      });
      return user;
    });
    return c.json(toTenantUser(row), 201);
  });

  registerRoute(v1, "PATCH", "/users/:userId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const userId = parseUuidParam(c, "userId");
    const body = await parseJsonBody(c, updateUserRoleRequestSchema);

    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const current = await tx.query<UserRow>(`${USER_SELECT} where id = $1`, [userId]);
      const before = current.rows[0];
      if (before === undefined) return undefined;

      const updated = await tx.query<UserRow>(
        `update users set role = $2, updated_at = now() where id = $1
         returning id, auth_user_id, email, display_name, role, invitation_status, created_at`,
        [userId, body.role],
      );
      const user = updated.rows[0];
      if (user === undefined) return undefined;
      if (before.role !== body.role) {
        await recordAuditEvent(tx, {
          tenantId: auth.tenantId,
          actorUserId: actor.userId,
          eventType: "user.role_changed",
          resourceType: "User",
          resourceId: userId,
          metadata: { before: before.role, after: body.role },
          requestId,
        });
      }
      return user;
    });
    if (result === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ユーザーが見つかりません");
    }

    // JWT の app_metadata.role を同期（認可の情報源 — middleware/auth.ts）。
    // Auth 側同期の失敗は致命ではないためログに残しレスポンスは成功のまま返さない方針も
    // あるが、権限の食い違いは危険なためエラーとして返す（DB 側は更新済み — 再実行で収束）
    if (result.auth_user_id !== null) {
      try {
        await deps.authAdmin.updateUserAppMetadata(result.auth_user_id, {
          tenant_id: auth.tenantId,
          role: roleSchema.parse(result.role),
        });
      } catch (error) {
        mapAuthAdminError(error);
      }
    }
    return c.json(toTenantUser(result));
  });

  registerRoute(v1, "DELETE", "/users/:userId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const userId = parseUuidParam(c, "userId");

    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      if (actor.userId === userId) {
        // 最後の管理者の自己無効化でテナントが操作不能になる事故を防ぐ（実装判断）
        throw new ApiHttpError("RESOURCE_CONFLICT", "自分自身は無効化できません");
      }
      const updated = await tx.query<UserRow>(
        `update users set invitation_status = 'disabled', updated_at = now()
          where id = $1
          returning id, auth_user_id, email, display_name, role, invitation_status, created_at`,
        [userId],
      );
      const user = updated.rows[0];
      if (user === undefined) return undefined;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "user.removed",
        resourceType: "User",
        resourceId: userId,
        metadata: {},
        requestId,
      });
      return user;
    });
    if (result === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ユーザーが見つかりません");
    }

    // Auth 側のログイン遮断（JWT の失効は有効期限まで待つ — 既存トークンは
    // /me が invitation_status='active' を要求するため実質無効化される）
    if (result.auth_user_id !== null) {
      try {
        await deps.authAdmin.disableUser(result.auth_user_id);
      } catch (error) {
        mapAuthAdminError(error);
      }
    }
    return c.body(null, 204);
  });
}
