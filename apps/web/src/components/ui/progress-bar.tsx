import { cx } from "@/lib/cx";

export interface ProgressBarProps {
  /** スクリーンリーダー向けの説明（例: 「公開情報を収集しています」）。省略時は汎用文言 */
  label?: string;
  className?: string;
}

/**
 * 不定（indeterminate）プログレスバー（ui-spec 4.5 — 決定）。
 * 状態機械にパーセント情報がないため擬似的な進捗率は表示せず、
 * 「動いている」ことだけを示す。フェーズ表示（バッジ・ステップ）と併用する前提の見た目のみの部品。
 * aria-valuenow を持たないことで支援技術上も不定進捗として扱われる。
 */
export function ProgressBar({ label = "処理を実行しています", className }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cx("relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-200", className)}
    >
      {/* w-2/5 はアニメーション（globals.css: translateX 250% = 100% / 40%）と対で変更する。
          reduced-motion 環境では移動をやめ、全幅バーの明滅（animate-pulse）に切り替える */}
      <span
        className={cx(
          "animate-progress-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary",
          "motion-reduce:animate-pulse motion-reduce:w-full",
        )}
      />
    </div>
  );
}
