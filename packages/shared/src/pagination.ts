// ページネーション共通契約（design-detail 2.1: `?limit=&offset=`、limit 既定 50・最大 200）。
import { z } from "zod";

/** クエリ文字列由来のため coerce で数値化する */
export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int({ error: "limit は整数で指定してください" })
    .min(1, { error: "limit は 1 以上で指定してください" })
    .max(200, { error: "limit は最大 200 です" })
    .default(50),
  offset: z.coerce
    .number()
    .int({ error: "offset は整数で指定してください" })
    .min(0, { error: "offset は 0 以上で指定してください" })
    .default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;

/** ページネーションレスポンス `{ items, total }` のスキーマファクトリ */
export function paginatedResponseSchema<TItem extends z.ZodType>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
  });
}

/** ページネーションレスポンスの型（スキーマを介さず型だけ使う場合向け） */
export interface Paginated<T> {
  items: T[];
  total: number;
}
