import { redirect } from "next/navigation";

// ルートは認証済みレイアウトの起点（ダッシュボード）へ委譲する。
// 未認証の場合は middleware が /login へリダイレクトする。
export default function RootPage(): never {
  redirect("/dashboard");
}
