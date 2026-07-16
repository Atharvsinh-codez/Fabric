ALTER TABLE "ai_runs" DROP CONSTRAINT "ai_runs_model_check";--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_model_check" CHECK ("ai_runs"."model" in ('gemini-3.5-flash', 'gemini-2.5-flash'));
