-- Add economic_unit_id to properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS economic_unit_id UUID;

-- Optional: Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_properties_economic_unit_id ON properties(economic_unit_id);

-- Note: We do not enforce foreign key to itself because multiple peers can share the same generic UUID representing the unit. 
-- It is just a grouping ID.
