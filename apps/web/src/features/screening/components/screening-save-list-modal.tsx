"use client";

// リスト名入力モーダル（ui-spec 2.3: 「リストとして保存」→ リスト名入力 → CompanyList 作成）。
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextInput } from "@/components/ui/text-input";

export interface ScreeningSaveListModalProps {
  open: boolean;
  /** 保存対象の企業数（採用チェック済み） */
  companyCount: number;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function ScreeningSaveListModal({
  open,
  companyCount,
  saving,
  onClose,
  onSave,
}: ScreeningSaveListModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  // 開くたびに入力をリセットする
  useEffect(() => {
    if (open) {
      setName("");
      setError(undefined);
    }
  }, [open]);

  function handleSave() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("リスト名を入力してください");
      return;
    }
    setError(undefined);
    onSave(trimmed);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="リストとして保存"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            保存する
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-neutral-600">
        選択した {companyCount} 社を検索条件のスナップショットとともに保存します。
      </p>
      <TextInput
        label="リスト名"
        placeholder="例: 2026-07 SaaS 採用強化企業"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={error}
        disabled={saving}
      />
    </Modal>
  );
}
