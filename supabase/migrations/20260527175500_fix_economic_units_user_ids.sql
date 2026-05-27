-- Fix user_id of existing economic units to match the user_id of the associated properties
UPDATE economic_units eu
SET user_id = p.user_id
FROM properties p
WHERE p.economic_unit_id = eu.id
  AND eu.user_id <> p.user_id;
