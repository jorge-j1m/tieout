CREATE TYPE "public"."batch_kind" AS ENUM('api', 'file', 'seed');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('landed', 'normalized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."break_type" AS ENUM('missing_in_ledger', 'missing_in_stripe', 'amount_mismatch', 'duplicate_candidate');--> statement-breakpoint
CREATE TYPE "public"."canonical_txn_type" AS ENUM('payment', 'refund', 'payout', 'fee', 'transfer', 'reversal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."match_kind" AS ENUM('exact_reference', 'amount_date_window');--> statement-breakpoint
CREATE TYPE "public"."quarantine_stage" AS ENUM('land', 'normalize');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('pending', 'settled', 'failed', 'reversed');--> statement-breakpoint
CREATE TABLE "breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" "break_type" NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"connection" text NOT NULL,
	"kind" "batch_kind" NOT NULL,
	"external_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"control_totals" jsonb,
	"status" "batch_status" DEFAULT 'landed' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"transaction_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"kind" "match_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantined_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"raw_id" uuid,
	"stage" "quarantine_stage" NOT NULL,
	"source" text NOT NULL,
	"source_account" text,
	"source_id" text,
	"normalizer_version" text,
	"errors" jsonb NOT NULL,
	"payload" jsonb,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_account" text NOT NULL,
	"source_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ruleset_version" text NOT NULL,
	"status" "run_status" NOT NULL,
	"stats" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source" text NOT NULL,
	"source_account" text NOT NULL,
	"watermark" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_cursors_source_source_account_pk" PRIMARY KEY("source","source_account")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean NOT NULL,
	"superseded_at" timestamp with time zone,
	"source" text NOT NULL,
	"source_account" text NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"type" "canonical_txn_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"value_date" date,
	"observed_at" timestamp with time zone NOT NULL,
	"account" text NOT NULL,
	"reference" text,
	"status" "txn_status" NOT NULL,
	"normalizer_version" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_records" ADD CONSTRAINT "quarantined_records_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_records" ADD CONSTRAINT "quarantined_records_raw_id_raw_records_id_fk" FOREIGN KEY ("raw_id") REFERENCES "public"."raw_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_raw_id_raw_records_id_fk" FOREIGN KEY ("raw_id") REFERENCES "public"."raw_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breaks_run_type_idx" ON "breaks" USING btree ("run_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_batches_idempotency_key_uq" ON "ingestion_batches" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ingestion_batches_source_observed_idx" ON "ingestion_batches" USING btree ("source","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_members_run_txn_uq" ON "match_members" USING btree ("run_id","transaction_id");--> statement-breakpoint
CREATE INDEX "match_members_match_idx" ON "match_members" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "matches_run_idx" ON "matches" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quarantined_raw_normalizer_uq" ON "quarantined_records" USING btree ("raw_id","normalizer_version") WHERE "quarantined_records"."raw_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quarantined_batch_idx" ON "quarantined_records" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_records_identity_version_uq" ON "raw_records" USING btree ("source","source_account","source_id","version");--> statement-breakpoint
CREATE INDEX "raw_records_batch_idx" ON "raw_records" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_current_identity_uq" ON "transactions" USING btree ("source","source_account","source_id") WHERE "transactions"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_raw_normalizer_uq" ON "transactions" USING btree ("raw_id","normalizer_version");--> statement-breakpoint
CREATE INDEX "transactions_currency_account_occurred_idx" ON "transactions" USING btree ("currency","account","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_reference_idx" ON "transactions" USING btree ("reference");