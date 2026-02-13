-- Add opening hours settings to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS settings_opening_hours_visible BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS settings_opening_hours_text TEXT DEFAULT 'Mo-Fr 9:00 - 17:00 Uhr';
