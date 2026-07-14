// ドシエの 1 項目（本文 + 根拠）。要件 F3 受け入れ条件 2:
// 「本文 + 根拠 URL リスト」または「本文 + 根拠なしバッジ + 注記」を必ず表示する。
// 本文・根拠 URL は外部由来のため SafeText / ExternalLink に集約する（ui-spec 7 章 — U8）。
import type { DossierSection } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/ui/external-link";
import { SafeText } from "@/components/ui/safe-text";

/** 根拠なし項目の注記（ui-spec 2.3 S5 — 決定文言） */
export const NO_EVIDENCE_NOTE =
  "この項目には出典が確認できていません。事実として扱わないでください";

export interface DossierSectionItemProps {
  section: DossierSection;
  /** 参照ペインなど省スペース表示用（本文の折りたたみ行数を詰める） */
  compact?: boolean;
}

export function DossierSectionItem({ section, compact = false }: DossierSectionItemProps) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <SafeText
        text={section.body}
        maxLines={compact ? 4 : undefined}
        className="text-sm text-neutral-800"
      />
      <div className="mt-2">
        {section.evidence.kind === "sources" ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-neutral-500">根拠:</span>
            <ul className="flex flex-col gap-0.5">
              {section.evidence.urls.map((url) => (
                <li key={url}>
                  <ExternalLink href={url} className="text-xs" />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge tone="warning" className="self-start">
              根拠なし
            </Badge>
            <p className="text-xs text-warning-hover">{NO_EVIDENCE_NOTE}</p>
          </div>
        )}
      </div>
    </div>
  );
}
