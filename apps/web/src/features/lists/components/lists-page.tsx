"use client";

// S3 リスト一覧（ui-spec 2.2 — 要件 F1 / F5）。
// リスト名・作成日時のテーブル + 名前変更 / 削除（権限は全員 — design-detail 2.2 優先で確定済み）。
import type { CompanyList } from "@is-reach/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { TextInput } from "@/components/ui/text-input";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { PAGE_SIZE } from "@/lib/config/pagination";
import { formatDateTimeJst } from "@/lib/format/date";
import { deleteCompanyList, fetchCompanyLists, updateCompanyList } from "../api";
import { describeActionError } from "../error-message";

export function ListsPage() {
  const client = getBrowserApiClient();
  const router = useRouter();
  const { showToast } = useToast();

  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;
  const query = useApiQuery(
    useCallback(
      (signal: AbortSignal) => fetchCompanyLists(client, { limit: PAGE_SIZE, offset }, signal),
      [client, offset],
    ),
  );

  const [renameTarget, setRenameTarget] = useState<CompanyList | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyList | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 末尾ページで最後の 1 件を削除した場合など、総件数が縮んだらページ番号を範囲内へ戻す
  const listsData = query.state.status === "ready" ? query.state.data : null;
  useEffect(() => {
    if (listsData === null) return;
    const pageCount = Math.max(1, Math.ceil(listsData.total / PAGE_SIZE));
    setPage((current) => Math.min(current, pageCount));
  }, [listsData]);

  async function handleRename(name: string) {
    if (renameTarget === null) return;
    setRenaming(true);
    try {
      await updateCompanyList(client, renameTarget.id, name);
      showToast({ tone: "success", message: "リスト名を変更しました" });
      setRenameTarget(null);
      query.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("リスト名の変更に失敗しました", error),
      });
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      await deleteCompanyList(client, deleteTarget.id);
      showToast({ tone: "success", message: "リストを削除しました" });
      setDeleteTarget(null);
      query.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("リストの削除に失敗しました", error),
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader title="リスト" />

      {query.state.status === "loading" ? (
        <LoadingState label="リストを読み込んでいます…" />
      ) : query.state.status === "error" ? (
        <ErrorState requestId={query.state.requestId} onRetry={query.reload} />
      ) : query.state.data.total === 0 ? (
        <EmptyState
          title="まだリストがありません。スクリーニング検索から企業を抽出して保存しましょう"
          action={
            <Button variant="primary" onClick={() => router.push("/screening")}>
              スクリーニング検索へ
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>リスト名</TableHeaderCell>
                <TableHeaderCell className="w-44">作成日時</TableHeaderCell>
                <TableHeaderCell className="w-44">操作</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.state.data.items.map((list) => (
                <TableRow key={list.id} className="hover:bg-neutral-50">
                  <TableCell className="font-medium">
                    <Link
                      href={`/lists/${list.id}`}
                      className="text-primary hover:text-primary-hover hover:underline"
                    >
                      {list.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-neutral-500">
                    {formatDateTimeJst(list.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setRenameTarget(list)}>
                        名前を変更
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleteTarget(list)}>
                        削除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalItems={query.state.data.total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      )}

      <ListRenameModal
        target={renameTarget}
        saving={renaming}
        onClose={() => setRenameTarget(null)}
        onSave={(name) => void handleRename(name)}
      />
      <ListDeleteModal
        target={deleteTarget}
        deleting={deleting}
        onClose={() => setDeleteTarget(null)}
        onDelete={() => void handleDelete()}
      />
    </div>
  );
}

function ListRenameModal({
  target,
  saving,
  onClose,
  onSave,
}: {
  target: CompanyList | null;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  // 対象が変わるたびに現在名で初期化する
  useEffect(() => {
    setName(target?.name ?? "");
    setError(undefined);
  }, [target]);

  function handleSave() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("リスト名を入力してください");
      return;
    }
    setError(undefined);
    onSave(trimmed);
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="リスト名を変更"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            保存する
          </Button>
        </>
      }
    >
      <TextInput
        label="リスト名"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={error}
        disabled={saving}
      />
    </Modal>
  );
}

function ListDeleteModal({
  target,
  deleting,
  onClose,
  onDelete,
}: {
  target: CompanyList | null;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="リストを削除"
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            キャンセル
          </Button>
          <Button variant="danger" loading={deleting} onClick={onDelete}>
            削除する
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-600">
        リスト「{target?.name ?? ""}」を削除します。リスト内のエントリ・深掘り結果・メッセージも
        削除され、この操作は取り消せません。
      </p>
    </Modal>
  );
}
