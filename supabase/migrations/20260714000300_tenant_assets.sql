-- 20260714000300_tenant_assets.sql
-- テナント資産テーブル（basic-design 3.3 — 決定 D3 / design-detail 2.3・6.1・7.2）。
--
-- - 全テーブルが tenant_id（tenants は id 自体）を持ち、RLS の対象
--   （ポリシー定義は 20260714000400_rls_and_grants.sql）。
-- - 物理削除（決定 E4）のため ListEntry 起点の参照は ON DELETE CASCADE:
--     company_lists → list_entries → deep_dive_jobs / collected_documents /
--     dossiers → messages
--   audit_logs のリソース参照は非 FK（ID 値のみ）とし、削除後もログが残る（6.1）。
-- - enum は text + CHECK（理由は 20260714000200 冒頭コメント参照）。
-- - テナント内の親子参照は (tenant_id, <fk>) の複合 FK とし、親側に UNIQUE (tenant_id, id)
--   を張る。これにより「tenant_id = A の行が B テナントの親行を参照する」状態を
--   DB 制約で不成立にする（FK の参照整合性チェックは RLS の対象外のため、単純 FK では
--   RLS の WITH CHECK だけでは越境参照を防げない — レビュー指摘対応。二重防御
--   basic-design 7.2 の DB 層をテナント整合まで強制する）。
--   nullable 参照の ON DELETE SET NULL は列指定形（PostgreSQL 15+。Supabase / 本テスト
--   の Postgres 16 で利用可）を使い、tenant_id が NULL 化されないようにする。

-- テナント
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- status は shared に対応 enum 未定義（申し送り: PR5b で tenantStatusSchema を
  -- packages/shared に追加し、この CHECK と整合させる）
  status     text not null default 'active'
    constraint tenants_status_check check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

comment on table public.tenants is 'テナント（RLS は id = app.tenant_id で自テナント行のみ）';

-- ユーザー（Supabase Auth のユーザーを参照 — 決定 E1）
create table public.users (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  auth_user_id      uuid unique, -- Supabase Auth 側 ID。招待受諾までは NULL
  email             text not null,
  display_name      text,
  role              text not null
    constraint users_role_check check (role in ('admin', 'member')), -- shared: roleSchema
  -- invitation_status は shared に対応 enum 未定義（申し送り: PR5b で
  -- invitationStatusSchema を packages/shared に追加し、この CHECK と整合させる）
  invitation_status text not null default 'invited'
    constraint users_invitation_status_check
    check (invitation_status in ('invited', 'active')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, email),
  unique (tenant_id, id) -- 複合 FK の親キー（テナント整合の強制用）
);

-- 企業リスト（検索条件スナップショット付き — 要件 F1 受け入れ条件 1）
create table public.company_lists (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  name             text not null,
  search_condition jsonb not null, -- ScreeningSearchRequest のスナップショット（design-detail 2.3）
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id), -- 複合 FK の親キー
  foreign key (tenant_id, created_by)
    references public.users (tenant_id, id) on delete set null (created_by)
);

-- リストエントリ（共有資産 Company への参照 + マッチ根拠 — 要件 F1 / F5）
create table public.list_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  company_list_id uuid not null,
  -- company_id は共有資産（tenant_id を持たない）への参照のため単純 FK。
  -- 共有資産 Company の削除（PII 削除の運用スクリプト — E4）でエントリごと消える
  company_id      uuid not null references public.companies (id) on delete cascade,
  match_evidence  jsonb not null default '[]'::jsonb, -- マッチしたシグナルの根拠（要件 F1 受け入れ条件 2）
  status          text not null default 'not_started'
    constraint list_entries_status_check
    check (status in ('not_started', 'generated', 'sent', 'replied')), -- shared: entryStatusSchema
  assignee_id     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_list_id, company_id), -- 同一リスト内の企業重複を禁止
  unique (tenant_id, id),               -- 複合 FK の親キー
  foreign key (tenant_id, company_list_id)
    references public.company_lists (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_id)
    references public.users (tenant_id, id) on delete set null (assignee_id)
);

-- 深掘りジョブ（専用ジョブレコード方式 — 決定 E9 / design-detail 4.1）
create table public.deep_dive_jobs (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  list_entry_id          uuid not null,
  state                  text not null default 'queued'
    constraint deep_dive_jobs_state_check
    check (state in ('queued', 'collecting', 'analyzing', 'done', 'failed')), -- shared: deepDiveJobStateSchema
  progress_fetched_pages integer not null default 0
    constraint deep_dive_jobs_fetched_pages_check check (progress_fetched_pages >= 0),
  progress_planned_pages integer
    constraint deep_dive_jobs_planned_pages_check
    check (progress_planned_pages is null or progress_planned_pages >= 0),
  partial_failures       jsonb not null default '[]'::jsonb, -- { url, reason: FetchErrorKind }[]
  error                  jsonb,                              -- { code, message } | NULL（failed 時のみ）
  attempts               integer not null default 0
    constraint deep_dive_jobs_attempts_check check (attempts >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tenant_id, id), -- 複合 FK の親キー
  foreign key (tenant_id, list_entry_id)
    references public.list_entries (tenant_id, id) on delete cascade
);

comment on table public.deep_dive_jobs is
  '深掘りジョブ（業務状態の正。pg-boss 側は実行制御のみ — design-detail 4.1）';

-- ListEntry から最新ジョブへの参照（design-detail 4.1）。
-- deep_dive_jobs が list_entries を参照する循環のため、後付けの ALTER で定義する。
alter table public.list_entries
  add column latest_deep_dive_job_id uuid,
  add foreign key (tenant_id, latest_deep_dive_job_id)
    references public.deep_dive_jobs (tenant_id, id) on delete set null (latest_deep_dive_job_id);

-- 深掘りで収集した生コンテンツ（ドシエの中間データ — basic-design 3.2 / E4 の削除対象）
create table public.collected_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  list_entry_id uuid not null,
  source_url    text not null, -- 出典 URL（必須 — basic-design 8.2）
  fetched_at    timestamptz not null,
  kind          text not null
    constraint collected_documents_kind_check
    check (kind in ('corporate_site', 'news', 'recruit', 'article')), -- analysis: collectedPageKindSchema
  title         text,
  body          text not null, -- 信頼境界外データ（プロンプト投入時は必ずサニタイズ — E7）
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, list_entry_id)
    references public.list_entries (tenant_id, id) on delete cascade
);

-- ドシエ（要件 F3。JSONB 構造は design-detail 2.3 の Dossier / DossierSection / Evidence）
create table public.dossiers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  list_entry_id    uuid not null unique,
  business_summary jsonb not null,                     -- DossierSection
  inferred_issues  jsonb not null default '[]'::jsonb, -- DossierSection[]
  service_hooks    jsonb not null default '[]'::jsonb, -- DossierSection[]
  sources          jsonb not null default '[]'::jsonb, -- { url, fetchedAt, title }[]
  warnings         jsonb not null default '[]'::jsonb, -- GenerationWarning[]（E8）
  model_id         text not null,                      -- 生成に使ったモデル（E2）
  generated_at     timestamptz not null default now(),
  unique (tenant_id, id), -- 複合 FK の親キー
  foreign key (tenant_id, list_entry_id)
    references public.list_entries (tenant_id, id) on delete cascade
);

-- テンプレート（要件 F4。作成・編集・削除は管理者のみ — E3。認可はアプリ層 2.4）
create table public.templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  name         text not null,
  introduction text not null, -- 自社紹介（骨子）
  cta          text not null, -- CTA（骨子）
  tone         text not null,
  max_length   integer not null
    constraint templates_max_length_check check (max_length > 0),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id), -- 複合 FK の親キー
  foreign key (tenant_id, created_by)
    references public.users (tenant_id, id) on delete set null (created_by)
);

-- メッセージ（要件 F4 / F5。parts / validation の JSONB 構造は design-detail 2.3）
create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  list_entry_id  uuid not null,
  -- テンプレート削除（E3 で管理者に許可）後も生成済みメッセージは残す → SET NULL。
  -- 申し送り: design-detail 2.3 の Message.templateId は string（非 null）のため、
  -- PR5b で shared にスキーマを定義する際は string | null へ追随させる
  template_id    uuid,
  dossier_id     uuid not null,
  parts          jsonb not null, -- { hook, issueMention, introduction, cta }
  assembled_body text not null,
  edited_body    text,
  validation     jsonb not null, -- { ok, warnings: GenerationWarning[] }（E8）
  model_id       text not null,
  generated_at   timestamptz not null default now(),
  edited_at      timestamptz,
  foreign key (tenant_id, list_entry_id)
    references public.list_entries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id)
    references public.templates (tenant_id, id) on delete set null (template_id),
  foreign key (tenant_id, dossier_id)
    references public.dossiers (tenant_id, id) on delete cascade
);

-- 監査ログ（design-detail 7 章 — 決定 E16。追記専用は権限で強制 — 6.1）
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  -- actor / resource は非 FK（ID 値のみ）。ユーザー削除・E4 の物理削除後も
  -- ログ行を変更せず残すため（design-detail 6.1 / 7.2）
  actor_user_id uuid,
  event_type    text not null
    constraint audit_logs_event_type_check check (event_type in (
      'user.login', 'user.invited', 'user.role_changed', 'user.removed',
      'tenant.settings_updated',
      'screening.searched',
      'list.created', 'list.updated', 'list.deleted',
      'entry.status_changed', 'entry.assignee_changed',
      'deep_dive.started', 'deep_dive.retried',
      'dossier.viewed',
      'message.generated', 'message.edited', 'message.copied',
      'template.created', 'template.updated', 'template.deleted',
      'pii.deleted',
      'audit_log.viewed'
    )), -- design-detail 7.1 のイベント網羅リスト
  resource_type text,
  resource_id   uuid,
  metadata      jsonb not null default '{}'::jsonb, -- PII・外部コンテンツ本文は入れない（7.2）
  request_id    text,
  occurred_at   timestamptz not null default now()
);

comment on table public.audit_logs is
  '監査ログ（追記専用 — app_user は INSERT/SELECT のみ。リソース参照は非 FK — E16）';
