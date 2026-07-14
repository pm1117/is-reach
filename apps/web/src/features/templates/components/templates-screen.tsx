"use client";

// S7 テンプレート管理（ui-spec 2.3 — 要件 F4 / 決定 E3）。
// - 一覧・詳細の閲覧は全員。作成・編集・削除は管理者のみ「表示」する（メンバーには
//   disabled ではなく非表示 — ui-spec 8 章 U9。サーバー側認可が本線）。
// - 空状態文言はロール別（ui-spec 4.2 の表のとおり）。
// 【仮置き】ui-spec 2.3 は一覧に「更新者」を挙げるが、shared の templateSchema に更新者
// フィールドがないため、詳細ペインに作成者（createdBy）を表示して代替する（契約追随は別 PR）。
import { useCallback, useMemo, useState } from "react";
import type { CreateTemplateRequest, Template } from "@is-reach/shared";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { SafeText } from "@/components/ui/safe-text";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useMe } from "@/lib/auth/me-context";
import { cx } from "@/lib/cx";
import { formatDateTimeJst } from "@/lib/format/date";
import {
  createTemplate,
  deleteTemplate,
  fetchTemplates,
  fetchTenantUsers,
  mutationErrorMessage,
  updateTemplate,
} from "../api";
import { TemplateDetail } from "./template-detail";
import { TemplateForm } from "./template-form";

type PaneMode = "view" | "create" | "edit";

export function TemplatesScreen() {
  const client = getBrowserApiClient();
  const { state: meState } = useMe();
  const isAdmin = meState.status === "ready" && meState.me.user.role === "admin";
  const { showToast } = useToast();

  const templatesQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchTemplates(client, signal), [client]),
  );
  // 作成者名の解決用（取得失敗しても画面は壊さず「—」表示に落とす）
  const usersQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchTenantUsers(client, signal), [client]),
  );
  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (usersQuery.state.status === "ready") {
      for (const user of usersQuery.state.data.items) {
        map.set(user.id, user.displayName ?? user.email);
      }
    }
    return map;
  }, [usersQuery.state]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<PaneMode>("view");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mutating, setMutating] = useState(false);

  const templates = templatesQuery.state.status === "ready" ? templatesQuery.state.data.items : [];
  const selected: Template | undefined = templates.find((item) => item.id === selectedId);

  async function handleCreate(values: CreateTemplateRequest) {
    setMutating(true);
    try {
      const created = await createTemplate(client, values);
      showToast({ tone: "success", message: "テンプレートを作成しました" });
      setSelectedId(created.id);
      setMode("view");
      templatesQuery.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "テンプレートの作成に失敗しました"),
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleUpdate(values: CreateTemplateRequest) {
    if (selected === undefined) return;
    setMutating(true);
    try {
      await updateTemplate(client, selected.id, values);
      showToast({ tone: "success", message: "テンプレートを保存しました" });
      setMode("view");
      templatesQuery.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "テンプレートの保存に失敗しました"),
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleDelete() {
    if (selected === undefined) return;
    setMutating(true);
    try {
      await deleteTemplate(client, selected.id);
      showToast({ tone: "success", message: "テンプレートを削除しました" });
      setDeleteOpen(false);
      setSelectedId(null);
      setMode("view");
      templatesQuery.reload();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "テンプレートの削除に失敗しました"),
      });
    } finally {
      setMutating(false);
    }
  }

  const startCreate = () => {
    setMode("create");
    setSelectedId(null);
  };

  return (
    <div>
      <PageHeader
        title="テンプレート"
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={startCreate}>
              新規作成
            </Button>
          ) : undefined
        }
      />

      {templatesQuery.state.status === "loading" ? (
        <div role="status" aria-label="読み込んでいます" className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}
      {templatesQuery.state.status === "error" ? (
        <ErrorState requestId={templatesQuery.state.requestId} onRetry={templatesQuery.reload} />
      ) : null}

      {templatesQuery.state.status === "ready" ? (
        templates.length === 0 && mode !== "create" ? (
          // 空状態はロール別文言（ui-spec 4.2。メンバーには導線を置かない）
          isAdmin ? (
            <EmptyState
              title="テンプレートを作成すると、メッセージ生成で選択できるようになります"
              action={
                <Button variant="primary" onClick={startCreate}>
                  テンプレートを作成
                </Button>
              }
            />
          ) : (
            <EmptyState title="利用できるテンプレートがありません。管理者に作成を依頼してください" />
          )
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            {templates.length > 0 ? (
              <Card className="p-2">
                <ul className="space-y-1">
                  {templates.map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(template.id);
                          setMode("view");
                        }}
                        className={cx(
                          "w-full rounded-md px-2.5 py-2 text-left hover:bg-neutral-100",
                          template.id === selectedId ? "bg-primary-subtle" : undefined,
                        )}
                      >
                        {/* テンプレート名はユーザー入力由来だがボタン内のため SafeText を使わない
                            （SafeText は過長時に展開ボタンを描画し button 入れ子になる）。
                            React の自動エスケープによるプレーンテキスト + truncate で表示する（U8 準拠） */}
                        <span className="block truncate text-sm font-medium text-neutral-800">
                          {template.name}
                        </span>
                        <div className="mt-0.5 text-xs text-neutral-500">
                          更新: {formatDateTimeJst(template.updatedAt)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card className={templates.length === 0 ? "lg:col-span-2" : undefined}>
              {mode === "create" && isAdmin ? (
                <TemplateForm
                  submitting={mutating}
                  onSubmit={handleCreate}
                  onCancel={() => setMode("view")}
                />
              ) : mode === "edit" && isAdmin && selected !== undefined ? (
                <TemplateForm
                  key={selected.id}
                  initial={selected}
                  submitting={mutating}
                  onSubmit={handleUpdate}
                  onCancel={() => setMode("view")}
                />
              ) : selected !== undefined ? (
                <TemplateDetail
                  template={selected}
                  createdByName={
                    selected.createdBy === null
                      ? null
                      : (userNameById.get(selected.createdBy) ?? null)
                  }
                  actions={
                    // メンバーには一切のボタンを出さない（非表示 — U9）
                    isAdmin ? (
                      <>
                        <Button onClick={() => setMode("edit")}>編集</Button>
                        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                          削除
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              ) : (
                <p className="py-12 text-center text-sm text-neutral-500">
                  テンプレートを選択すると内容が表示されます
                </p>
              )}
            </Card>
          </div>
        )
      ) : null}

      {selected !== undefined ? (
        <Modal
          open={deleteOpen}
          onClose={() => {
            if (!mutating) setDeleteOpen(false);
          }}
          title="テンプレートを削除"
          footer={
            <>
              <Button onClick={() => setDeleteOpen(false)} disabled={mutating}>
                キャンセル
              </Button>
              <Button variant="danger" loading={mutating} onClick={handleDelete}>
                削除する
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-neutral-700">
            <SafeText text={selected.name} maxLines={2} className="font-medium" />
            <p>このテンプレートを削除します。この操作は取り消せません。</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
