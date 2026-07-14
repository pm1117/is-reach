import type { ReactNode } from "react";
import type { MeResponse, Role } from "@is-reach/shared";
import { MeStateProvider, type MeState } from "@/lib/auth/me-context";

export const UUID_USER = "3f8e9d2a-6b4c-4d5e-9f1a-2b3c4d5e6f70";
export const UUID_TENANT = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

export function makeMe(role: Role): MeResponse {
  return {
    user: {
      id: UUID_USER,
      email: "user@example.com",
      displayName: "テスト担当者",
      role,
    },
    tenant: { id: UUID_TENANT, name: "テストテナント" },
  };
}

export function withMeState({
  state,
  children,
  reload = () => undefined,
}: {
  state: MeState;
  children: ReactNode;
  reload?: () => void;
}) {
  return <MeStateProvider value={{ state, reload }}>{children}</MeStateProvider>;
}
