import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "ログイン" };

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">ログイン</h1>
      <LoginForm />
    </div>
  );
}
