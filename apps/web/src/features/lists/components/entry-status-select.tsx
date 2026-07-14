"use client";

// ステータス列のインライン編集セレクト（要件 F5 — ui-spec 2.3: 手動更新）。
// 変更で即 PATCH /entries/:entryId を呼び、失敗時はトースト + 元の値へ戻す（ui-spec 4.3）。
import { entryStatusSchema, type EntryStatus, type ListEntry } from "@is-reach/shared";
import { useState, type ChangeEvent } from "react";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ENTRY_STATUS_LABELS } from "@/lib/labels/entry-status";
import { updateListEntry } from "../api";
import { describeActionError } from "../error-message";

const STATUS_OPTIONS = entryStatusSchema.options.map((value) => ({
  value,
  label: ENTRY_STATUS_LABELS[value].label,
}));

export interface EntryStatusSelectProps {
  entry: ListEntry;
  /** PATCH 成功時に更新後エントリを親へ反映する */
  onUpdated: (entry: ListEntry) => void;
}

export function EntryStatusSelect({ entry, onUpdated }: EntryStatusSelectProps) {
  const client = getBrowserApiClient();
  const { showToast } = useToast();
  const [pending, setPending] = useState<EntryStatus | null>(null);

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const parsed = entryStatusSchema.safeParse(event.target.value);
    if (!parsed.success || parsed.data === entry.status) return;
    setPending(parsed.data);
    try {
      const updated = await updateListEntry(client, entry.id, { status: parsed.data });
      onUpdated(updated);
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("ステータスの更新に失敗しました", error),
      });
    } finally {
      // 成功時は親の entry prop が更新済み、失敗時は元の値へ戻る
      setPending(null);
    }
  }

  return (
    <Select
      aria-label={`${entry.company.name} のステータス`}
      value={pending ?? entry.status}
      options={STATUS_OPTIONS}
      disabled={pending !== null}
      onChange={(event) => void handleChange(event)}
      className="w-32"
    />
  );
}
