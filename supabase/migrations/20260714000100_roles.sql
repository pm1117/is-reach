-- 20260714000100_roles.sql
-- DB ロールの定義（design-detail 6.1 — 決定 E14）。
--
-- - app_user : apps/api / ジョブワーカーがテナントデータへアクセスする唯一のロール。
--              非スーパーユーザー・BYPASSRLS なし。RLS（fail-closed）の対象。
-- - app_batch: マイグレーション・pg-boss 管理・共有資産（companies / signals）の
--              収集バッチ書き込み用ロール。テナント資産の業務クエリには使わない。
--
-- Supabase の service_role キーは RLS をバイパスするため、テナントデータの
-- クエリには使用禁止（design-detail 6.1 の規約。CLAUDE.md にも明記）。
--
-- ロールはクラスタ共有オブジェクトのため、再実行安全（idempotent）に作成する。
-- LOGIN 属性とパスワードはマイグレーションに含めず、環境構築時に運用側で
-- `ALTER ROLE ... LOGIN PASSWORD ...` を実行して付与する（秘密情報を SQL に残さない）。

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'app_batch') then
    create role app_batch nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

comment on role app_user is
  'apps/api・ワーカーのテナントデータアクセス用（RLS 対象・BYPASSRLS なし — E14）';
comment on role app_batch is
  'マイグレーション・pg-boss 管理・共有資産の収集バッチ書き込み用（E14）';
