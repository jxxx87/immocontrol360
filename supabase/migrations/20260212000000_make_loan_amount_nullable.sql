-- Make loan_amount nullable to support optional entry
ALTER TABLE loans ALTER COLUMN loan_amount DROP NOT NULL;
