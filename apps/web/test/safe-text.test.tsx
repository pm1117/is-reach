// SafeText（ui-spec 7 章 — U8）: HTML 非解釈・改行反映・行数制限 + 展開
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SafeText } from "@/components/ui/safe-text";

describe("SafeText", () => {
  it("HTML タグを解釈せずリテラル文字列として表示する（要素を注入させない）", () => {
    const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>&amp;';
    const { container } = render(<SafeText text={malicious} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // 「&amp;」もエンティティ解決されずそのまま表示される（textContent がリテラル一致）
    expect(container.textContent).toContain(malicious);
  });

  it("改行を whitespace-pre-wrap で反映する（<br> 等の HTML には変換しない）", () => {
    const { container } = render(<SafeText text={"1 行目\n2 行目"} />);
    const textElement = container.querySelector(".whitespace-pre-wrap");
    expect(textElement).not.toBeNull();
    expect(textElement?.textContent).toBe("1 行目\n2 行目");
    expect(container.querySelector("br")).toBeNull();
  });

  it("既定 6 行以下のテキストには展開ボタンを出さない", () => {
    render(<SafeText text={"短いテキスト\n2 行目"} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("行数超過時は「すべて表示」で展開・「折りたたむ」で戻せる", async () => {
    const user = userEvent.setup();
    const longText = Array.from({ length: 10 }, (_, i) => `行 ${i + 1}`).join("\n");
    const { container } = render(<SafeText text={longText} />);

    const textElement = container.querySelector(".whitespace-pre-wrap");
    expect(textElement).toHaveStyle({ overflow: "hidden" });

    await user.click(screen.getByRole("button", { name: "すべて表示" }));
    expect(container.querySelector(".whitespace-pre-wrap")).not.toHaveStyle({
      overflow: "hidden",
    });

    await user.click(screen.getByRole("button", { name: "折りたたむ" }));
    expect(container.querySelector(".whitespace-pre-wrap")).toHaveStyle({ overflow: "hidden" });
  });

  it("maxLines 指定で折りたたみ閾値を変えられる", () => {
    render(<SafeText text={"1\n2\n3"} maxLines={2} />);
    expect(screen.getByRole("button", { name: "すべて表示" })).toBeInTheDocument();
  });

  it("改行がなくても長文（折り返し概算超過）は折りたたみ対象になる", () => {
    render(<SafeText text={"あ".repeat(1000)} />);
    expect(screen.getByRole("button", { name: "すべて表示" })).toBeInTheDocument();
  });
});
