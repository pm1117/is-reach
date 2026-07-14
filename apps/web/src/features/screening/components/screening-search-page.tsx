"use client";

// S2 スクリーニング検索（ui-spec 2.3 — 要件 F1）。
// 左: 検索条件パネル / 右: 結果テーブル + 「リストとして保存」。
// 検索は同期・即時応答（basic-design 4.2）。結果はクライアント側でページネーションする
// （API は limit 上限までを一括返却するため — screeningSearchResponseSchema）。
import type { ScreeningSearchRequest, ScreeningSearchResponse } from "@is-reach/shared";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { PAGE_SIZE } from "@/lib/config/pagination";
import { createCompanyList, fetchScreeningFacets, runScreeningSearch } from "../api";
import { describeActionError } from "../error-message";
import { ScreeningConditionForm } from "./screening-condition-form";
import { ScreeningResultTable } from "./screening-result-table";
import { ScreeningSaveListModal } from "./screening-save-list-modal";

interface SearchResult {
  /** リスト保存時に同梱する条件スナップショット（要件 F1 受け入れ条件 1） */
  condition: ScreeningSearchRequest;
  response: ScreeningSearchResponse;
}

export function ScreeningSearchPage() {
  const client = getBrowserApiClient();
  const router = useRouter();
  const { showToast } = useToast();

  const facetsQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchScreeningFacets(client, signal), [client]),
  );

  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(1);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSearch(request: ScreeningSearchRequest) {
    setSearching(true);
    try {
      const response = await runScreeningSearch(client, request);
      setResult({ condition: request, response });
      // 既定は全選択（採用の除外をチェック解除で行う）
      setSelected(new Set(response.results.map((item) => item.company.id)));
      setPage(1);
    } catch (error) {
      // 操作エラーはトースト + 入力保持（ui-spec 4.3）
      showToast({ tone: "danger", message: describeActionError("検索に失敗しました", error) });
    } finally {
      setSearching(false);
    }
  }

  async function handleSave(name: string) {
    if (result === null || selected.size === 0) return;
    setSaving(true);
    try {
      const list = await createCompanyList(client, {
        name,
        searchCondition: result.condition,
        companyIds: [...selected],
      });
      showToast({ tone: "success", message: "リストを作成しました" });
      router.push(`/lists/${list.id}`);
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("リストの保存に失敗しました", error),
      });
      setSaving(false);
    }
    // 成功時は遷移するため saving は解除しない（二重送信防止）
  }

  function toggleCompany(companyId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  }

  function toggleAll() {
    if (result === null) return;
    const allIds = result.response.results.map((item) => item.company.id);
    setSelected((current) => (current.size === allIds.length ? new Set() : new Set(allIds)));
  }

  const results = result?.response.results ?? [];
  const pageItems = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <PageHeader title="スクリーニング検索" />
      <div className="flex items-start gap-6">
        <aside className="w-72 shrink-0">
          {facetsQuery.state.status === "loading" ? (
            <LoadingState label="検索条件を読み込んでいます…" />
          ) : facetsQuery.state.status === "error" ? (
            <ErrorState
              title="検索条件の読み込みに失敗しました"
              requestId={facetsQuery.state.requestId}
              onRetry={facetsQuery.reload}
            />
          ) : (
            <ScreeningConditionForm
              facets={facetsQuery.state.data}
              searching={searching}
              onSearch={(request) => void handleSearch(request)}
            />
          )}
        </aside>

        <section className="min-w-0 flex-1" aria-label="検索結果">
          {result === null ? (
            <EmptyState
              title="検索条件を指定して「検索する」を押してください"
              description="企業属性と公開シグナル（求人・技術ブログ・プレスリリース）で候補企業を抽出できます"
            />
          ) : results.length === 0 ? (
            <EmptyState
              title="条件に一致する企業がありません"
              description="条件を変更して再検索してください"
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-neutral-600">
                  該当 {result.response.total} 社（選択中 {selected.size} 社）
                </p>
                <Button
                  variant="primary"
                  disabled={selected.size === 0}
                  onClick={() => setSaveModalOpen(true)}
                >
                  リストとして保存 ({selected.size} 社)
                </Button>
              </div>
              <ScreeningResultTable
                items={pageItems}
                selected={selected}
                onToggleCompany={toggleCompany}
                allSelected={selected.size === results.length && results.length > 0}
                someSelected={selected.size > 0}
                onToggleAll={toggleAll}
              />
              <Pagination
                page={page}
                totalItems={results.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          )}
        </section>
      </div>

      <ScreeningSaveListModal
        open={saveModalOpen}
        companyCount={selected.size}
        saving={saving}
        onClose={() => setSaveModalOpen(false)}
        onSave={(name) => void handleSave(name)}
      />
    </div>
  );
}
