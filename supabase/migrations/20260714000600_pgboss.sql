-- 20260714000600_pgboss.sql
-- pg-boss 用スキーマ（決定 E1: pg-boss は同一 Supabase Postgres に同居・専用スキーマ pgboss）。
--
-- pg-boss 自体のテーブル（job / schedule / version 等）は、PR5b でワーカー
-- プロセスが起動する際に pg-boss が自己マイグレーションで作成する。
-- ここではスキーマと権限のみを用意する。
--
-- pg-boss の接続ロールは app_batch（design-detail 6.1: pg-boss 管理は app_batch）。
-- ジョブペイロードのテナント文脈処理（深掘り・生成）は、ワーカーが app_user
-- 接続 + set_config('app.tenant_id', ...) の RLS 経路で行う（basic-design 7.2-4）。
-- app_user には pgboss スキーマへの権限を一切与えない。

create schema if not exists pgboss;

grant usage, create on schema pgboss to app_batch;

comment on schema pgboss is
  'pg-boss 専用スキーマ（E1）。テーブルは PR5b のワーカー起動時に pg-boss が自己マイグレーションで作成';
