import { z } from "zod";

import { BoardDocumentSchema } from "../boards/contracts";

export const CompleteOnboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  workspaceName: z.string().trim().min(1).max(120),
  boardTitle: z.string().trim().min(1).max(160),
  document: BoardDocumentSchema,
});

export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingSchema>;
