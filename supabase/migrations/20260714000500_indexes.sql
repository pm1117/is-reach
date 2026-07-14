-- 20260714000500_indexes.sql
-- インデックス（design-detail 6.2 — 決定 E15）。
--
-- - テナント資産は先頭列を tenant_id とし、RLS 適用後のスキャン効率を確保する。
-- - pg_trgm による本文キーワード検索インデックスは仮置きのため張らない
--   （検索要件の実測後に採否確定 — design-detail 8 章の残仮置き）。
-- - 規模要件（C3: テナント〜10・深掘り〜500 社/日）から FK 支援目的の
--   追加インデックスは張らず、必要になった時点で実測して追加する。

-- companies: スクリーニング属性フィルタ（要件 6.4 の即時応答）
create index companies_industry_idx on public.companies (industry);
create index companies_employee_range_idx on public.companies (employee_range);
create index companies_region_idx on public.companies (region);

-- signals: 種別 + 鮮度での絞り込み、抽出属性のキーワードマッチ
create index signals_kind_company_collected_idx
  on public.signals (kind, company_id, collected_at desc);
create index signals_attributes_gin_idx on public.signals using gin (attributes);

-- company_lists: リスト一覧
create index company_lists_tenant_created_idx
  on public.company_lists (tenant_id, created_at desc);

-- list_entries: 一覧・ステータス / 担当者絞り込み（要件 F5）
create index list_entries_tenant_list_status_idx
  on public.list_entries (tenant_id, company_list_id, status);
create index list_entries_tenant_assignee_idx
  on public.list_entries (tenant_id, assignee_id);

-- deep_dive_jobs: 最新ジョブ取得・実行中ジョブの多重投入チェック（design-detail 4.1）
-- 部分インデックスは E15 の字面「(state) WHERE state IN (...)」から意図的に変更し、
-- 用途（エントリ単位の実行中ジョブ存在チェック）と tenant_id 先頭規則（E15 本文）に
-- 合わせて (tenant_id, list_entry_id) を鍵にしている。
create index deep_dive_jobs_tenant_entry_created_idx
  on public.deep_dive_jobs (tenant_id, list_entry_id, created_at desc);
create index deep_dive_jobs_active_idx
  on public.deep_dive_jobs (tenant_id, list_entry_id)
  where state in ('queued', 'collecting', 'analyzing');

-- collected_documents: エントリ配下の収集データ参照（E15 の表外だが、ドシエ生成・
-- E4 削除確認でエントリ単位アクセスが基本パターンのため tenant_id 先頭で追加）
create index collected_documents_tenant_entry_idx
  on public.collected_documents (tenant_id, list_entry_id);

-- dossiers: エントリ → ドシエ参照（UNIQUE — E15。list_entry_id 単独の UNIQUE 制約は
-- テーブル定義側にあり、こちらは RLS 適用後のスキャン効率のための tenant_id 先頭複合）
create unique index dossiers_tenant_entry_key
  on public.dossiers (tenant_id, list_entry_id);

-- messages: エントリのメッセージ一覧
create index messages_tenant_entry_generated_idx
  on public.messages (tenant_id, list_entry_id, generated_at desc);

-- audit_logs: 監査ログ閲覧・種別絞り込み
create index audit_logs_tenant_occurred_idx
  on public.audit_logs (tenant_id, occurred_at desc);
create index audit_logs_tenant_event_occurred_idx
  on public.audit_logs (tenant_id, event_type, occurred_at desc);
