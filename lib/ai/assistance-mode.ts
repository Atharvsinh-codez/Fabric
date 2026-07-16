import { z } from "zod";

export const AiAssistanceModeSchema = z.enum(["feedback", "suggest", "solve"]);

export type AiAssistanceMode = z.infer<typeof AiAssistanceModeSchema>;

export function resolveAiAssistanceMode(
  mode: AiAssistanceMode | undefined,
): AiAssistanceMode {
  return mode ?? "suggest";
}
