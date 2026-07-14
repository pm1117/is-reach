-- 20260714000700_pr5b_api.sql
-- PR5b（apps/api パイプライン結線）で判明した PR5a スキーマの不足分の補完。
-- 本来 PR5a（DB 基盤）スコープの DDL だが、API・ワーカーの結線に必須のため
-- PR5b に同梱する（orchestrator へ報告済みの逸脱。方式は既存マイグレーションに合わせる）。

-- ---------------------------------------------------------------------------
-- 1) tenants.service_summary — テナントの自社サービス概要
--    design-detail 3.4 (A)(B) の信頼済みパラメータ「テナントの自社サービス概要
--    （Tenant 設定由来）」の置き場。PR5a の tenants に列がなかった。
--    PATCH /tenant（管理者のみ — 2.4）で設定する。
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column service_summary text not null default '';

comment on column public.tenants.service_summary is
  '自社サービス概要（ドシエ分析・メッセージ生成の信頼済みパラメータ — design-detail 3.4）';

-- ---------------------------------------------------------------------------
-- 2) users.invitation_status に 'disabled' を追加
--    DELETE /users/:userId は「削除（無効化）」（design-detail 2.2）。行を物理削除すると
--    担当者履歴の表示（assignee 参照は SET NULL）が失われるため、無効化ステータスで
--    表現する。認証側の無効化は AuthAdmin（Supabase Auth Admin API）が行う。
--    shared: invitationStatusSchema（PR5b で追加）と整合。
-- ---------------------------------------------------------------------------
alter table public.users drop constraint users_invitation_status_check;
alter table public.users add constraint users_invitation_status_check
  check (invitation_status in ('invited', 'active', 'disabled'));

-- ---------------------------------------------------------------------------
-- 3) messages に複合 FK の親キー（message_jobs.message_id のテナント整合強制用。
--    他テーブルの unique (tenant_id, id) と同じパターン — 20260714000300 冒頭コメント）
-- ---------------------------------------------------------------------------
alter table public.messages
  add constraint messages_tenant_id_key unique (tenant_id, id);

-- ---------------------------------------------------------------------------
-- 4) message_jobs — メッセージ生成ジョブの専用レコード（決定 E13）
--    GET /message-jobs/:jobId（ポーリング — design-detail 2.2）の状態の正。
--    deep_dive_jobs と同方式（pg-boss 側は実行制御のみ、業務状態は自前レコード — 4.1）。
--    PR5a にテーブルがなかったため追加する。
-- ---------------------------------------------------------------------------
create table public.message_jobs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  list_entry_id uuid not null,
  template_id   uuid,
  -- 起動ユーザー。message.generated 監査ログの actor 引き継ぎに使う
  -- （システム起因イベントは起動ユーザーを引き継ぐ — design-detail 7.2）
  created_by    uuid,
  state         text not null default 'queued'
    constraint message_jobs_state_check
    check (state in ('queued', 'generating', 'done', 'failed')), -- shared: messageJobStateSchema
  message_id    uuid,  -- done 時に設定（design-detail 2.3 MessageJob）
  error         jsonb, -- { code, message } | NULL（failed 時のみ）
  attempts      integer not null default 0
    constraint message_jobs_attempts_check check (attempts >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id), -- 複合 FK の親キー
  foreign key (tenant_id, list_entry_id)
    references public.list_entries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id)
    references public.templates (tenant_id, id) on delete set null (template_id),
  foreign key (tenant_id, created_by)
    references public.users (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, message_id)
    references public.messages (tenant_id, id) on delete set null (message_id)
);

comment on table public.message_jobs is
  'メッセージ生成ジョブ（業務状態の正。pg-boss 側は実行制御のみ — E13 / 4.1 と同方式）';

-- RLS（20260714000400 と同一方式: fail-closed / FORCE）
alter table public.message_jobs enable row level security;
alter table public.message_jobs force row level security;
create policy tenant_isolation on public.message_jobs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- 権限（テナント資産の標準権限 — 20260714000400 と同じ）
grant select, insert, update, delete on public.message_jobs to app_user;

-- インデックス（E15: tenant_id 先頭。deep_dive_jobs と同パターン）
create index message_jobs_tenant_entry_created_idx
  on public.message_jobs (tenant_id, list_entry_id, created_at desc);
create index message_jobs_active_idx
  on public.message_jobs (tenant_id, list_entry_id)
  where state in ('queued', 'generating');
