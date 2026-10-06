CREATE TABLE "shop_services" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"service_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturing_jobs" ADD COLUMN "source_file_key" text;--> statement-breakpoint
ALTER TABLE "manufacturing_jobs" ADD COLUMN "source_file_sha256" text;--> statement-breakpoint
ALTER TABLE "shop_services" ADD CONSTRAINT "shop_services_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_services" ADD CONSTRAINT "shop_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_services_uq" ON "shop_services" USING btree ("shop_id","service_id");--> statement-breakpoint
CREATE INDEX "shop_services_service_idx" ON "shop_services" USING btree ("service_id");