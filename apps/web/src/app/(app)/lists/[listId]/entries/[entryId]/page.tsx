"use client";

// S5 企業詳細（ドシエ + メッセージ — ui-spec 2.3）。
// route はパラメータ解決と feature の合成のみを担う（ui-spec 3.1 — U3）。
// feature 間 import 禁止のため、features/dossier と features/messages の合成は
// この route で行う（右ペインを ReactNode として渡す）。
import { useParams } from "next/navigation";
import { EntryDossierView } from "@/features/dossier/components/entry-dossier-view";
import { MessageListPane } from "@/features/messages/components/message-list-pane";

export default function EntryDetailPage() {
  const params = useParams<{ listId: string; entryId: string }>();
  return (
    <EntryDossierView
      listId={params.listId}
      entryId={params.entryId}
      aside={<MessageListPane listId={params.listId} entryId={params.entryId} />}
    />
  );
}
