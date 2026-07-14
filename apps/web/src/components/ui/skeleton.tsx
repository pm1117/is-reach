import { cx } from "@/lib/cx";

export interface SkeletonProps {
  className?: string;
}

/** レイアウト既知の読み込みに使うスケルトン（ui-spec 4.1: 領域の置き換え = スケルトン） */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cx("animate-pulse rounded bg-neutral-200", className)} />
  );
}
