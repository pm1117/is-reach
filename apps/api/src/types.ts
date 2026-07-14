// Hono アプリ共通の環境型（コンテキスト変数）。
import type { Role } from "@is-reach/shared";

/**
 * 認証済みリクエストのテナントコンテキスト（basic-design 7.1 / design-detail 2.1）。
 * JWT の app_metadata（Supabase Auth 側でサーバー管理される領域）から解決する。
 * ユーザーが書き換え可能な user_metadata は使わない。
 */
export interface AuthContext {
  /** Supabase Auth のユーザー ID（JWT `sub`。users.auth_user_id に対応） */
  authUserId: string;
  /** 所属テナント ID（JWT `app_metadata.tenant_id`） */
  tenantId: string;
  /** ロール（JWT `app_metadata.role` — 認可ミドルウェアの判定に使う） */
  role: Role;
}

export type AppEnv = {
  Variables: {
    /** リクエスト ID（request-id ミドルウェアが必ず設定。ApiError.requestId と相関 — 2.5） */
    requestId: string;
    /** 認証コンテキスト（authenticate ミドルウェア通過後のみ設定される） */
    auth: AuthContext;
  };
};

/** 最小のロガー抽象（構造化ログ基盤の導入は第 2 段以降。テストでは記録用モックを注入する） */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info(message, meta) {
    console.log(message, meta ?? "");
  },
  error(message, meta) {
    console.error(message, meta ?? "");
  },
};
