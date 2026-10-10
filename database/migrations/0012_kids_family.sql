ALTER TYPE "public"."build_origin" ADD VALUE 'kids';--> statement-breakpoint
CREATE TABLE "families" (
	"user_id" text PRIMARY KEY NOT NULL,
	"pin_hash" text,
	"pin_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kid_id" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kid_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"kid_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"template" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"cad" jsonb,
	"build_id" text,
	"part_id" text,
	"quote_id" text,
	"price_cents" integer,
	"currency" text DEFAULT 'usd' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kid_designs_status_ck" CHECK ("kid_designs"."status" in ('new','offline','failed','priced','unpriceable'))
);
--> statement-breakpoint
CREATE TABLE "kid_mode_locks" (
	"session_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kid_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kid_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"nickname" text NOT NULL,
	"age_band" text NOT NULL,
	"avatar" text NOT NULL,
	"spending_limit_cents" integer DEFAULT 2500 NOT NULL,
	"allowed_templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"live_viewing" boolean DEFAULT false NOT NULL,
	"discover_browsing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kid_profiles_age_band_ck" CHECK ("kid_profiles"."age_band" in ('6-9','10-12','13-17')),
	CONSTRAINT "kid_profiles_nickname_ck" CHECK (char_length("kid_profiles"."nickname") between 1 and 12),
	CONSTRAINT "kid_profiles_limit_ck" CHECK ("kid_profiles"."spending_limit_cents" between 500 and 20000)
);
--> statement-breakpoint
CREATE TABLE "kid_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kid_id" text NOT NULL,
	"design_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kid_requests_status_ck" CHECK ("kid_requests"."status" in ('pending','approved','declined'))
);
--> statement-breakpoint
CREATE TABLE "kid_safe_builds" (
	"build_id" text PRIMARY KEY NOT NULL,
	"marked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_activity" ADD CONSTRAINT "family_activity_kid_id_kid_profiles_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kid_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_designs" ADD CONSTRAINT "kid_designs_kid_id_kid_profiles_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kid_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_designs" ADD CONSTRAINT "kid_designs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_mode_locks" ADD CONSTRAINT "kid_mode_locks_kid_id_kid_profiles_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kid_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_requests" ADD CONSTRAINT "kid_requests_kid_id_kid_profiles_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kid_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_requests" ADD CONSTRAINT "kid_requests_design_id_kid_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."kid_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kid_safe_builds" ADD CONSTRAINT "kid_safe_builds_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_activity_owner_idx" ON "family_activity" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "kid_designs_kid_idx" ON "kid_designs" USING btree ("kid_id","created_at");--> statement-breakpoint
CREATE INDEX "kid_mode_locks_owner_idx" ON "kid_mode_locks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "kid_profiles_owner_idx" ON "kid_profiles" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "kid_requests_owner_idx" ON "kid_requests" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "kid_requests_kid_idx" ON "kid_requests" USING btree ("kid_id","created_at");--> statement-breakpoint
CREATE INDEX "kid_requests_quote_idx" ON "kid_requests" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kid_requests_design_uq" ON "kid_requests" USING btree ("design_id");