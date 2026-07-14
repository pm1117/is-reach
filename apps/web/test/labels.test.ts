// lib/labels/（PR6b 共通基盤）: ドメイン enum の日本語ラベル + Badge トーンのマップ
import { deepDiveJobStateSchema, entryStatusSchema, signalKindSchema } from "@is-reach/shared";
import { describe, expect, it } from "vitest";
import { DEEP_DIVE_JOB_STATE_LABELS } from "@/lib/labels/deep-dive";
import { ENTRY_STATUS_LABELS } from "@/lib/labels/entry-status";
import { SIGNAL_KIND_LABELS } from "@/lib/labels/signal-kind";

describe("DEEP_DIVE_JOB_STATE_LABELS", () => {
  it("ui-spec 4.5 の表（ラベル・トーン）に完全準拠する", () => {
    expect(DEEP_DIVE_JOB_STATE_LABELS).toEqual({
      queued: { label: "待機中", tone: "neutral" },
      collecting: { label: "収集中", tone: "primary" },
      analyzing: { label: "分析中", tone: "primary" },
      done: { label: "完了", tone: "success" },
      failed: { label: "失敗", tone: "danger" },
    });
  });

  it("shared の enum 全値を網羅する（enum 追加時にテストで検知）", () => {
    for (const state of deepDiveJobStateSchema.options) {
      expect(DEEP_DIVE_JOB_STATE_LABELS[state].label).not.toBe("");
    }
  });
});

describe("ENTRY_STATUS_LABELS", () => {
  it("日本語ラベルが ui-spec 2.3 のステータス名と一致する", () => {
    expect(ENTRY_STATUS_LABELS.not_started.label).toBe("未着手");
    expect(ENTRY_STATUS_LABELS.generated.label).toBe("生成済み");
    expect(ENTRY_STATUS_LABELS.sent.label).toBe("送信済み");
    expect(ENTRY_STATUS_LABELS.replied.label).toBe("返信あり");
  });

  it("「返信あり」のみ success トーン（ui-spec 3.3）", () => {
    expect(ENTRY_STATUS_LABELS.replied.tone).toBe("success");
    expect(ENTRY_STATUS_LABELS.not_started.tone).toBe("neutral");
    expect(ENTRY_STATUS_LABELS.generated.tone).toBe("neutral");
    expect(ENTRY_STATUS_LABELS.sent.tone).toBe("neutral");
  });

  it("shared の enum 全値を網羅する", () => {
    for (const status of entryStatusSchema.options) {
      expect(ENTRY_STATUS_LABELS[status].label).not.toBe("");
    }
  });
});

describe("SIGNAL_KIND_LABELS", () => {
  it("日本語ラベルがシグナル種別（求人 / 技術ブログ / プレスリリース）と一致する", () => {
    expect(SIGNAL_KIND_LABELS.job_posting.label).toBe("求人");
    expect(SIGNAL_KIND_LABELS.tech_blog.label).toBe("技術ブログ");
    expect(SIGNAL_KIND_LABELS.press_release.label).toBe("プレスリリース");
  });

  it("shared の enum 全値を網羅する", () => {
    for (const kind of signalKindSchema.options) {
      expect(SIGNAL_KIND_LABELS[kind].label).not.toBe("");
    }
  });
});
