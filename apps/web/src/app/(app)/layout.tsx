import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { MeProvider } from "@/lib/auth/me-context";

// 認証済みレイアウト。未認証アクセスは middleware が /login へリダイレクトする
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </MeProvider>
  );
}
