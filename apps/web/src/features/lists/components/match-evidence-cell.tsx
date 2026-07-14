"use client";

// マッチ根拠セル（要件 F1 受け入れ条件 2: 検索結果には必ず根拠が付く）。
// シグナル種別バッジ + 要約（折りたたみ）+ 展開で根拠詳細（要約全文・出典 URL・収集日時）。
// 要約・出典 URL はスクレイピング由来 = 信頼境界外のため SafeText / ExternalLink に限定する
// （ui-spec 7 章 — レビュー必須観点）。
// note: features/screening にも同一実装がある（feature 間 import 禁止 — ui-spec 3.1 U3。
// 共通化する場合は ui/ 層への昇格を別 PR で提案する）。
import type { MatchedSignal } from "@is-reach/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/ui/external-link";
import { SafeText } from "@/components/ui/safe-text";
import { SIGNAL_KIND_LABELS } from "@/lib/labels/signal-kind";
import { formatDateTimeJst } from "@/lib/format/date";

export interface MatchEvidenceCellProps {
  signals: ReadonlyArray<MatchedSignal>;
}

export function MatchEvidenceCell({ signals }: MatchEvidenceCellProps) {
  const [expanded, setExpanded] = useState(false);

  if (signals.length === 0) {
    return <span className="text-xs text-neutral-400">—</span>;
  }

  const kinds = [...new Set(signals.map((signal) => signal.kind))];
  const first = signals[0];

  return (
    <div className="max-w-md">
      <div className="flex flex-wrap items-center gap-1.5">
        {kinds.map((kind) => (
          <Badge key={kind} tone={SIGNAL_KIND_LABELS[kind].tone}>
            {SIGNAL_KIND_LABELS[kind].label}
          </Badge>
        ))}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="text-xs font-medium text-primary hover:text-primary-hover"
        >
          {expanded ? "根拠を閉じる" : `根拠詳細 (${signals.length})`}
        </button>
      </div>
      {!expanded && first !== undefined ? (
        <SafeText text={first.summary} maxLines={2} className="mt-1 text-xs text-neutral-600" />
      ) : null}
      {expanded ? (
        <ul className="mt-2 flex flex-col gap-2">
          {signals.map((signal) => (
            <li key={signal.signalId} className="rounded border border-neutral-200 p-2">
              <div className="flex items-center gap-2">
                <Badge tone={SIGNAL_KIND_LABELS[signal.kind].tone}>
                  {SIGNAL_KIND_LABELS[signal.kind].label}
                </Badge>
                <span className="text-xs text-neutral-500">
                  収集: {formatDateTimeJst(signal.collectedAt)}
                </span>
              </div>
              <SafeText text={signal.summary} className="mt-1 text-xs text-neutral-700" />
              <div className="mt-1 text-xs">
                <ExternalLink href={signal.sourceUrl} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
