"use client";

// S2 検索結果テーブル（ui-spec 2.3: 企業名 | 業種 | 従業員数 | 地域 | マッチ根拠）。
// 企業属性はスクレイピング由来 = 信頼境界外のため SafeText で表示する（ui-spec 7 章）。
import type { ScreeningSearchResponse } from "@is-reach/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { SafeText } from "@/components/ui/safe-text";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { MatchEvidenceCell } from "./match-evidence-cell";

type ScreeningResultItem = ScreeningSearchResponse["results"][number];

export interface ScreeningResultTableProps {
  /** 現在ページ分の結果（ページ分割は呼び出し側で行う） */
  items: ReadonlyArray<ScreeningResultItem>;
  selected: ReadonlySet<string>;
  onToggleCompany: (companyId: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}

export function ScreeningResultTable({
  items,
  selected,
  onToggleCompany,
  allSelected,
  someSelected,
  onToggleAll,
}: ScreeningResultTableProps) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-10">
            <Checkbox
              aria-label="すべての企業を選択"
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onChange={onToggleAll}
            />
          </TableHeaderCell>
          <TableHeaderCell>企業名</TableHeaderCell>
          <TableHeaderCell>業種</TableHeaderCell>
          <TableHeaderCell>従業員数</TableHeaderCell>
          <TableHeaderCell>地域</TableHeaderCell>
          <TableHeaderCell>マッチ根拠</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.company.id}>
            <TableCell>
              <Checkbox
                aria-label={`${item.company.name} を選択`}
                checked={selected.has(item.company.id)}
                onChange={() => onToggleCompany(item.company.id)}
              />
            </TableCell>
            <TableCell className="font-medium">
              <SafeText text={item.company.name} />
            </TableCell>
            <TableCell>
              <NullableText value={item.company.industry} />
            </TableCell>
            <TableCell>
              <NullableText value={item.company.employeeRange} />
            </TableCell>
            <TableCell>
              <NullableText value={item.company.region} />
            </TableCell>
            <TableCell>
              <MatchEvidenceCell signals={item.matchedSignals} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** 外部由来の nullable 属性: 欠損は「—」、値は SafeText で表示 */
function NullableText({ value }: { value: string | null }) {
  if (value === null) {
    return <span className="text-neutral-400">—</span>;
  }
  return <SafeText text={value} />;
}
