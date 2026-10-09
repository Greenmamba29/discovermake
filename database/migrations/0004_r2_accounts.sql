CREATE TYPE "public"."auth_challenge_kind" AS ENUM('email', 'passkey_register', 'passkey_login', 'oauth');--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "auth_challenge_kind" NOT NULL,
	"email" text,
	"user_id" text,
	"code_hash" text,
	"challenge" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_follows" (
	"user_id" text NOT NULL,
	"build_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_follows_user_id_build_id_pk" PRIMARY KEY("user_id","build_id")
);
--> statement-breakpoint
CREATE TABLE "device_preferences" (
	"device_hash" text PRIMARY KEY NOT NULL,
	"intent" text,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"device_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"display_name" text,
	"handle" text,
	"roles" text[] DEFAULT '{buyer}'::text[] NOT NULL,
	"intent" text,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lower_ck" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_user_id" text;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_follows" ADD CONSTRAINT "build_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_follows" ADD CONSTRAINT "build_follows_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenges_email_idx" ON "auth_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "auth_challenges_user_idx" ON "auth_challenges" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "build_follows_build_idx" ON "build_follows" USING btree ("build_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_user_uq" ON "oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_secret_hash_uq" ON "user_sessions" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_device_idx" ON "user_sessions" USING btree ("device_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_uq" ON "users" USING btree ("handle") WHERE "users"."handle" is not null;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builds_owner_user_idx" ON "builds" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "builds_device_hash_idx" ON "builds" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "orders_buyer_user_idx" ON "orders" USING btree ("buyer_user_id");