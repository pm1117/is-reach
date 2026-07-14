// JWT 検証器（basic-design 7.1 / design-detail 2.1）。
// Supabase Auth のレガシー JWT シークレット（HS256）による検証を基本実装とし、
// インターフェースで注入可能にする。将来 Supabase の非対称署名鍵（JWKS / RS256・ES256）へ
// 移行する場合は、この TokenVerifier の実装を追加して差し替える。
import { jwtVerify } from "jose";

/**
 * 署名・有効期限の検証を通過した JWT のペイロード。
 * クレーム内容は信頼境界外の構造（形は保証されない）のため unknown のまま返し、
 * 呼び出し側（authenticate ミドルウェア）が zod でスキーマ検証してから使う。
 */
export interface VerifiedToken {
  payload: Record<string, unknown>;
}

export interface TokenVerifier {
  /** 署名と有効期限を検証する。失敗は TokenVerificationError を throw */
  verify(token: string): Promise<VerifiedToken>;
}

export class TokenVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenVerificationError";
  }
}

/** HS256（共有シークレット）検証器。exp / nbf は jose が検証する */
export function createHs256TokenVerifier(secret: string): TokenVerifier {
  const key = new TextEncoder().encode(secret);
  return {
    async verify(token: string): Promise<VerifiedToken> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
        return { payload };
      } catch (error) {
        // 失敗理由（署名不正 / 期限切れ等）はレスポンスに出さない。cause に保持しログ側で使う
        throw new TokenVerificationError("JWT の検証に失敗しました", { cause: error });
      }
    },
  };
}
