// S8 で使う enum の日本語ラベル（feature 内限定。他 feature でも必要になったら lib/labels/ へ昇格）
import type { InvitationStatus, Role, TenantStatus } from "@is-reach/shared";
import type { EnumLabel } from "@/lib/labels/types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  member: "メンバー",
};

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, EnumLabel> = {
  invited: { label: "招待中", tone: "warning" },
  active: { label: "有効", tone: "success" },
  disabled: { label: "無効", tone: "neutral" },
};

export const TENANT_STATUS_LABELS: Record<TenantStatus, EnumLabel> = {
  active: { label: "有効", tone: "success" },
  suspended: { label: "停止中", tone: "danger" },
};
