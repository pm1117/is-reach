"use client";

// S6 右の参照ペイン: ドシエ要約（推定課題・接続点 + 根拠）を読み取り専用で表示する
// （ui-spec 6.1 — 編集中に根拠を確認できる）。本文は SafeText、根拠 URL は ExternalLink（U8）。
import { useCallback } from "react";
import type { DossierSection } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { ExternalLink } from "@/components/ui/external-link";
import { SafeText } from "@/components/ui/safe-text";
import { Skeleton } from "@/components/ui/skeleton";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { fetchDossierOrNull } from "../api";

export interface DossierReferencePaneProps {
  entryId: string;
}

export function DossierReferencePane({ entryId }: DossierReferencePaneProps) {
  const query = useApiQuery(
    useCallback(
      (signal: AbortSignal) => fetchDossierOrNull(getBrowserApiClient(), entryId, signal),
      [entryId],
    ),
  );

  return (
    <Card title="ドシエ要約">
      {query.state.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-label="ドシエ要約を読み込み中">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.state.status === "error" ? (
        <ErrorState
          title="ドシエ要約の読み込みに失敗しました"
          requestId={query.state.requestId}
          onRetry={query.reload}
        />
      ) : query.state.data === null ? (
        <p className="text-sm text-neutral-500">ドシエがありません</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ReferenceGroup title="推定課題" sections={query.state.data.inferredIssues} />
          <ReferenceGroup title="接続点" sections={query.state.data.serviceHooks} />
        </div>
      )}
    </Card>
  );
}

function ReferenceGroup({
  title,
  sections,
}: {
  title: string;
  sections: ReadonlyArray<DossierSection>;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold text-neutral-700">{title}</h3>
      {sections.length === 0 ? (
        <p className="text-xs text-neutral-500">項目がありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sections.map((section, index) => (
            <li key={index} className="rounded border border-neutral-200 p-2">
              <SafeText text={section.body} maxLines={4} className="text-xs text-neutral-800" />
              <div className="mt-1">
                {section.evidence.kind === "sources" ? (
                  <ul className="flex flex-col gap-0.5">
                    {section.evidence.urls.map((url) => (
                      <li key={url}>
                        <ExternalLink href={url} className="text-xs" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Badge tone="warning">根拠なし</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
