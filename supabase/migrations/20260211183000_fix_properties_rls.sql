-- Fix RLS for properties and units to ensure they are visible

-- Properties
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own properties" ON properties;
CREATE POLICY "Users can view their own properties" ON properties FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own properties" ON properties;
CREATE POLICY "Users can insert their own properties" ON properties FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
CREATE POLICY "Users can update their own properties" ON properties FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;
CREATE POLICY "Users can delete their own properties" ON properties FOR DELETE USING (auth.uid() = user_id);

-- Units
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own units" ON units;
CREATE POLICY "Users can view their own units" ON units FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own units" ON units;
CREATE POLICY "Users can insert their own units" ON units FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own units" ON units;
CREATE POLICY "Users can update their own units" ON units FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own units" ON units;
CREATE POLICY "Users can delete their own units" ON units FOR DELETE USING (auth.uid() = user_id);
