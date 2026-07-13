// 深掘りジョブ API 契約（design-detail 2.3 — 要件 F2 / 決定 E9）。
import { z } from "zod";
import { jobErrorSchema } from "./api-error.js";
import { httpUrlSchema, isoDateTimeSchema, uuidSchema } from "./common.js";
import { deepDiveJobStateSchema, fetchErrorKindSchema } from "./enums.js";

/** 選択エントリ（複数可）の深掘りジョブ投入 */
export const createDeepDiveJobsRequestSchema = z.object({
  entryIds: z.array(uuidSchema).min(1, { error: "エントリを 1 件以上指定してください" }),
});
export type CreateDeepDiveJobsRequest = z.infer<typeof createDeepDiveJobsRequestSchema>;

export const deepDiveJobSchema = z
  .object({
    id: uuidSchema,
    listEntryId: uuidSchema,
    state: deepDiveJobStateSchema,
    progress: z.object({
      fetchedPages: z.number().int().min(0),
      plannedPages: z.number().int().min(0).nullable(),
    }),
    /** 部分失敗の記録（design-detail 4.1: 部分失敗を許容し analyzing へ進む） */
    partialFailures: z.array(
      z.object({
        url: httpUrlSchema,
        reason: fetchErrorKindSchema,
      }),
    ),
    /** failed 時のみ設定（superRefine で相関を強制） */
    error: jobErrorSchema.nullable(),
    attempts: z.number().int().min(0),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((job, ctx) => {
    // design-detail 2.3: error は「failed 時のみ」
    if (job.state === "failed" && job.error === null) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "state が failed の場合は error が必須です",
      });
    }
    if (job.state !== "failed" && job.error !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "error を設定できるのは state が failed の場合のみです",
      });
    }
  });
export type DeepDiveJob = z.infer<typeof deepDiveJobSchema>;

/** 202 Accepted のレスポンス */
export const createDeepDiveJobsResponseSchema = z.object({
  jobs: z.array(deepDiveJobSchema),
});
export type CreateDeepDiveJobsResponse = z.infer<typeof createDeepDiveJobsResponseSchema>;
