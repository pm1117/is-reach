"use client";

import { Button } from "./button";

export interface PaginationProps {
  /** 1 始まりのページ番号 */
  page: number;
  totalItems: number;
  /** 1 ページの件数（仮置き 50 件 — ui-spec 2.3） */
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  return (
    <nav aria-label="ページネーション" className={className}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">
          {page} / {pageCount} ページ（全 {totalItems} 件）
        </span>
        <div className="flex gap-2">
          <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            前へ
          </Button>
          <Button size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            次へ
          </Button>
        </div>
      </div>
    </nav>
  );
}
