"use client";

// S2 検索条件パネル（ui-spec 2.3: 企業属性 + 公開シグナル + 検索ボタン）。
// 選択肢は GET /screening/facets の実在値（外部由来の文字列を含む — プレーンテキスト表示のみ）。
import {
  screeningSearchRequestSchema,
  type ScreeningFacetsResponse,
  type ScreeningSearchRequest,
  type ScreeningSearchRequestInput,
  type SignalKind,
} from "@is-reach/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextInput } from "@/components/ui/text-input";
import { SIGNAL_KIND_LABELS } from "@/lib/labels/signal-kind";

export interface ScreeningConditionFormProps {
  facets: ScreeningFacetsResponse;
  searching: boolean;
  onSearch: (request: ScreeningSearchRequest) => void;
}

/** キーワード入力の区切り（空白・読点・カンマ） */
const KEYWORD_SEPARATOR = /[\s,、]+/;

function toggleValue(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export function ScreeningConditionForm({
  facets,
  searching,
  onSearch,
}: ScreeningConditionFormProps) {
  const [industries, setIndustries] = useState<ReadonlySet<string>>(new Set());
  const [employeeRanges, setEmployeeRanges] = useState<ReadonlySet<string>>(new Set());
  const [regions, setRegions] = useState<ReadonlySet<string>>(new Set());
  const [signalKinds, setSignalKinds] = useState<ReadonlySet<SignalKind>>(new Set());
  const [keywordsText, setKeywordsText] = useState("");
  const [freshDaysText, setFreshDaysText] = useState("");
  const [freshDaysError, setFreshDaysError] = useState<string | undefined>(undefined);

  // 空文字の facet 値は選択肢から除外する（facets 側スキーマは空文字を許容するが、
  // 検索リクエスト側は min(1) のため、混入するとリクエストを組み立てられない）
  const industryOptions = facets.industries.filter((value) => value !== "");
  const employeeRangeOptions = facets.employeeRanges.filter((value) => value !== "");
  const regionOptions = facets.regions.filter((value) => value !== "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // シグナル鮮度（日数）: 空 = 指定なし。数値以外・0 以下は検索せずフィールドエラー
    let freshWithinDays: number | undefined;
    const freshTrimmed = freshDaysText.trim();
    if (freshTrimmed !== "") {
      if (!/^\d+$/.test(freshTrimmed) || Number.parseInt(freshTrimmed, 10) < 1) {
        setFreshDaysError("1 以上の整数（日数）で指定してください");
        return;
      }
      freshWithinDays = Number.parseInt(freshTrimmed, 10);
    }
    setFreshDaysError(undefined);

    const keywords = keywordsText
      .split(KEYWORD_SEPARATOR)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== "");

    const input: ScreeningSearchRequestInput = {};
    const attributes: NonNullable<ScreeningSearchRequestInput["attributes"]> = {};
    if (industries.size > 0) attributes.industries = [...industries];
    if (employeeRanges.size > 0) attributes.employeeRanges = [...employeeRanges];
    if (regions.size > 0) attributes.regions = [...regions];
    if (Object.keys(attributes).length > 0) input.attributes = attributes;

    const signals: NonNullable<ScreeningSearchRequestInput["signals"]> = {};
    if (signalKinds.size > 0) signals.kinds = [...signalKinds];
    if (keywords.length > 0) signals.keywords = keywords;
    if (freshWithinDays !== undefined) signals.freshWithinDays = freshWithinDays;
    if (Object.keys(signals).length > 0) input.signals = signals;

    // 自前で構築・検証済みの入力（facet 値は空文字を除外、キーワード・日数も検証済み）の
    // ため parse は常に成功する（limit 既定 200 の付与が目的）
    onSearch(screeningSearchRequestSchema.parse(input));
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="検索条件"
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-4"
    >
      <FacetCheckboxGroup
        legend="業種"
        values={industryOptions}
        selected={industries}
        onToggle={(value) => setIndustries((current) => toggleValue(current, value))}
      />
      <FacetCheckboxGroup
        legend="従業員規模"
        values={employeeRangeOptions}
        selected={employeeRanges}
        onToggle={(value) => setEmployeeRanges((current) => toggleValue(current, value))}
      />
      <FacetCheckboxGroup
        legend="地域"
        values={regionOptions}
        selected={regions}
        onToggle={(value) => setRegions((current) => toggleValue(current, value))}
      />

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-neutral-700">公開シグナル種別</legend>
        <div className="flex flex-col gap-1.5">
          {facets.signalKinds.map((kind) => (
            <Checkbox
              key={kind}
              label={SIGNAL_KIND_LABELS[kind].label}
              checked={signalKinds.has(kind)}
              onChange={() =>
                setSignalKinds((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) {
                    next.delete(kind);
                  } else {
                    next.add(kind);
                  }
                  return next;
                })
              }
            />
          ))}
        </div>
      </fieldset>

      <TextInput
        label="キーワード"
        placeholder="例: React 採用"
        value={keywordsText}
        onChange={(event) => setKeywordsText(event.target.value)}
      />
      <TextInput
        label="シグナル鮮度（日数）"
        placeholder="例: 90"
        inputMode="numeric"
        value={freshDaysText}
        onChange={(event) => setFreshDaysText(event.target.value)}
        error={freshDaysError}
      />

      <Button type="submit" variant="primary" loading={searching}>
        検索する
      </Button>
    </form>
  );
}

function FacetCheckboxGroup({
  legend,
  values,
  selected,
  onToggle,
}: {
  legend: string;
  values: ReadonlyArray<string>;
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-neutral-700">{legend}</legend>
      {values.length === 0 ? (
        <p className="text-xs text-neutral-400">選択肢がありません</p>
      ) : (
        <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {values.map((value) => (
            <Checkbox
              key={value}
              // facets は共有プール（スクレイピング）由来の文字列だが、label はプレーン
              // テキストとしてレンダリングされる（React の自動エスケープ — ui-spec 7 章 5）
              label={value}
              checked={selected.has(value)}
              onChange={() => onToggle(value)}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
