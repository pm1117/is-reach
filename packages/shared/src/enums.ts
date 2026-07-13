// enum 群（design-detail 2.3 / 2.5）。zod スキーマとして定義し z.infer で型を導出する（決定 E17）。
import { z } from "zod";

/** ユーザーロール（要件 F6: 管理者 / メンバーの 2 ロール） */
export const roleSchema = z.enum(["admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

/** リストエントリのステータス（要件 F5） */
export const entryStatusSchema = z.enum(["not_started", "generated", "sent", "replied"]);
export type EntryStatus = z.infer<typeof entryStatusSchema>;

/** シグナル種別（決定 A3-1。enum は将来拡張可） */
export const signalKindSchema = z.enum(["job_posting", "tech_blog", "press_release"]);
export type SignalKind = z.infer<typeof signalKindSchema>;

/** 深掘りジョブの状態（basic-design 4.3 の状態機械） */
export const deepDiveJobStateSchema = z.enum([
  "queued",
  "collecting",
  "analyzing",
  "done",
  "failed",
]);
export type DeepDiveJobState = z.infer<typeof deepDiveJobStateSchema>;

/** クローリングの HTTP エラー分類（design-detail 4.2 — 決定 E10） */
export const fetchErrorKindSchema = z.enum([
  "http_4xx",
  "http_5xx",
  "timeout",
  "robots_denied",
  "connection_error",
  "too_large",
  "redirect_error",
]);
export type FetchErrorKind = z.infer<typeof fetchErrorKindSchema>;

/** メッセージ生成ジョブの状態（design-detail 2.3） */
export const messageJobStateSchema = z.enum(["queued", "generating", "done", "failed"]);
export type MessageJobState = z.infer<typeof messageJobStateSchema>;

/** 出力検証 V2〜V6 の警告コード（design-detail 3.5 — 決定 E8） */
export const warningCodeSchema = z.enum([
  "SKELETON_MISSING",
  "LENGTH_EXCEEDED",
  "URL_IN_OUTPUT",
  "DELIMITER_TAG_IN_OUTPUT",
  "INJECTION_PATTERN_REFLECTED",
  "OFF_TOPIC_SUSPECTED",
  "EVIDENCE_URL_UNKNOWN",
]);
export type WarningCode = z.infer<typeof warningCodeSchema>;

/** エラーコード体系（design-detail 2.5 の表の全コード。ジョブの error.code にも同じ体系を使う） */
export const errorCodeSchema = z.enum([
  "AUTH_UNAUTHENTICATED",
  "AUTH_FORBIDDEN",
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RESOURCE_CONFLICT",
  "JOB_ALREADY_RUNNING",
  "RATE_LIMITED",
  "LLM_UNAVAILABLE",
  "LLM_OUTPUT_INVALID",
  "CRAWL_ALL_FAILED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
