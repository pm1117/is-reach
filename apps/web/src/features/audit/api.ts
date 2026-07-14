// S9 監査ログ閲覧の API 呼び出し（design-detail 2.2 GET /audit-logs — 管理者のみ・閲覧専用）。
import {
  auditLogEntrySchema,
  paginatedResponseSchema,
  tenantUserSchema,
  type AuditEventType,
  type AuditLogEntry,
  type Paginated,
  type TenantUser,
} from "@is-reach/shared";
import type { ApiClient } from "@/lib/api/client";
import { PAGE_SIZE } from "@/lib/config/pagination";

/** フィルタ選択肢用のユーザー一覧の取得上限（仮置き） */
export const USERS_FETCH_LIMIT = 200;

const auditLogsResponseSchema = paginatedResponseSchema(auditLogEntrySchema);
const usersResponseSchema = paginatedResponseSchema(tenantUserSchema);

/** 画面のフィルタ状態（空文字 = 未指定）。日付は JST の暦日（YYYY-MM-DD） */
export interface AuditLogsFilterState {
  eventType: AuditEventType | "";
  actorUserId: string;
  fromDate: string;
  toDate: string;
}

export const EMPTY_FILTER: AuditLogsFilterState = {
  eventType: "",
  actorUserId: "",
  fromDate: "",
  toDate: "",
};

export function hasActiveFilter(filter: AuditLogsFilterState): boolean {
  return (
    filter.eventType !== "" ||
    filter.actorUserId !== "" ||
    filter.fromDate !== "" ||
    filter.toDate !== ""
  );
}

/**
 * JST の暦日（YYYY-MM-DD）を ISO 8601（UTC）の日境界へ変換する。
 * 表示が JST（lib/format/date）のため、フィルタも JST の日単位で解釈する。
 */
function jstDayToIso(date: string, boundary: "start" | "end"): string | null {
  if (date === "") return null;
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  const parsed = new Date(`${date}T${time}+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** クエリ文字列の組み立て（テスト対象 — フィルタがクエリへ正しく反映されること） */
export function buildAuditLogsPath(filter: AuditLogsFilterState, page: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String((page - 1) * PAGE_SIZE));
  if (filter.eventType !== "") params.set("eventType", filter.eventType);
  if (filter.actorUserId !== "") params.set("actorUserId", filter.actorUserId);
  const from = jstDayToIso(filter.fromDate, "start");
  if (from !== null) params.set("from", from);
  const to = jstDayToIso(filter.toDate, "end");
  if (to !== null) params.set("to", to);
  return `/audit-logs?${params.toString()}`;
}

export function fetchAuditLogs(
  client: ApiClient,
  filter: AuditLogsFilterState,
  page: number,
  signal: AbortSignal,
): Promise<Paginated<AuditLogEntry>> {
  return client.request(buildAuditLogsPath(filter, page), auditLogsResponseSchema, { signal });
}

/** ユーザーフィルタの選択肢・ユーザー名解決用 */
export function fetchTenantUsers(
  client: ApiClient,
  signal: AbortSignal,
): Promise<Paginated<TenantUser>> {
  return client.request(`/users?limit=${USERS_FETCH_LIMIT}&offset=0`, usersResponseSchema, {
    signal,
  });
}
