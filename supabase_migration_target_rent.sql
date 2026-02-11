-- Add target_rent column to units table
alter table "public"."units" add column if not exists "target_rent" numeric;
