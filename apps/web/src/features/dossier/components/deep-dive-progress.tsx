// 深掘りジョブの実行中フェーズ表示（ui-spec 4.5 — 決定 U6）。
// パーセント表示は禁止（状態機械にパーセント情報がない）。ステップインジケータ
// 「収集 → 分析 → 完了」+ 不定プログレスバー + 状態文言で現在位置を示す。
import type { DeepDiveJobState } from "@is-reach/shared";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

const STEPS = [
  { key: "collect", label: "収集" },
  { key: "analyze", label: "分析" },
  { key: "done", label: "完了" },
] as const;

/** 実行中状態 → 状態文言（ui-spec 4.5 の表。queued は仮置き文言） */
const PHASE_MESSAGES: Partial<Record<DeepDiveJobState, string>> = {
  queued: "実行を待機しています",
  collecting: "公開情報を収集しています",
  analyzing: "収集した情報を分析しています",
};

function currentStepIndex(state: DeepDiveJobState): number {
  switch (state) {
    case "queued":
    case "collecting":
      return 0;
    case "analyzing":
      return 1;
    case "done":
    case "failed":
      return 2;
  }
}

export interface DeepDiveProgressProps {
  state: DeepDiveJobState;
}

export function DeepDiveProgress({ state }: DeepDiveProgressProps) {
  const activeIndex = currentStepIndex(state);
  const message = PHASE_MESSAGES[state] ?? "処理を実行しています";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <ol className="flex items-center gap-2" aria-label="深掘りの進行状況">
        {STEPS.map((step, index) => (
          <li key={step.key} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-neutral-400">
                →
              </span>
            ) : null}
            <span
              className={cx(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                index === activeIndex
                  ? "bg-primary-subtle text-primary"
                  : index < activeIndex
                    ? "text-neutral-700"
                    : "text-neutral-400",
              )}
              aria-current={index === activeIndex ? "step" : undefined}
            >
              {index === activeIndex ? <Spinner size="sm" /> : null}
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <ProgressBar label={message} />
      <p className="text-sm text-neutral-600">{message}</p>
    </div>
  );
}
