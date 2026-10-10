CREATE TYPE "public"."approval_kind" AS ENUM('RELEASE_FULL_PACKAGE', 'REQUEST_SAMPLE', 'PAY_DEPOSIT', 'PLACE_PURCHASE_ORDER', 'ACCEPT_MATERIAL_SUBSTITUTION', 'ACCEPT_TOLERANCE_CHANGE', 'APPROVE_TOOLING', 'START_PRODUCTION', 'CHANGE_COMPLIANCE', 'SELECT_SUPPLIER_OFFER');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approver_role" AS ENUM('ops', 'customer');--> statement-breakpoint
CREATE TYPE "public"."bg_edge_type" AS ENUM('CONTAINS', 'MADE_OF', 'REQUIRES_PROCESS', 'FINISHED_WITH', 'CONSTRAINED_BY', 'BLOCKED_BY', 'SOURCED_FROM', 'MANUFACTURED_BY', 'QUOTED_AS', 'ORDERED_AS', 'INSPECTED_BY', 'SHIPPED_AS', 'DERIVED_FROM');--> statement-breakpoint
CREATE TYPE "public"."bg_node_type" AS ENUM('BUILD', 'REQUIREMENT', 'UNKNOWN', 'ASSEMBLY', 'PART', 'MATERIAL', 'PROCESS', 'FINISH', 'SUPPLIER', 'SHOP', 'QUOTE', 'ORDER', 'QA', 'SHIPMENT', 'PASSPORT');--> statement-breakpoint
CREATE TYPE "public"."bg_source" AS ENUM('user', 'make_ai', 'quote_engine', 'sourcing_agent', 'ops', 'system');--> statement-breakpoint
CREATE TYPE "public"."build_origin" AS ENUM('upload', 'make_ai', 'remix', 'clone');--> statement-breakpoint
CREATE TYPE "public"."design_version_status" AS ENUM('DRAFT', 'APPROVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."incoterm" AS ENUM('EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');--> statement-breakpoint
CREATE TYPE "public"."negotiation_status" AS ENUM('contacted', 'rfq-sent', 'awaiting-reply', 'negotiating', 'supplier-estimate', 'supplier-confirmed', 'declined', 'no-response');--> statement-breakpoint
CREATE TYPE "public"."package_tier" AS ENUM('REDACTED', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."sourcing_channel" AS ENUM('accio', 'desk');--> statement-breakpoint
CREATE TYPE "public"."sourcing_document_kind" AS ENUM('QUOTE', 'DRAWING', 'CERTIFICATE', 'SAMPLE_PHOTO', 'INVOICE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sourcing_job_status" AS ENUM('QUEUED', 'LEASED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."supplier_offer_status" AS ENUM('ACTIVE', 'STALE', 'WITHDRAWN', 'SELECTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"build_id" text NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"approver_role" "approver_role" NOT NULL,
	"requested_by" text NOT NULL,
	"supplier_id" text,
	"supplier_offer_id" text,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"design_version" integer NOT NULL,
	"type" "bg_edge_type" NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bg_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"design_version" integer NOT NULL,
	"key" text NOT NULL,
	"type" "bg_node_type" NOT NULL,
	"label" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision,
	"source" "bg_source" NOT NULL,
	"provenance" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bg_nodes_confidence_ck" CHECK ("bg_nodes"."confidence" is null or ("bg_nodes"."confidence" >= 0 and "bg_nodes"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "design_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "design_version_status" DEFAULT 'DRAFT' NOT NULL,
	"summary" text NOT NULL,
	"parent_version" integer,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "make_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"intent" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_sha256" text NOT NULL,
	"prompt_chars" integer NOT NULL,
	"build_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"client_id" text,
	"supplier_id" text,
	"tier" "package_tier" NOT NULL,
	"file_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"supplier_id" text,
	"kind" "sourcing_document_kind" NOT NULL,
	"file_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"build_id" text NOT NULL,
	"part_id" text,
	"design_version" integer NOT NULL,
	"request" jsonb NOT NULL,
	"approval_policy" jsonb NOT NULL,
	"status" "sourcing_job_status" DEFAULT 'QUEUED' NOT NULL,
	"channel" "sourcing_channel" DEFAULT 'accio' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"lease_id" uuid,
	"leased_by_client_id" text,
	"lease_expires_at" timestamp with time zone,
	"lease_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"outcome" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sourcing_negotiations" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" "negotiation_status" NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"tool" text NOT NULL,
	"job_id" text,
	"ok" boolean NOT NULL,
	"error_code" text,
	"args_sha256" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"job_id" text,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"build_id" text NOT NULL,
	"design_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tooling_cents" integer DEFAULT 0 NOT NULL,
	"sample_cost_cents" integer,
	"shipping_cents" integer,
	"moq" integer NOT NULL,
	"production_lead_days" integer NOT NULL,
	"shipping_lead_days" integer NOT NULL,
	"incoterm" "incoterm" NOT NULL,
	"material" text NOT NULL,
	"processes" jsonb NOT NULL,
	"certifications_claimed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"negotiation_status" "negotiation_status" NOT NULL,
	"trust_level" "trust_level" NOT NULL,
	"status" "supplier_offer_status" DEFAULT 'ACTIVE' NOT NULL,
	"valid_until" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_offers_confidence_ck" CHECK ("supplier_offers"."confidence" >= 0 and "supplier_offers"."confidence" <= 1),
	CONSTRAINT "supplier_offers_trust_ck" CHECK ("supplier_offers"."trust_level" in ('SUPPLIER_ESTIMATE', 'SUPPLIER_CONFIRMED'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"platform_ref" text,
	"country" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"profile_url" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "origin" "build_origin" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "derived_from_build_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_supplier_offer_id_supplier_offers_id_fk" FOREIGN KEY ("supplier_offer_id") REFERENCES "public"."supplier_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg_edges" ADD CONSTRAINT "bg_edges_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bg_nodes" ADD CONSTRAINT "bg_nodes_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "make_intents" ADD CONSTRAINT "make_intents_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_access_log" ADD CONSTRAINT "sourcing_access_log_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_access_log" ADD CONSTRAINT "sourcing_access_log_client_id_sourcing_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sourcing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_access_log" ADD CONSTRAINT "sourcing_access_log_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_documents" ADD CONSTRAINT "sourcing_documents_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_documents" ADD CONSTRAINT "sourcing_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_jobs" ADD CONSTRAINT "sourcing_jobs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_jobs" ADD CONSTRAINT "sourcing_jobs_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_jobs" ADD CONSTRAINT "sourcing_jobs_leased_by_client_id_sourcing_clients_id_fk" FOREIGN KEY ("leased_by_client_id") REFERENCES "public"."sourcing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_negotiations" ADD CONSTRAINT "sourcing_negotiations_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_negotiations" ADD CONSTRAINT "sourcing_negotiations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_tool_calls" ADD CONSTRAINT "sourcing_tool_calls_client_id_sourcing_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sourcing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_evidence" ADD CONSTRAINT "supplier_evidence_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_evidence" ADD CONSTRAINT "supplier_evidence_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_job_id_sourcing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sourcing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("approver_role","created_at") WHERE "approvals"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "approvals_job_idx" ON "approvals" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "approvals_build_idx" ON "approvals" USING btree ("build_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bg_edges_version_uq" ON "bg_edges" USING btree ("build_id","design_version","type","from_key","to_key");--> statement-breakpoint
CREATE INDEX "bg_edges_from_idx" ON "bg_edges" USING btree ("build_id","design_version","from_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bg_nodes_version_key_uq" ON "bg_nodes" USING btree ("build_id","design_version","key");--> statement-breakpoint
CREATE INDEX "bg_nodes_build_type_idx" ON "bg_nodes" USING btree ("build_id","type");--> statement-breakpoint
CREATE INDEX "bg_nodes_data_gin" ON "bg_nodes" USING gin ("data");--> statement-breakpoint
CREATE UNIQUE INDEX "design_versions_build_version_uq" ON "design_versions" USING btree ("build_id","version");--> statement-breakpoint
CREATE INDEX "make_intents_build_idx" ON "make_intents" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "sourcing_access_log_job_idx" ON "sourcing_access_log" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_clients_token_hash_uq" ON "sourcing_clients" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sourcing_documents_job_idx" ON "sourcing_documents" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_jobs_display_id_uq" ON "sourcing_jobs" USING btree ("display_id");--> statement-breakpoint
CREATE INDEX "sourcing_jobs_queue_idx" ON "sourcing_jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "sourcing_jobs_build_idx" ON "sourcing_jobs" USING btree ("build_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_negotiations_job_supplier_uq" ON "sourcing_negotiations" USING btree ("job_id","supplier_id");--> statement-breakpoint
CREATE INDEX "sourcing_tool_calls_client_idx" ON "sourcing_tool_calls" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_evidence_supplier_idx" ON "supplier_evidence" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_offers_idempotency_uq" ON "supplier_offers" USING btree ("job_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "supplier_offers_build_idx" ON "supplier_offers" USING btree ("build_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_platform_ref_uq" ON "suppliers" USING btree ("platform","platform_ref") WHERE "suppliers"."platform_ref" is not null;--> statement-breakpoint
CREATE INDEX "builds_derived_from_idx" ON "builds" USING btree ("derived_from_build_id");