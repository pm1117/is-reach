// 認証ミドルウェア: Bearer JWT の検証 → テナントコンテキスト解決
// （basic-design 7.1 / design-detail 2.1・2.4）。
// JWT ペイロードは信頼境界外入力として zod で検証する（E17）。
// 失敗はすべて AUTH_UNAUTHENTICATED(401) に正規化する（JWT なし・無効・期限切れ・
// app_metadata 欠落 — テナントコンテキストを解決できない時点で「未認証」扱い）。
import { roleSchema, uuidSchema } from "@is-reach/shared";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { ApiHttpError } from "../errors.js";
import type { AppEnv } from "../types.js";
import type { TokenVerifier } from "../auth/token-verifier.js";

/**
 * 必要クレームのスキーマ。tenant_id / role は Supabase Auth の app_metadata
 * （サーバー側でのみ書き換え可能な領域 — design-detail 5 章）から取り出す。
 * ユーザーが自己申告で書き換えられる user_metadata は参照しない。
 */
const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  app_metadata: z.object({
    tenant_id: uuidSchema,
    role: roleSchema,
  }),
});

const BEARER_PATTERN = /^Bearer +(.+)$/i;

export function authenticate(verifier: TokenVerifier): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.match(BEARER_PATTERN)?.[1];
    if (token === undefined) {
      throw new ApiHttpError("AUTH_UNAUTHENTICATED", "認証情報がありません");
    }

    let payload: Record<string, unknown>;
    try {
      ({ payload } = await verifier.verify(token));
    } catch {
      throw new ApiHttpError("AUTH_UNAUTHENTICATED", "認証情報が無効または期限切れです");
    }

    const claims = jwtClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new ApiHttpError(
        "AUTH_UNAUTHENTICATED",
        "認証情報からテナントコンテキストを解決できません",
      );
    }

    c.set("auth", {
      authUserId: claims.data.sub,
      tenantId: claims.data.app_metadata.tenant_id,
      role: claims.data.app_metadata.role,
    });
    await next();
  };
}
