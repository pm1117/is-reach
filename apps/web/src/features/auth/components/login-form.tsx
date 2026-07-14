"use client";

// S0 ログイン（ui-spec 2.2 — メール + パスワード。Supabase Auth）
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error !== null) {
        // 認証エラーの詳細（存在有無等）は出さない。生メッセージも表示しない（ui-spec 4.3）
        setErrorMessage("メールアドレスまたはパスワードが正しくありません");
        return;
      }
      router.replace("/dashboard");
    } catch {
      setErrorMessage("ログインに失敗しました。時間をおいて再試行してください");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {errorMessage !== null ? (
        <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
          {errorMessage}
        </p>
      ) : null}
      <TextInput
        label="メールアドレス"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextInput
        label="パスワード"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        ログイン
      </Button>
    </form>
  );
}
