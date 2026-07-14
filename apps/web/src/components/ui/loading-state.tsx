import { Spinner } from "./spinner";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** 領域単位のローディング表示（ui-spec 4.1） */
export function LoadingState({ label = "読み込んでいます…", className }: LoadingStateProps) {
  return (
    <div role="status" className={className}>
      <div className="flex flex-col items-center gap-2 py-12 text-neutral-500">
        <Spinner />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
