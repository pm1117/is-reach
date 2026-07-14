"use client";

// S8 ユーザー招待モーダル（メールアドレス + ロール選択 → POST /users/invitations）。
// バリデーションは shared の inviteUserRequestSchema に委ねる（E17）。
import { useState, type FormEvent } from "react";
import { inviteUserRequestSchema, roleSchema, type Role } from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { useToast } from "@/components/ui/toast";
import { ApiClientError } from "@/lib/api/client";
import { getBrowserApiClient } from "@/lib/api/browser";
import { inviteUser, mutationErrorMessage } from "../api";
import { ROLE_LABELS } from "../labels";

const ROLE_OPTIONS = roleSchema.options.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  /** 招待成功時（呼び出し元で一覧を reload する） */
  onInvited: () => void;
}

export function InviteUserModal({ open, onClose, onInvited }: InviteUserModalProps) {
  const client = getBrowserApiClient();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setRole("member");
    setEmailError(undefined);
    setSubmitError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = inviteUserRequestSchema.safeParse({ email: email.trim(), role });
    if (!parsed.success) {
      setEmailError("メールアドレス形式で入力してください");
      return;
    }
    setEmailError(undefined);
    setSubmitError(null);
    setSubmitting(true);
    try {
      await inviteUser(client, parsed.data);
      showToast({ tone: "success", message: "招待メールを送信しました" });
      reset();
      onInvited();
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "RESOURCE_CONFLICT") {
        setSubmitError("このメールアドレスは既に登録されています");
      } else {
        setSubmitError(mutationErrorMessage(error, "招待の送信に失敗しました"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="ユーザーを招待">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError !== null ? (
          <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
            {submitError}
          </p>
        ) : null}
        <TextInput
          label="メールアドレス"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
        />
        <Select
          label="ロール"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(event) => {
            const parsed = roleSchema.safeParse(event.target.value);
            if (parsed.success) setRole(parsed.data);
          }}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={handleClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            招待を送信
          </Button>
        </div>
      </form>
    </Modal>
  );
}
