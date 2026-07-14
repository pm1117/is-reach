import { describe, expect, it } from "vitest";
import { meResponseSchema } from "../src/index.js";
import { UUID_A, UUID_B } from "./helpers.js";

function validMe() {
  return {
    user: {
      id: UUID_A,
      email: "user@example.com",
      displayName: "担当者",
      role: "member",
    },
    tenant: { id: UUID_B, name: "テストテナント" },
  };
}

describe("meResponseSchema（GET /api/v1/me の契約）", () => {
  it("正常系を受理する", () => {
    expect(meResponseSchema.parse(validMe())).toEqual(validMe());
  });

  it("displayName は null を許容する", () => {
    const me = validMe();
    me.user.displayName = null as unknown as string;
    expect(meResponseSchema.parse(me).user.displayName).toBeNull();
  });

  it("enum 外ロールを拒否する", () => {
    const me = validMe();
    me.user.role = "owner";
    expect(meResponseSchema.safeParse(me).success).toBe(false);
  });

  it("UUID でない id・メール形式でない email・空のテナント名を拒否する", () => {
    expect(
      meResponseSchema.safeParse({ ...validMe(), user: { ...validMe().user, id: "abc" } }).success,
    ).toBe(false);
    expect(
      meResponseSchema.safeParse({ ...validMe(), user: { ...validMe().user, email: "not-mail" } })
        .success,
    ).toBe(false);
    expect(
      meResponseSchema.safeParse({ ...validMe(), tenant: { id: UUID_B, name: "" } }).success,
    ).toBe(false);
  });

  it("必須フィールド欠落を拒否する", () => {
    const { tenant: _tenant, ...withoutTenant } = validMe();
    expect(meResponseSchema.safeParse(withoutTenant).success).toBe(false);
  });
});
