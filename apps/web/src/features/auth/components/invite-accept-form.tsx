"use client";

// S0 招待受諾（ui-spec 2.2）: 招待メールのリンク（token_hash）から表示名・パスワードを設定する。
// Supabase Auth の招待フロー: verifyOtp(type: "invite") でセッション確立 → updateUser で
// パスワードと表示名を設定する。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

/** パスワード最小長（仮置き。Supabase Auth 側のポリシーと合わせて調整する） */
const MIN_PASSWORD_LENGTH = 8;

export interface InviteAcceptFormProps {
  /** 招待リンクの token_hash（URL パス /invite/[token] から渡される） */
  tokenHash: string;
}

interface FieldErrors {
  displayName?: string;
  password?: string;
  passwordConfirm?: string;
}

export function InviteAcceptForm({ tokenHash }: InviteAcceptFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (displayName.trim() === "") {
      errors.displayName = "表示名を入力してください";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上で設定してください`;
    }
    if (passwordConfirm !== password) {
      errors.passwordConfirm = "パスワード（確認）が一致しません";
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "invite",
        token_hash: tokenHash,
      });
      if (verifyError !== null) {
        setErrorMessage("招待リンクが無効か期限切れです。管理者に再招待を依頼してください");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { display_name: displayName.trim() },
      });
      if (updateError !== null) {
        setErrorMessage("アカウント設定に失敗しました。時間をおいて再試行してください");
        return;
      }
      router.replace("/dashboard");
    } catch {
      setErrorMessage("アカウント設定に失敗しました。時間をおいて再試行してください");
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
        label="表示名"
        autoComplete="nickname"
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        error={fieldErrors.displayName}
      />
      <TextInput
        label="パスワード"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />
      <TextInput
        label="パスワード（確認）"
        type="password"
        autoComplete="new-password"
        required
        value={passwordConfirm}
        onChange={(event) => setPasswordConfirm(event.target.value)}
        error={fieldErrors.passwordConfirm}
      />
      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        アカウントを設定してはじめる
      </Button>
    </form>
  );
}
