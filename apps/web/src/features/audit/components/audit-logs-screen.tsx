"use client";

// S9 監査ログ閲覧（管理者のみ — U9。閲覧専用: 追記専用データのため編集操作は一切置かない）。
// フィルタ: 期間（from/to）・ユーザー・イベント種別。ページネーション（PAGE_SIZE）。
import { useCallback, useMemo, useState } from "react";
import { auditEventTypeSchema, type AuditLogEntry } from "@is-reach/shared";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { SafeText } from "@/components/ui/safe-text";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { TextInput } from "@/components/ui/text-input";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { PAGE_SIZE } from "@/lib/config/pagination";
import { formatDateTimeJst } from "@/lib/format/date";
import {
  EMPTY_FILTER,
  fetchAuditLogs,
  fetchTenantUsers,
  hasActiveFilter,
  type AuditLogsFilterState,
} from "../api";
import { AUDIT_EVENT_TYPE_LABELS } from "../labels";

const EVENT_TYPE_OPTIONS = auditEventTypeSchema.options.map((eventType) => ({
  value: eventType,
  label: AUDIT_EVENT_TYPE_LABELS[eventType],
}));

function ActorCell({
  entry,
  userNameById,
}: {
  entry: AuditLogEntry;
  userNameById: ReadonlyMap<string, string>;
}) {
  if (entry.actorUserId === null) {
    return <span className="text-neutral-400">システム</span>;
  }
  const name = userNameById.get(entry.actorUserId);
  if (name === undefined) {
    // 解決不能（無効化済みユーザー等）は ID の先頭のみ表示（UUID のため表示安全）
    return <span className="text-neutral-400">{entry.actorUserId.slice(0, 8)}…</span>;
  }
  // 表示名はユーザー入力由来のため SafeText（U8）
  return <SafeText text={name} maxLines={1} />;
}

function ResourceCell({ entry }: { entry: AuditLogEntry }) {
  if (entry.resourceType === null) {
    return <span className="text-neutral-400">—</span>;
  }
  return (
    <span className="text-xs">
      {/* resourceType はサーバー定義の識別子だが、契約上自由文字列のため SafeText で表示する */}
      <SafeText text={entry.resourceType} maxLines={1} className="inline-block align-bottom" />
      {entry.resourceId !== null ? (
        <span className="ml-1 text-neutral-400">{entry.resourceId.slice(0, 8)}…</span>
      ) : null}
    </span>
  );
}

export function AuditLogsScreen() {
  const client = getBrowserApiClient();
  const [filter, setFilter] = useState<AuditLogsFilterState>(EMPTY_FILTER);
  const [page, setPage] = useState(1);

  const logsQuery = useApiQuery(
    useCallback(
      (signal: AbortSignal) => fetchAuditLogs(client, filter, page, signal),
      [client, filter, page],
    ),
  );
  const usersQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchTenantUsers(client, signal), [client]),
  );

  const users = usersQuery.state.status === "ready" ? usersQuery.state.data.items : [];
  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.id, user.displayName ?? user.email);
    }
    return map;
  }, [users]);
  const userOptions = users.map((user) => ({
    value: user.id,
    label: user.displayName ?? user.email,
  }));

  function updateFilter(patch: Partial<AuditLogsFilterState>) {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilter() {
    setFilter(EMPTY_FILTER);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="監査ログ" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextInput
          label="開始日"
          type="date"
          value={filter.fromDate}
          onChange={(event) => updateFilter({ fromDate: event.target.value })}
          className="w-40"
        />
        <TextInput
          label="終了日"
          type="date"
          value={filter.toDate}
          onChange={(event) => updateFilter({ toDate: event.target.value })}
          className="w-40"
        />
        <Select
          label="ユーザー"
          placeholder="すべて"
          options={userOptions}
          value={filter.actorUserId}
          onChange={(event) => updateFilter({ actorUserId: event.target.value })}
          className="w-52"
        />
        <Select
          label="イベント種別"
          placeholder="すべて"
          options={EVENT_TYPE_OPTIONS}
          value={filter.eventType}
          onChange={(event) => {
            const parsed = auditEventTypeSchema.safeParse(event.target.value);
            updateFilter({ eventType: parsed.success ? parsed.data : "" });
          }}
          className="w-56"
        />
        {hasActiveFilter(filter) ? <Button onClick={clearFilter}>フィルタクリア</Button> : null}
      </div>

      {logsQuery.state.status === "loading" ? (
        <div role="status" aria-label="読み込んでいます" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}
      {logsQuery.state.status === "error" ? (
        <ErrorState requestId={logsQuery.state.requestId} onRetry={logsQuery.reload} />
      ) : null}
      {logsQuery.state.status === "ready" ? (
        logsQuery.state.data.total === 0 ? (
          <EmptyState
            title="条件に一致するログがありません"
            action={
              hasActiveFilter(filter) ? (
                <Button onClick={clearFilter}>フィルタクリア</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>日時</TableHeaderCell>
                  <TableHeaderCell>ユーザー</TableHeaderCell>
                  <TableHeaderCell>イベント種別</TableHeaderCell>
                  <TableHeaderCell>対象リソース</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logsQuery.state.data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTimeJst(entry.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <ActorCell entry={entry} userNameById={userNameById} />
                    </TableCell>
                    <TableCell>{AUDIT_EVENT_TYPE_LABELS[entry.eventType]}</TableCell>
                    <TableCell>
                      <ResourceCell entry={entry} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              totalItems={logsQuery.state.data.total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
