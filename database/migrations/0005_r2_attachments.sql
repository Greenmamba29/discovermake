CREATE TYPE "public"."build_attachment_kind" AS ENUM('image', 'cad');--> statement-breakpoint
CREATE TABLE "build_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"design_version" integer NOT NULL,
	"kind" "build_attachment_kind" NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"part_id" text,
	"created_by_user_id" text,
	"device_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "build_attachments_size_ck" CHECK ("build_attachments"."size_bytes" > 0 and "build_attachments"."size_bytes" <= 52428800)
);
--> statement-breakpoint
CREATE TABLE "passport_replacements" (
	"quote_id" text PRIMARY KEY NOT NULL,
	"replacement_of_passport_id" text NOT NULL,
	"part_id" text NOT NULL,
	"build_id" text NOT NULL,
	"source_quote_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"device_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_attachments" ADD CONSTRAINT "build_attachments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_attachments" ADD CONSTRAINT "build_attachments_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_replacements" ADD CONSTRAINT "passport_replacements_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_replacements" ADD CONSTRAINT "passport_replacements_replacement_of_passport_id_passports_id_fk" FOREIGN KEY ("replacement_of_passport_id") REFERENCES "public"."passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_replacements" ADD CONSTRAINT "passport_replacements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_replacements" ADD CONSTRAINT "passport_replacements_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "build_attachments_build_idx" ON "build_attachments" USING btree ("build_id","created_at") WHERE "build_attachments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "passport_replacements_passport_idx" ON "passport_replacements" USING btree ("replacement_of_passport_id","created_at");