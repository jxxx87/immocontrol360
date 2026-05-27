-- Migration: Add bank_account_holder to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;
