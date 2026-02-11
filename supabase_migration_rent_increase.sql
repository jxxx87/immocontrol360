-- Add last_rent_increase column to leases
alter table "public"."leases" add column if not exists "last_rent_increase" date;
