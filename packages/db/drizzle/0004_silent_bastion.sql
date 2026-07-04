CREATE TYPE "public"."investigation_event_kind" AS ENUM('created', 'edited', 'retried', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."investigation_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "investigation_message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" "investigation_event_kind" NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "investigation_message_role" NOT NULL,
	"author_name" text NOT NULL,
	"text" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"usage" jsonb,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investigation_message_events" ADD CONSTRAINT "investigation_message_events_message_id_investigation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."investigation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_messages" ADD CONSTRAINT "investigation_messages_thread_id_investigation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."investigation_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_messages" ADD CONSTRAINT "investigation_messages_supersedes_id_investigation_messages_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."investigation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_threads" ADD CONSTRAINT "investigation_threads_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_message_events_message_idx" ON "investigation_message_events" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "investigation_messages_thread_idx" ON "investigation_messages" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "investigation_messages_role_created_idx" ON "investigation_messages" USING btree ("role","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_threads_exception_uq" ON "investigation_threads" USING btree ("exception_id");