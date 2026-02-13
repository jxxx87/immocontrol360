-- Create a table for public profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  updated_at TIMESTAMP WITH TIME ZONE,
  salutation TEXT, -- Herr, Frau, Familie, Firma
  title TEXT, -- Acadamic title etc. (optional, not requested but good to have)
  name_suffix TEXT, -- Zusatz
  company TEXT,
  first_name TEXT,
  last_name TEXT,
  street TEXT,
  house_number TEXT,
  zip TEXT,
  city TEXT,
  phone TEXT,
  mobile TEXT,
  bank_name TEXT,
  iban TEXT,
  bic TEXT,
  tax_number TEXT,
  vat_id TEXT
);

-- Set up Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone." ON profiles
  FOR SELECT USING (true); -- Or restricts to auth.uid() = id if private? Let's make it private for now as it contains PII.

DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON profiles;

CREATE POLICY "Users can view their own profile." ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile." ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile." ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Function to handle new user profile creation (optional trigger)
-- For now, frontend will handle creation if it doesn't exist on save.
