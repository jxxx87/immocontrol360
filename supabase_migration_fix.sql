-- Add construction_year to properties
alter table "public"."properties" add column "construction_year" integer;

-- Ensure other fields used in frontend exist (safety check)
alter table "public"."properties" add column if not exists "property_type" text default 'residential';

-- Ensure leases have payment_due_day if missing
alter table "public"."leases" add column if not exists "payment_due_day" integer default 3;

-- Ensure portfolios have contact info if missing
alter table "public"."portfolios" add column if not exists "company_name" text;
alter table "public"."portfolios" add column if not exists "contact_person" text;
alter table "public"."portfolios" add column if not exists "email" text;
alter table "public"."portfolios" add column if not exists "phone" text;
alter table "public"."portfolios" add column if not exists "street" text;
alter table "public"."portfolios" add column if not exists "house_number" text;
alter table "public"."portfolios" add column if not exists "zip" text;
alter table "public"."portfolios" add column if not exists "city" text;
alter table "public"."portfolios" add column if not exists "ownership_percent" numeric;
alter table "public"."portfolios" add column if not exists "entity_type" text;
alter table "public"."portfolios" add column if not exists "notes" text;
