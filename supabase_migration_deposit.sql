-- Add deposit column to leases
alter table "public"."leases" add column "deposit" numeric;

-- Ensure payment_due_day exists (requested previously)
alter table "public"."leases" add column if not exists "payment_due_day" integer default 3;
