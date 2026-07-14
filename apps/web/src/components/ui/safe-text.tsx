"use client";

// 外部由来テキストの表示専用コンポーネント（ui-spec 7 章 — 決定 U8。レビュー必須観点）。
// - React の自動エスケープによるプレーンテキスト表示のみ。HTML / Markdown として解釈しない
// - dangerouslySetInnerHTML は使用しない（ルート eslint.config.mjs でも機械的に禁止）
// - 改行は whitespace-pre-wrap で反映する（HTML 解釈はしない）
// - 過長テキストは行数制限 + 「すべて表示」で展開（既定 6 行 — 仮置き）
import { useMemo, useState } from "react";

/** 既定の表示行数（ui-spec 7 章 2 の仮置き値） */
const DEFAULT_MAX_LINES = 6;
/** 折り返しを含む概算行数の 1 行あたり文字数（仮置き。DOM 計測はせず決定的に判定する） */
const ESTIMATED_CHARS_PER_LINE = 80;

export interface SafeTextProps {
  /** 外部由来テキスト（シグナル本文・ドシエ本文・LLM 生成文など信頼境界外のデータ） */
  text: string;
  /** 折りたたみ時の最大行数 */
  maxLines?: number;
  className?: string;
}

export function SafeText({ text, maxLines = DEFAULT_MAX_LINES, className }: SafeTextProps) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = useMemo(() => estimateLineCount(text) > maxLines, [text, maxLines]);
  const clamped = collapsible && !expanded;
  return (
    <div className={className}>
      <div
        className="break-words whitespace-pre-wrap"
        style={
          clamped
            ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: maxLines,
                overflow: "hidden",
              }
            : undefined
        }
      >
        {text}
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-primary hover:text-primary-hover"
        >
          {expanded ? "折りたたむ" : "すべて表示"}
        </button>
      ) : null}
    </div>
  );
}

/** 改行 + 折り返し概算での表示行数見積もり */
function estimateLineCount(text: string): number {
  return text
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / ESTIMATED_CHARS_PER_LINE)),
      0,
    );
}
