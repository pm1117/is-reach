// テーブル部品（情報密度優先: text-sm・py-2 — ui-spec 1.2 / 3.3）。
// 合成して使う: <Table><TableHead><TableRow><TableHeaderCell>… の構造。
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-neutral-200", className)}>
      <table className="w-full border-collapse bg-neutral-0 text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-neutral-50">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cx("border-b border-neutral-100 last:border-b-0", className)}>{children}</tr>
  );
}

export function TableHeaderCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-2 text-neutral-800", className)}>{children}</td>;
}
