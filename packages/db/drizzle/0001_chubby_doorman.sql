CREATE TYPE "public"."exception_event_kind" AS ENUM('opened', 'acknowledged', 'resolved', 'reopened', 'self_resolved');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."outbox_topic" AS ENUM('transaction.superseded', 'transaction.tombstoned');--> statement-breakpoint
ALTER TYPE "public"."batch_status" ADD VALUE 'quarantined';--> statement-breakpoint
ALTER TYPE "public"."batch_status" ADD VALUE 'halted';--> statement-breakpoint
ALTER TYPE "public"."break_type" ADD VALUE 'missing_in_source' BEFORE 'amount_mismatch';--> statement-breakpoint
ALTER TYPE "public"."break_type" ADD VALUE 'unexpected_fee';--> statement-breakpoint
ALTER TYPE "public"."break_type" ADD VALUE 'fx_drift';--> statement-breakpoint
ALTER TYPE "public"."match_kind" ADD VALUE 'grouped_reference';--> statement-breakpoint
ALTER TYPE "public"."quarantine_stage" ADD VALUE 'batch';--> statement-breakpoint
CREATE TABLE "exception_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"kind" "exception_event_kind" NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"type" "break_type" NOT NULL,
	"status" "exception_status" NOT NULL,
	"first_seen_run_id" uuid NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"current_break_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" text NOT NULL,
	"rate_source" text NOT NULL,
	"rate_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" "outbox_topic" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "breaks" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "archive_url" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "is_tombstone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_tombstone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "net_minor" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "group_ref" text;--> statement-breakpoint
ALTER TABLE "exception_events" ADD CONSTRAINT "exception_events_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_events" ADD CONSTRAINT "exception_events_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_first_seen_run_id_recon_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_last_seen_run_id_recon_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_current_break_id_breaks_id_fk" FOREIGN KEY ("current_break_id") REFERENCES "public"."breaks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_processed_by_run_id_recon_runs_id_fk" FOREIGN KEY ("processed_by_run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_events_exception_idx" ON "exception_events" USING btree ("exception_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exceptions_fingerprint_uq" ON "exceptions" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "exceptions_status_idx" ON "exceptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_pair_date_source_uq" ON "fx_rates" USING btree ("base","quote","rate_date","rate_source");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("created_at") WHERE "outbox"."processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "breaks_run_fingerprint_uq" ON "breaks" USING btree ("run_id","fingerprint") WHERE "breaks"."fingerprint" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ingestion_batches_unit_key_idx" ON "ingestion_batches" USING btree ("source","unit_key");--> statement-breakpoint
CREATE INDEX "transactions_group_ref_idx" ON "transactions" USING btree ("source","group_ref");