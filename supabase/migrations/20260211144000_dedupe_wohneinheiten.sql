-- Clean up 'Wohneinheiten' duplicates
-- 1. Ensure Standard 'Wohneinheiten' Key exists with ID
DO $$
DECLARE
    std_key_id UUID;
    custom_key_record RECORD;
BEGIN
    -- Check or Insert Standard Key
    SELECT id INTO std_key_id FROM distribution_keys WHERE name = 'Wohneinheiten' AND user_id IS NULL;
    
    IF std_key_id IS NULL THEN
        INSERT INTO distribution_keys (name, calculation_type, description, user_id)
        VALUES ('Wohneinheiten', 'units', 'Verteilung pro Einheit', NULL)
        RETURNING id INTO std_key_id;
    END IF;

    -- 2. Find all OTHER keys named 'Wohneinheiten' (duplicates/custom)
    FOR custom_key_record IN 
        SELECT id FROM distribution_keys WHERE name = 'Wohneinheiten' AND id != std_key_id
    LOOP
        -- Update related categories to point to the STANDARD key
        UPDATE expense_categories 
        SET distribution_key_id = std_key_id 
        WHERE distribution_key_id = custom_key_record.id;
        
        -- Delete the duplicate key
        DELETE FROM distribution_keys WHERE id = custom_key_record.id;
    END LOOP;
END $$;
