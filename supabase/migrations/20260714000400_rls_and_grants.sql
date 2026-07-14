-- 20260714000400_rls_and_grants.sql
-- RLS ポリシーと権限（design-detail 6.1 — 決定 E14 / basic-design 7.2）。
--
-- 方式:
-- - 全テナント資産テーブルに ENABLE + FORCE ROW LEVEL SECURITY
--   （FORCE によりテーブル所有者にもポリシーを強制）。
-- - ポリシー述語は nullif(current_setting('app.tenant_id', true), '')::uuid。
--   E14 の current_setting(...)::uuid に NULLIF を追加している:
--   未設定時（NULL）に加え、トランザクション終了後に空文字が残る Postgres の
--   既知の挙動（一度 set_config した接続の再利用時）でも、キャストエラーではなく
--   決定的に「全行不可（fail-closed）」へ倒すため。isolation の意味は E14 と同一。
-- - apps/api / ワーカーはトランザクション先頭で
--     select set_config('app.tenant_id', <uuid>, true);  -- SET LOCAL 相当
--   を実行し、テナント文脈のクエリを同一トランザクション内で完結させる（E14）。
-- - Supabase の service_role キーは RLS をバイパスするため、テナントデータの
--   クエリには使用禁止（規約 — 6.1）。

-- ---------------------------------------------------------------------------
-- RLS 有効化 + ポリシー（テナント資産 10 テーブル）
-- ---------------------------------------------------------------------------

-- tenants のみテナントキーが id 自体（自テナント行のみ可視）
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenant_isolation on public.tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.users enable row level security;
alter table public.users force row level security;
create policy tenant_isolation on public.users
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.company_lists enable row level security;
alter table public.company_lists force row level security;
create policy tenant_isolation on public.company_lists
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.list_entries enable row level security;
alter table public.list_entries force row level security;
create policy tenant_isolation on public.list_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.deep_dive_jobs enable row level security;
alter table public.deep_dive_jobs force row level security;
create policy tenant_isolation on public.deep_dive_jobs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.collected_documents enable row level security;
alter table public.collected_documents force row level security;
create policy tenant_isolation on public.collected_documents
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.dossiers enable row level security;
alter table public.dossiers force row level security;
create policy tenant_isolation on public.dossiers
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.templates enable row level security;
alter table public.templates force row level security;
create policy tenant_isolation on public.templates
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.messages enable row level security;
alter table public.messages force row level security;
create policy tenant_isolation on public.messages
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
create policy tenant_isolation on public.audit_logs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 権限（basic-design 7.2 / design-detail 6.1）
-- ---------------------------------------------------------------------------

grant usage on schema public to app_user, app_batch;

-- 共有資産: app_user は SELECT のみ。書き込みは app_batch のみ
grant select on public.companies, public.signals to app_user;
grant select, insert, update, delete on public.companies, public.signals to app_batch;

-- tenants: app_user は SELECT / UPDATE のみ（API 契約 design-detail 2.2 は
-- GET/PATCH /tenant のみで、テナントの作成・削除は運用側の操作）。
-- 特に DELETE を付与しない理由: audit_logs は tenants への ON DELETE CASCADE を
-- 持つため、app_user が自テナント行を DELETE できると監査ログの「追記専用」
-- （E14/E16）をテナント起点のカスケード削除で迂回できてしまう（レビュー指摘対応）。
grant select, update on public.tenants to app_user;

-- テナント資産: app_user に CRUD（RLS で自テナントに限定される）
grant select, insert, update, delete on
  public.users,
  public.company_lists,
  public.list_entries,
  public.deep_dive_jobs,
  public.collected_documents,
  public.dossiers,
  public.templates,
  public.messages
to app_user;

-- audit_logs は追記専用: INSERT / SELECT のみ（UPDATE / DELETE 権限を与えない — E14/E16）
grant select, insert on public.audit_logs to app_user;

-- ---------------------------------------------------------------------------
-- anon / authenticated からのアクセス剥奪（design-detail 6.1）
-- MVP では apps/web の Supabase 直接アクセス（PostgREST / supabase-js）を使わない。
-- これらのロールは Supabase 環境にのみ存在するため、存在チェック付きで剥奪する
-- （プレーン Postgres でのマイグレーション適用・テストを壊さない）。
-- ---------------------------------------------------------------------------

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 【将来用の予約 — MVP では無効（design-detail 6.1）】
-- apps/web から Supabase 直接読み取りを開放する場合の auth.jwt() ベースの
-- 併用ポリシー。auth スキーマは Supabase 環境にのみ存在するため、プレーン
-- Postgres でのテストを壊さないよう定義自体をコメントアウトで同梱する。
-- 有効化する場合も「定義のみ・anon / authenticated への権限付与はしない」を
-- 経てから、対象テーブル・権限を個別に検討すること。
--
-- create policy tenant_isolation_jwt on public.company_lists
--   using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
-- （他のテナント資産テーブルにも同形で定義する）
-- ---------------------------------------------------------------------------
