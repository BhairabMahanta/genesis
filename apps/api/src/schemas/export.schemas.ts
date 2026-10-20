import { z } from "zod";

export const exportOptionsSchema = z.object({
  format: z.enum(["CONLL", "ZIP"]).nullish(),
  includeMetadata: z.boolean().nullish(),
  // Frontend export dialog shape (workspace export contracts).
  column2Mode: z.enum(["PART_NUMBER", "SENTENCE_NUMBER"]).nullish(),
  exportFormat: z
    .enum(["MERGED_SINGLE_FILE", "SEPARATE_FILES_ZIP", "SEPARATE_FILES_ZIP_WITH_MERGED"])
    .nullish(),
  continueSentenceNumbers: z.boolean().nullish(),
  defaultPartNumber: z.number().int().nullish(),
});

export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export const dismissRecommendationSchema = z.object({
  hash: z.string().min(1),
  accepted: z.boolean(),
});

export type DismissRecommendationInput = z.infer<typeof dismissRecommendationSchema>;
