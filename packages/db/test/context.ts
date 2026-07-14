// globalSetup → テスト間で受け渡す接続情報の型と、vitest の provide/inject の型付け。
// vitest への依存を持たない純粋な型・定数モジュール（global-setup / helpers 双方から import する）。

/** テストで使う DB ロールの資格情報（テスト専用のローカル Docker コンテナ内でのみ有効） */
export interface DbRoleCredential {
  readonly user: string;
  readonly password: string;
}

/** globalSetup が provide し、各テストが inject で受け取る接続コンテキスト */
export interface DbTestContext {
  readonly host: string;
  readonly port: number;
  /** マイグレーション適用済みのテスト DB 名 */
  readonly database: string;
  /** postgres スーパーユーザー（コンテナ管理・DB 作成のみに使用。RLS 検証には使わない） */
  readonly superuser: DbRoleCredential;
  /** マイグレーション適用ロール = 全テーブルの所有者（FORCE RLS の検証に使用） */
  readonly migrator: DbRoleCredential;
  /** apps/api / ワーカー相当のロール（RLS 対象 — E14） */
  readonly appUser: DbRoleCredential;
  /** 共有資産書き込み・マイグレーション用途のロール（E14） */
  readonly appBatch: DbRoleCredential;
}

declare module "vitest" {
  interface ProvidedContext {
    dbtest: DbTestContext;
  }
}

/** RLS 対象のテナント資産テーブル（design-detail 6.1 — 全 10 テーブル） */
export const TENANT_TABLES = [
  "tenants",
  "users",
  "company_lists",
  "list_entries",
  "deep_dive_jobs",
  "collected_documents",
  "dossiers",
  "templates",
  "messages",
  "audit_logs",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/** 共有資産テーブル（RLS 対象外 — basic-design 3.2） */
export const SHARED_TABLES = ["companies", "signals"] as const;

export type SharedTable = (typeof SHARED_TABLES)[number];
