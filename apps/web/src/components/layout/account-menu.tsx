"use client";

// アカウントメニュー（ui-spec 1.4 下部: 表示名・ロールバッジ・ログアウト）
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MeResponse, Role } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  member: "メンバー",
};

export interface AccountMenuProps {
  me: MeResponse | null;
}

export function AccountMenu({ me }: AccountMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      // signOut が失敗してもログイン画面へ遷移する（middleware が再判定する）
      router.replace("/login");
    }
  }

  return (
    <div className="border-t border-neutral-200 px-4 py-3">
      {me === null ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-neutral-800">
              {me.user.displayName ?? me.user.email}
            </span>
            <Badge tone={me.user.role === "admin" ? "primary" : "neutral"}>
              {ROLE_LABELS[me.user.role]}
            </Badge>
          </div>
          <Button size="sm" variant="ghost" loading={signingOut} onClick={handleSignOut}>
            ログアウト
          </Button>
        </div>
      )}
    </div>
  );
}
