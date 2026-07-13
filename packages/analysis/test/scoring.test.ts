import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  SCREENING_SCORE_WEIGHTS,
  ageInDays,
  freshnessBonus,
  scoreSignal,
} from "../src/index.js";

describe("freshnessBonus", () => {
  it("段階制: 新しいほど高く、境界（ちょうど N 日）は当該段に含む", () => {
    expect(freshnessBonus(0)).toBe(5);
    expect(freshnessBonus(7)).toBe(5);
    expect(freshnessBonus(7.001)).toBe(3);
    expect(freshnessBonus(30)).toBe(3);
    expect(freshnessBonus(90)).toBe(1);
    expect(freshnessBonus(90.001)).toBe(0);
    expect(freshnessBonus(365)).toBe(0);
  });
});

describe("ageInDays", () => {
  it("基準時刻からの経過日数を返し、未来（時計ずれ）は 0 に丸める", () => {
    const evaluatedAtMs = Date.parse("2026-07-13T00:00:00.000Z");
    expect(ageInDays(evaluatedAtMs - DAY_MS, evaluatedAtMs)).toBe(1);
    expect(ageInDays(evaluatedAtMs, evaluatedAtMs)).toBe(0);
    expect(ageInDays(evaluatedAtMs + DAY_MS, evaluatedAtMs)).toBe(0);
  });
});

describe("scoreSignal", () => {
  it("基礎点 + キーワードヒット × 重み + 鮮度ボーナス（決定的）", () => {
    const { signalBase, keywordHit } = SCREENING_SCORE_WEIGHTS;
    expect(scoreSignal({ keywordHits: 0, ageDays: 365 })).toBe(signalBase);
    expect(scoreSignal({ keywordHits: 2, ageDays: 0 })).toBe(signalBase + keywordHit * 2 + 5);
    expect(scoreSignal({ keywordHits: 1, ageDays: 30 })).toBe(signalBase + keywordHit + 3);
    // 同一入力 → 同一スコア
    expect(scoreSignal({ keywordHits: 1, ageDays: 30 })).toBe(
      scoreSignal({ keywordHits: 1, ageDays: 30 }),
    );
  });
});
