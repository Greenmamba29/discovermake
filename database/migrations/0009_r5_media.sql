CREATE TYPE "public"."auction_bid_status" AS ENUM('PLACED', 'WON', 'LOST', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."auction_status" AS ENUM('OPEN', 'SOLD', 'UNSOLD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."build_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."clip_origin" AS ENUM('host', 'system');--> statement-breakpoint
CREATE TYPE "public"."creator_earning_kind" AS ENUM('REMIX_ROYALTY', 'MAKE_THIS_ROYALTY', 'DROP_REVENUE', 'AUCTION_REVENUE', 'ROYALTY_REVERSAL', 'REVENUE_REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."drop_queue_status" AS ENUM('QUEUED', 'ADMITTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."remix_license" AS ENUM('none', 'personal', 'commercial');--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'CREATOR_PAYABLE';--> statement-breakpoint
CREATE TABLE "auction_bids" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"buyer_email" text NOT NULL,
	"bidder_name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"order_id" text NOT NULL,
	"checkout_url" text,
	"status" "auction_bid_status" DEFAULT 'PLACED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text,
	"channel_id" text NOT NULL,
	"build_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"title" text NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"starting_bid_cents" integer NOT NULL,
	"min_increment_cents" integer NOT NULL,
	"current_bid_cents" integer,
	"leading_bid_id" text,
	"leading_bidder_name" text,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"status" "auction_status" DEFAULT 'OPEN' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"original_ends_at" timestamp with time zone NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"winning_bid_id" text,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auctions_amounts_ck" CHECK ("auctions"."starting_bid_cents" > 0 and "auctions"."min_increment_cents" > 0 and "auctions"."bid_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "build_publications" (
	"build_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"visibility" "build_visibility" DEFAULT 'private' NOT NULL,
	"license" "remix_license" DEFAULT 'personal' NOT NULL,
	"royalty_pct" integer DEFAULT 10 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_attachment_id" text,
	"search_text" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_publications_royalty_ck" CHECK ("build_publications"."royalty_pct" >= 0 and "build_publications"."royalty_pct" <= 30)
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"build_id" text,
	"title" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"product_at_ms" integer,
	"origin" "clip_origin" NOT NULL,
	"event_seq" integer,
	"created_by" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clips_range_ck" CHECK ("clips"."start_ms" >= 0 and "clips"."end_ms" > "clips"."start_ms")
);
--> statement-breakpoint
CREATE TABLE "creator_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_account_id" text,
	"stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_user_id" text NOT NULL,
	"kind" "creator_earning_kind" NOT NULL,
	"order_id" text NOT NULL,
	"build_id" text NOT NULL,
	"source_build_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"txn_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_earnings_amount_ck" CHECK ("creator_earnings"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "creator_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_user_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_payouts_amount_ck" CHECK ("creator_payouts"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "drop_queue_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"drop_id" text NOT NULL,
	"user_id" text NOT NULL,
	"buyer_email" text NOT NULL,
	"buyer_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"request" jsonb NOT NULL,
	"enqueued_second" integer NOT NULL,
	"tie_break" integer NOT NULL,
	"status" "drop_queue_status" DEFAULT 'QUEUED' NOT NULL,
	"claim_id" text,
	"reason" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_queue_entries_quantity_ck" CHECK ("drop_queue_entries"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "drop_queues" (
	"drop_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" text PRIMARY KEY NOT NULL,
	"viewer_key" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"item_kind" text NOT NULL,
	"item_id" text NOT NULL,
	"tab" text NOT NULL,
	"position" integer,
	"score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_publications" ADD CONSTRAINT "build_publications_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_publications" ADD CONSTRAINT "build_publications_cover_attachment_id_build_attachments_id_fk" FOREIGN KEY ("cover_attachment_id") REFERENCES "public"."build_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_source_build_id_builds_id_fk" FOREIGN KEY ("source_build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_queue_entries" ADD CONSTRAINT "drop_queue_entries_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_queue_entries" ADD CONSTRAINT "drop_queue_entries_claim_id_slot_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."slot_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_queues" ADD CONSTRAINT "drop_queues_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_bids_auction_idx" ON "auction_bids" USING btree ("auction_id","amount_cents");--> statement-breakpoint
CREATE INDEX "auction_bids_user_idx" ON "auction_bids" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bids_order_uq" ON "auction_bids" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bids_amount_uq" ON "auction_bids" USING btree ("auction_id","amount_cents");--> statement-breakpoint
CREATE INDEX "auctions_show_idx" ON "auctions" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "auctions_open_idx" ON "auctions" USING btree ("ends_at") WHERE "auctions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "build_publications_public_idx" ON "build_publications" USING btree ("published_at") WHERE "build_publications"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX "build_publications_owner_idx" ON "build_publications" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "build_publications_fts_idx" ON "build_publications" USING gin (to_tsvector('english', "search_text"));--> statement-breakpoint
CREATE INDEX "clips_show_idx" ON "clips" USING btree ("show_id","start_ms");--> statement-breakpoint
CREATE INDEX "clips_created_idx" ON "clips" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clips_system_event_uq" ON "clips" USING btree ("show_id","event_seq") WHERE "clips"."origin" = 'system';--> statement-breakpoint
CREATE INDEX "clips_fts_idx" ON "clips" USING gin (to_tsvector('english', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "creator_earnings_order_kind_uq" ON "creator_earnings" USING btree ("order_id","creator_user_id","kind");--> statement-breakpoint
CREATE INDEX "creator_earnings_creator_idx" ON "creator_earnings" USING btree ("creator_user_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_payouts_creator_idx" ON "creator_payouts" USING btree ("creator_user_id","created_at");--> statement-breakpoint
CREATE INDEX "drop_queue_entries_order_idx" ON "drop_queue_entries" USING btree ("drop_id","status","enqueued_second","tie_break");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_queue_entries_one_queued_uq" ON "drop_queue_entries" USING btree ("drop_id","user_id") WHERE "drop_queue_entries"."status" = 'QUEUED';--> statement-breakpoint
CREATE INDEX "feed_events_item_idx" ON "feed_events" USING btree ("item_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "feed_events_viewer_idx" ON "feed_events" USING btree ("viewer_key","created_at");