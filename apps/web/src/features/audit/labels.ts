// S9 監査イベント種別の日本語ラベル（feature 内限定 — 他画面で必要になったら lib/labels/ へ昇格）。
// キーを shared の AuditEventType の Record にすることで全イベントの網羅を型保証する。
import type { AuditEventType } from "@is-reach/shared";

export const AUDIT_EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  "user.login": "ログイン",
  "user.invited": "ユーザー招待",
  "user.role_changed": "ロール変更",
  "user.removed": "ユーザー無効化",
  "tenant.settings_updated": "テナント設定更新",
  "screening.searched": "スクリーニング検索",
  "list.created": "リスト作成",
  "list.updated": "リスト更新",
  "list.deleted": "リスト削除",
  "entry.status_changed": "エントリステータス変更",
  "entry.assignee_changed": "担当者変更",
  "deep_dive.started": "深掘り実行",
  "deep_dive.retried": "深掘り再実行",
  "dossier.viewed": "ドシエ閲覧",
  "message.generated": "メッセージ生成",
  "message.edited": "メッセージ編集",
  "message.copied": "メッセージコピー",
  "template.created": "テンプレート作成",
  "template.updated": "テンプレート更新",
  "template.deleted": "テンプレート削除",
  "pii.deleted": "データ削除（PII）",
  "audit_log.viewed": "監査ログ閲覧",
};
