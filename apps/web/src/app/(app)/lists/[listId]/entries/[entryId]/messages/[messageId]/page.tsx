"use client";

// S6 メッセージ生成・編集（ui-spec 6 章 — U7）。
// 生成直後は messageId 未確定のため、[messageId] に特殊値 `new` +
// `?jobId=&templateId=` で生成中モードを受ける（仮置き — message-editor-screen.tsx 参照）。
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { MessageEditorScreen } from "@/features/messages/components/message-editor-screen";

export default function MessagePage() {
  return (
    // useSearchParams はプリレンダー時に Suspense 境界を要求するためラップする
    <Suspense fallback={null}>
      <MessagePageInner />
    </Suspense>
  );
}

function MessagePageInner() {
  const params = useParams<{ listId: string; entryId: string; messageId: string }>();
  const searchParams = useSearchParams();
  return (
    <MessageEditorScreen
      listId={params.listId}
      entryId={params.entryId}
      messageId={params.messageId}
      jobId={searchParams.get("jobId")}
      templateId={searchParams.get("templateId")}
    />
  );
}
