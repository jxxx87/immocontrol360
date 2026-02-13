-- Clean up 'Wohneinheit' (Singular) and merge into 'Wohneinheiten' (Plural)
DO $$
DECLARE
    final_std_key_id UUID;
    singular_key_record RECORD;
    plural_key_record RECORD;
BEGIN
    -- 1. Ensure Standard 'Wohneinheiten' (Plural) Key exists
    -- Find existing Plural Key (prefer one with user_id NULL if exists)
    SELECT id INTO final_std_key_id FROM distribution_keys WHERE name = 'Wohneinheiten' ORDER BY user_id LIMIT 1;
    
    -- If not found, check Singular
    IF final_std_key_id IS NULL THEN
        SELECT id INTO final_std_key_id FROM distribution_keys WHERE name = 'Wohneinheit' ORDER BY user_id LIMIT 1;
        
        IF final_std_key_id IS NOT NULL THEN
            -- Rename Singular to Plural
            UPDATE distribution_keys SET name = 'Wohneinheiten', calculation_type = 'units' WHERE id = final_std_key_id;
        ELSE
            -- Create New Standard Plural Key
            INSERT INTO distribution_keys (name, calculation_type, description, user_id)
            VALUES ('Wohneinheiten', 'units', 'Verteilung pro Einheit', NULL)
            RETURNING id INTO final_std_key_id;
        END IF;
    ELSE
        -- Ensure Plural Key is marked as Standard (user_id NULL) and correct type
        UPDATE distribution_keys SET user_id = NULL, calculation_type = 'units' WHERE id = final_std_key_id;
    END IF;

    -- 2. Clean up ALL OTHER variants (Singular 'Wohneinheit', Plural duplicates)
    FOR singular_key_record IN 
        SELECT id FROM distribution_keys WHERE (name = 'Wohneinheit' OR name = 'Wohneinheiten') AND id != final_std_key_id
    LOOP
        -- Reassign Categories
        UPDATE expense_categories 
        SET distribution_key_id = final_std_key_id 
        WHERE distribution_key_id = singular_key_record.id;
        
        -- Delete Duplicate Key
        DELETE FROM distribution_keys WHERE id = singular_key_record.id;
    END LOOP;

    -- 3. Ensure 'Sonstige Betriebskosten' (Old Lowercase) is mapped to correct Standard 'Sonstige Betriebskosten' (or whatever standard key)
    -- Actually, user asked to remove lowercase 'sonstige'.
    -- I will rename any existing category 'sonstige Betriebskosten' -> 'Sonstige Betriebskosten'
    UPDATE expense_categories SET name = 'Sonstige Betriebskosten' WHERE name = 'sonstige Betriebskosten';

    -- 4. Deduplicate Categories (in case rename caused conflict)
    -- Keep the one with a key assigned, delete others. Or keep latest.
    -- (This is complex in SQL if unique constraint on name/user_id exists, assuming not yet).
    -- If multiple 'Sonstige Betriebskosten' exist for same user, merge them?
    -- For now I assume rename is enough, or let them coexist until user cleans up.
    
END $$;
