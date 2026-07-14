"use client";

// S8 ユーザー管理（ui-spec 2.3: 一覧テーブル + 招待モーダル + 行内アクション）。
// 行内アクション: ロール変更（PATCH /users/:userId）・無効化（danger 確認 → DELETE /users/:userId）。
// 自分自身の行にはアクションを出さない（API 側も自己無効化を拒否する）。
import { useCallback, useState } from "react";
import { roleSchema, type TenantUser } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
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
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useMe } from "@/lib/auth/me-context";
import { formatDateTimeJst } from "@/lib/format/date";
import { disableUser, fetchUsers, mutationErrorMessage, updateUserRole } from "../api";
import { INVITATION_STATUS_LABELS, ROLE_LABELS } from "../labels";
import { InviteUserModal } from "./invite-user-modal";

const ROLE_OPTIONS = roleSchema.options.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function UsersSection() {
  const client = getBrowserApiClient();
  const { state: meState } = useMe();
  const selfId = meState.status === "ready" ? meState.me.user.id : null;
  const { showToast } = useToast();

  const usersQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchUsers(client, signal), [client]),
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<TenantUser | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  async function handleRoleChange(user: TenantUser, roleValue: string) {
    const parsed = roleSchema.safeParse(roleValue);
    if (!parsed.success || parsed.data === user.role) return;
    setBusyUserId(user.id);
    try {
      await updateUserRole(client, user.id, { role: parsed.data });
      showToast({ tone: "success", message: "ロールを変更しました" });
      usersQuery.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "ロールの変更に失敗しました"),
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleDisable() {
    if (disableTarget === null) return;
    setDisabling(true);
    try {
      await disableUser(client, disableTarget.id);
      showToast({ tone: "success", message: "ユーザーを無効化しました" });
      setDisableTarget(null);
      usersQuery.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "ユーザーの無効化に失敗しました"),
      });
    } finally {
      setDisabling(false);
    }
  }

  return (
    <section aria-label="ユーザー管理">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">ユーザー管理</h2>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          ユーザーを招待
        </Button>
      </div>

      {usersQuery.state.status === "loading" ? (
        <div role="status" aria-label="読み込んでいます" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}
      {usersQuery.state.status === "error" ? (
        <ErrorState requestId={usersQuery.state.requestId} onRetry={usersQuery.reload} />
      ) : null}
      {usersQuery.state.status === "ready" ? (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>メール</TableHeaderCell>
              <TableHeaderCell>表示名</TableHeaderCell>
              <TableHeaderCell>ロール</TableHeaderCell>
              <TableHeaderCell>状態</TableHeaderCell>
              <TableHeaderCell>登録日時</TableHeaderCell>
              <TableHeaderCell>操作</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {usersQuery.state.data.items.map((user) => {
              const isSelf = user.id === selfId;
              const statusLabel = INVITATION_STATUS_LABELS[user.invitationStatus];
              const actionable = !isSelf && user.invitationStatus !== "disabled";
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    {/* メール・表示名はユーザー入力由来のため SafeText（U8） */}
                    <SafeText text={user.email} maxLines={1} />
                  </TableCell>
                  <TableCell>
                    {user.displayName === null ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <SafeText text={user.displayName} maxLines={1} />
                    )}
                  </TableCell>
                  <TableCell>
                    {actionable ? (
                      <Select
                        aria-label={`${user.email} のロール`}
                        options={ROLE_OPTIONS}
                        value={user.role}
                        disabled={busyUserId === user.id}
                        onChange={(event) => handleRoleChange(user, event.target.value)}
                        className="max-w-36"
                      />
                    ) : (
                      <span>
                        {ROLE_LABELS[user.role]}
                        {isSelf ? (
                          <span className="ml-1 text-xs text-neutral-400">(自分)</span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={statusLabel.tone}>{statusLabel.label}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTimeJst(user.createdAt)}</TableCell>
                  <TableCell>
                    {actionable ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyUserId === user.id}
                        onClick={() => setDisableTarget(user)}
                      >
                        無効化
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={usersQuery.reload}
      />

      <Modal
        open={disableTarget !== null}
        onClose={() => {
          if (!disabling) setDisableTarget(null);
        }}
        title="ユーザーを無効化"
        footer={
          <>
            <Button onClick={() => setDisableTarget(null)} disabled={disabling}>
              キャンセル
            </Button>
            <Button variant="danger" loading={disabling} onClick={handleDisable}>
              無効化する
            </Button>
          </>
        }
      >
        {disableTarget !== null ? (
          <div className="space-y-2 text-sm text-neutral-700">
            <SafeText text={disableTarget.email} maxLines={1} className="font-medium" />
            <p>このユーザーを無効化します。無効化するとログインできなくなります。</p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
