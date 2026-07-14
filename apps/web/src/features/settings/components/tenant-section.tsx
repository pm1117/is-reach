"use client";

// S8 テナント設定（GET /tenant → 編集フォーム → PATCH /tenant）。
// serviceSummary はドシエ分析・メッセージ生成の信頼済みパラメータ（design-detail 3.4）。
import { useCallback, useState, type FormEvent } from "react";
import { updateTenantRequestSchema, type TenantSettings } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TextInput } from "@/components/ui/text-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { fetchTenant, mutationErrorMessage, updateTenant } from "../api";
import { TENANT_STATUS_LABELS } from "../labels";

function TenantForm({ initial, onSaved }: { initial: TenantSettings; onSaved: () => void }) {
  const client = getBrowserApiClient();
  const { showToast } = useToast();
  const [name, setName] = useState(initial.name);
  const [serviceSummary, setServiceSummary] = useState(initial.serviceSummary);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateTenantRequestSchema.safeParse({
      name: name.trim(),
      serviceSummary,
    });
    if (!parsed.success) {
      setNameError("テナント名を入力してください");
      return;
    }
    setNameError(undefined);
    setSaving(true);
    try {
      await updateTenant(client, parsed.data);
      showToast({ tone: "success", message: "テナント設定を保存しました" });
      onSaved();
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "テナント設定の保存に失敗しました"),
      });
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = TENANT_STATUS_LABELS[initial.status];
  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4" noValidate>
      <div className="flex items-center gap-2 text-sm text-neutral-700">
        <span>契約状態:</span>
        <Badge tone={statusLabel.tone}>{statusLabel.label}</Badge>
      </div>
      <TextInput
        label="テナント名"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={nameError}
      />
      <Textarea
        label="自社サービス概要（ドシエ分析・メッセージ生成で参照されます）"
        rows={6}
        placeholder="例: 中堅企業向けの営業支援 SaaS を提供しています…"
        value={serviceSummary}
        onChange={(event) => setServiceSummary(event.target.value)}
      />
      {serviceSummary.trim() === "" ? (
        <p className="text-xs text-warning-hover">
          自社サービス概要が未設定です。設定するとドシエ・メッセージの品質が向上します
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={saving}>
        保存する
      </Button>
    </form>
  );
}

export function TenantSection() {
  const client = getBrowserApiClient();
  const tenantQuery = useApiQuery(
    useCallback((signal: AbortSignal) => fetchTenant(client, signal), [client]),
  );

  return (
    <section aria-label="テナント設定">
      <h2 className="mb-3 text-lg font-semibold text-neutral-900">テナント設定</h2>
      {tenantQuery.state.status === "loading" ? (
        <div role="status" aria-label="読み込んでいます" className="max-w-2xl space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {tenantQuery.state.status === "error" ? (
        <ErrorState requestId={tenantQuery.state.requestId} onRetry={tenantQuery.reload} />
      ) : null}
      {tenantQuery.state.status === "ready" ? (
        <TenantForm
          key={tenantQuery.state.data.id}
          initial={tenantQuery.state.data}
          onSaved={tenantQuery.reload}
        />
      ) : null}
    </section>
  );
}
