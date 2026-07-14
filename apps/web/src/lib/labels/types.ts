// ドメイン enum → 表示ラベル（日本語 + Badge トーン）の共通形。
// lib/labels/ は feature 間 import 禁止（ui-spec 3.1 — U3）の回避先となる純粋マップ置き場であり、
// コンポーネントは置かない。
import type { BadgeProps } from "@/components/ui/badge";

/** Badge の tone と同一の候補集合（badge.tsx の TONES キーから型導出して同期を型保証） */
export type BadgeTone = NonNullable<BadgeProps["tone"]>;

export interface EnumLabel {
  /** 画面表示用の日本語ラベル */
  label: string;
  /** Badge で表示する際のトーン */
  tone: BadgeTone;
}
