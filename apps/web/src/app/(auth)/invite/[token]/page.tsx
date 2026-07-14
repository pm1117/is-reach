import type { Metadata } from "next";
import { InviteAcceptForm } from "@/features/auth/components/invite-accept-form";

export const metadata: Metadata = { title: "招待の受諾" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">アカウントの設定</h1>
      <p className="mb-4 text-xs text-neutral-500">
        招待を受諾し、表示名とパスワードを設定してください
      </p>
      <InviteAcceptForm tokenHash={token} />
    </div>
  );
}
