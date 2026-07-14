-- 20260714000200_shared_assets.sql
-- 共有資産テーブル（basic-design 3.2 — 決定 D2）。
--
-- companies / signals は全テナント共有のため tenant_id を持たず、RLS の対象外。
-- アクセス制御は権限のみで行う（app_user = SELECT のみ / 書き込みは app_batch のみ
-- — basic-design 7.2-3。権限付与は 20260714000400_rls_and_grants.sql）。
--
-- enum 値は packages/shared/src/enums.ts の zod enum を唯一の正とし、DDL 側は
-- text + CHECK 制約で整合させる（Postgres enum 型は値の削除・並べ替えができず、
-- shared 側の将来拡張（SignalKind は拡張可 — 決定 A3-1）への追随が
-- 「CHECK 制約の張り替え 1 文」で済む CHECK 方式を採用）。

-- 企業マスタ（スクリーニングの検索対象 — 要件 F1）
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  corporate_number text unique, -- 法人番号（あれば。UNIQUE は NULL を複数許容）
  domain           text,        -- 企業ドメイン / URL
  industry         text,        -- 業種
  employee_range   text,        -- 従業員規模の区分コード
  region           text,        -- 地域
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.companies is
  '企業マスタ（共有資産・RLS 対象外。書き込みは app_batch のみ — basic-design 3.2）';

-- 公開シグナル（求人 / 技術ブログ / プレスリリース — 決定 A3-1）
create table public.signals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  kind         text not null
    constraint signals_kind_check
    check (kind in ('job_posting', 'tech_blog', 'press_release')), -- shared: signalKindSchema
  summary      text not null,
  attributes   jsonb not null default '{}'::jsonb, -- 抽出属性（例: 求人の技術キーワード）
  source_url   text not null,                      -- 出典 URL（必須 — basic-design 3.4 / 8.2）
  collected_at timestamptz not null,               -- 収集日時（必須）
  expires_at   timestamptz,                        -- 有効期限 / 鮮度情報（NULL = 期限なし）
  created_at   timestamptz not null default now()
);

comment on table public.signals is
  '公開シグナル（共有資産・RLS 対象外。本文は信頼境界外データ — basic-design 6 章）';
comment on column public.signals.source_url is
  '出典 URL（必須）。PII 管理の要件（basic-design 8.2）により出典なしデータを持たない';
