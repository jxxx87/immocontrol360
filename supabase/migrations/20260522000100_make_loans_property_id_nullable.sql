-- Make property_id nullable in loans
ALTER TABLE loans ALTER COLUMN property_id DROP NOT NULL;
