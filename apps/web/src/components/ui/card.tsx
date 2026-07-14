import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className }: CardProps) {
  return (
    <section
      className={cx("rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm", className)}
    >
      {title !== undefined ? (
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}
