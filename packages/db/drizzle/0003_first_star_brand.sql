CREATE TYPE "public"."triage_classification" AS ENUM('timing_lag', 'amount_mismatch', 'missing_counterpart', 'duplicate', 'fx_rounding', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."triage_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "triage_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"break_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"classification" "triage_classification" NOT NULL,
	"confidence" "triage_confidence" NOT NULL,
	"explanation" text NOT NULL,
	"suggested_action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_suggestions" ADD CONSTRAINT "triage_suggestions_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_suggestions" ADD CONSTRAINT "triage_suggestions_break_id_breaks_id_fk" FOREIGN KEY ("break_id") REFERENCES "public"."breaks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "triage_suggestions_input_hash_uq" ON "triage_suggestions" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "triage_suggestions_exception_idx" ON "triage_suggestions" USING btree ("exception_id","created_at");