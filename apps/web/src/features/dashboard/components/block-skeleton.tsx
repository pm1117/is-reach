// ダッシュボードの各ブロック共通の行スケルトン（ui-spec 4.1: 領域の置き換え = スケルトン）
import { Skeleton } from "@/components/ui/skeleton";

export function BlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込んでいます" className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
