ALTER TABLE "ai_runs" DROP CONSTRAINT "ai_runs_provider_check";--> statement-breakpoint
ALTER TABLE "ai_runs" DROP CONSTRAINT "ai_runs_model_check";--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_provider_check" CHECK ("ai_runs"."provider" in ('google-gemini', 'openai-compatible'));--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_model_check" CHECK (("ai_runs"."provider" = 'google-gemini' and "ai_runs"."model" in ('gemini-3.5-flash', 'gemini-2.5-flash')) or ("ai_runs"."provider" = 'openai-compatible' and char_length("ai_runs"."model") between 1 and 255 and "ai_runs"."model" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'));