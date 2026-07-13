// 注入検知パターン集（design-detail 3.5 V5 ② / ③ — 検知パターンは本パッケージ内で管理し
// 随時更新する。配列に追記するだけで拡張できる構造にする）。
//
// V5 ②: 入力データブロック内に存在した命令調フレーズが出力へ反映されたことの検知に使う。
// パターンはサニタイズ済み（エスケープ済み）テキストと LLM 出力の両方に対して照合する
// （対象フレーズは < > & を含まないためエスケープの影響を受けない）。

export interface InjectionPattern {
  /** 警告 detail に使う識別子 */
  id: string;
  pattern: RegExp;
}

/** 命令調フレーズの検知パターン（初期セット — 人間レビューで随時追加する） */
export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: "ignore-previous-instructions-ja",
    pattern:
      /(これまで|以前|上記|前述|今まで)の(指示|命令|プロンプト|ルール|制約)を(すべて|全て)?(無視|忘れ|破棄)/,
  },
  {
    id: "ignore-previous-instructions-en",
    pattern:
      /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  },
  {
    id: "disregard-instructions-en",
    pattern:
      /disregard\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  },
  {
    id: "forget-instructions-en",
    pattern:
      /forget\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  },
  {
    id: "output-directive-ja",
    pattern: /と(だけ|のみ)?(出力|回答|返答|返信|応答)(せよ|しろ|すること|してください|して下さい)/,
  },
  {
    id: "follow-new-instructions-ja",
    pattern: /(新しい|次の|以下の)(指示|命令)に(従え|従って|従うこと)/,
  },
  {
    id: "role-override-ja",
    pattern: /あなたは(今|いま)から/,
  },
  {
    id: "role-override-en",
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
  },
  {
    id: "system-prompt-probe",
    pattern:
      /(システム\s*プロンプト|system\s*prompt)を?(表示|開示|出力|漏え|漏洩|reveal|show|print)/i,
  },
  {
    id: "jailbreak-marker-en",
    pattern: /\b(DAN\s+mode|developer\s+mode\s+enabled|jailbreak)\b/i,
  },
];

/** text に一致した命令調パターンの一覧を返す */
export function findInjectionPatterns(text: string): InjectionPattern[] {
  return INJECTION_PATTERNS.filter((entry) => entry.pattern.test(text));
}

/**
 * V5 ③ 無関係トピック混入のキーワード照合ヒューリスティックに使う語彙（初期セット）。
 * B2B の一次接触文面・企業調書に現れるべきでない、詐取・誘導系のトピックを列挙する。
 * 信頼済みコンテキスト（企業属性・自社サービス概要・テンプレート）に同じ語が含まれる場合は
 * 誤検知としてスキップする（→ validate.ts）。人間レビューで随時追加する。
 */
export const OFF_TOPIC_KEYWORDS: readonly string[] = [
  "ギフトカード",
  "ギフト券",
  "プリペイドカード",
  "商品券",
  "暗号資産",
  "仮想通貨",
  "ビットコイン",
  "当選",
  "宝くじ",
  "懸賞",
  "パスワード",
  "ワンタイムコード",
  "認証コード",
  "口座番号",
  "暗証番号",
  "クレジットカード番号",
  "振り込み",
  "振込先",
  "送金",
  "gift card",
  "bitcoin",
  "cryptocurrency",
  "lottery",
  "password",
  "wire transfer",
];
