// ログインイベントの取得（design-detail 5 章の仮置き第一候補 = Supabase Auth Hooks）。
//
// 【仮置き — 人間確認対象】方式そのもの（Auth Hooks を使うか・payload 形式・配置）は
// design-detail 5 章で「実装フェーズに feature-dev 提案 → 人間確認」とされている。
// ここでは最小実装として、共有シークレットヘッダで保護した内部 webhook を置く:
// - パス: POST /internal/hooks/login（/api/v1 の認可マトリクス外 — JWT 認証ではなく
//   共有シークレットで保護する内部ルート）
// - AUTH_HOOK_SECRET 未設定なら登録されない（= 404。機能ごと無効）
// - payload は Supabase Auth Hooks の user オブジェクトから必要最小限
//   （id と app_metadata.tenant_id）を zod で検証して使う
import { timingSafeEqual } from "node:crypto";
import { uuidSchema } from "@is-reach/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import type { AppEnv } from "../types.js";
import { parseJsonBody } from "../validation.js";
import type { RouteDeps } from "./deps.js";

export const AUTH_HOOK_HEADER = "x-auth-hook-secret";
export const AUTH_HOOK_PATH = "/internal/hooks/login";

const loginHookSchema = z.object({
  user: z.object({
    id: uuidSchema,
    app_metadata: z.object({
      tenant_id: uuidSchema,
    }),
  }),
});

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/** app（/api/v1 の外）に登録する。secret が null なら何も登録しない（機能無効） */
export function registerAuthHookRoutes(
  app: Hono<AppEnv>,
  deps: RouteDeps,
  secret: string | null,
): void {
  if (secret === null) return;

  app.post(AUTH_HOOK_PATH, async (c) => {
    if (!secretMatches(c.req.header(AUTH_HOOK_HEADER), secret)) {
      throw new ApiHttpError("AUTH_UNAUTHENTICATED", "認証情報が無効です");
    }
    const body = await parseJsonBody(c, loginHookSchema);
    const tenantId = body.user.app_metadata.tenant_id;
    const requestId = c.get("requestId");

    await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
      // users 行が未作成（招待受諾直後の競合等）でも actor null でイベントは残す
      const users = await tx.query<{ id: string }>(`select id from users where auth_user_id = $1`, [
        body.user.id,
      ]);
      await recordAuditEvent(tx, {
        tenantId,
        actorUserId: users.rows[0]?.id ?? null,
        eventType: "user.login",
        resourceType: "User",
        resourceId: users.rows[0]?.id ?? null,
        metadata: {},
        requestId,
      });
    });
    return c.body(null, 204);
  });
}
