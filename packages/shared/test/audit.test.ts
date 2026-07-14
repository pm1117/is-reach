import { describe, expect, it } from "vitest";
import { auditEventTypeSchema } from "../src/index.js";

// design-detail 7.1 のイベント網羅リスト（DB の audit_logs_event_type_check と同一集合）
const EXPECTED_EVENT_TYPES = [
  "user.login",
  "user.invited",
  "user.role_changed",
  "user.removed",
  "tenant.settings_updated",
  "screening.searched",
  "list.created",
  "list.updated",
  "list.deleted",
  "entry.status_changed",
  "entry.assignee_changed",
  "deep_dive.started",
  "deep_dive.retried",
  "dossier.viewed",
  "message.generated",
  "message.edited",
  "message.copied",
  "template.created",
  "template.updated",
  "template.deleted",
  "pii.deleted",
  "audit_log.viewed",
] as const;

describe("auditEventTypeSchema（design-detail 7.1 — E16）", () => {
  it("7.1 の全 event_type を網羅している", () => {
    expect([...auditEventTypeSchema.options].sort()).toEqual([...EXPECTED_EVENT_TYPES].sort());
  });

  it.each(EXPECTED_EVENT_TYPES)("%s を受理する", (value) => {
    expect(auditEventTypeSchema.parse(value)).toBe(value);
  });

  it("未定義のイベント種別を拒否する", () => {
    expect(auditEventTypeSchema.safeParse("user.deleted").success).toBe(false);
    expect(auditEventTypeSchema.safeParse("").success).toBe(false);
  });
});
