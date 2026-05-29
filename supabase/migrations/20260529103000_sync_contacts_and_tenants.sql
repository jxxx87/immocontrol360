-- 1. Add tenant_id UUID column to contacts referencing tenants
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

-- 2. Link existing contacts of type 'tenant' to tenants table based on email or name match
-- Match by email (case-insensitive)
UPDATE contacts c
SET tenant_id = t.id
FROM tenants t
WHERE c.contact_type = 'tenant'
  AND c.tenant_id IS NULL
  AND c.email IS NOT NULL
  AND t.email IS NOT NULL
  AND LOWER(c.email) = LOWER(t.email);

-- Match by name (case-insensitive)
UPDATE contacts c
SET tenant_id = t.id
FROM tenants t
WHERE c.contact_type = 'tenant'
  AND c.tenant_id IS NULL
  AND LOWER(c.name) = LOWER(t.first_name || ' ' || t.last_name);

-- Match by reverse name format if any (case-insensitive)
UPDATE contacts c
SET tenant_id = t.id
FROM tenants t
WHERE c.contact_type = 'tenant'
  AND c.tenant_id IS NULL
  AND LOWER(c.name) = LOWER(t.last_name || ' ' || t.first_name);

-- Match by last name only if unique and email/first name is missing
WITH unique_tenants AS (
    SELECT id, last_name, user_id
    FROM tenants
    WHERE last_name IN (
        SELECT last_name 
        FROM tenants 
        GROUP BY last_name 
        HAVING COUNT(*) = 1
    )
)
UPDATE contacts c
SET tenant_id = ut.id
FROM unique_tenants ut
WHERE c.contact_type = 'tenant'
  AND c.tenant_id IS NULL
  AND LOWER(c.name) = LOWER(ut.last_name);

-- 3. One-time sync of address details from tenants (or active leases) to existing contacts
-- Sync from tenants' own address if available
UPDATE contacts c
SET
    street = TRIM(COALESCE(t.street, '') || ' ' || COALESCE(t.house_number, '')),
    zip = t.postal_code,
    city = t.city
FROM tenants t
WHERE c.tenant_id = t.id
  AND t.street IS NOT NULL
  AND t.street <> ''
  AND (c.street IS NULL OR c.street = '' OR c.city IS NULL OR c.city = '');

-- Sync from active leases' property address if tenant's own address is empty
UPDATE contacts c
SET
    street = TRIM(COALESCE(p.street, '') || ' ' || COALESCE(p.house_number, '')),
    zip = p.zip,
    city = p.city
FROM tenants t
JOIN leases l ON l.tenant_id = t.id AND l.status = 'active'
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = u.property_id
WHERE c.tenant_id = t.id
  AND (c.street IS NULL OR c.street = '' OR c.city IS NULL OR c.city = '');

-- 4. Create trigger function to sync tenant updates to contacts table
CREATE OR REPLACE FUNCTION sync_tenant_to_contact()
RETURNS TRIGGER AS $$
DECLARE
    v_street TEXT;
    v_zip TEXT;
    v_city TEXT;
    v_unit_name TEXT;
BEGIN
    -- Prevent trigger recursion loop
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Determine the address to sync (use tenant's own address, otherwise active lease property address)
    IF NEW.street IS NOT NULL AND NEW.street <> '' THEN
        v_street := TRIM(COALESCE(NEW.street, '') || ' ' || COALESCE(NEW.house_number, ''));
        v_zip := NEW.postal_code;
        v_city := NEW.city;
    ELSE
        -- Try to get active lease property address and unit name
        SELECT 
            TRIM(COALESCE(p.street, '') || ' ' || COALESCE(p.house_number, '')), 
            p.zip, 
            p.city,
            u.unit_name
        INTO v_street, v_zip, v_city, v_unit_name
        FROM leases l
        JOIN units u ON u.id = l.unit_id
        JOIN properties p ON p.id = u.property_id
        WHERE l.tenant_id = NEW.id AND l.status = 'active'
        ORDER BY l.start_date DESC
        LIMIT 1;
    END IF;

    -- Sync to contacts table
    IF EXISTS (SELECT 1 FROM contacts WHERE tenant_id = NEW.id) THEN
        UPDATE contacts
        SET
            name = TRIM(NEW.first_name || ' ' || NEW.last_name),
            email = NEW.email,
            phone = NEW.phone,
            street = COALESCE(v_street, street),
            zip = COALESCE(v_zip, zip),
            city = COALESCE(v_city, city),
            unit_name = COALESCE(v_unit_name, unit_name)
        WHERE tenant_id = NEW.id;
    ELSE
        INSERT INTO contacts (user_id, name, contact_type, email, phone, street, zip, city, unit_name, tenant_id)
        VALUES (
            NEW.user_id,
            TRIM(NEW.first_name || ' ' || NEW.last_name),
            'tenant',
            NEW.email,
            NEW.phone,
            v_street,
            v_zip,
            v_city,
            v_unit_name,
            NEW.id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create trigger function to sync contact updates to tenants table
CREATE OR REPLACE FUNCTION sync_contact_to_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_first_name TEXT;
    v_last_name TEXT;
    v_space_idx INT;
    v_street TEXT;
    v_house_number TEXT;
    v_matches TEXT[];
BEGIN
    -- Prevent trigger recursion loop
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    IF NEW.contact_type = 'tenant' AND NEW.tenant_id IS NOT NULL THEN
        -- Split name into first_name and last_name
        v_space_idx := POSITION(' ' IN NEW.name);
        IF v_space_idx > 0 THEN
            v_first_name := SUBSTRING(NEW.name FROM 1 FOR v_space_idx - 1);
            v_last_name := SUBSTRING(NEW.name FROM v_space_idx + 1);
        ELSE
            v_first_name := '';
            v_last_name := NEW.name;
        END IF;

        -- Split street and house number
        IF NEW.street IS NOT NULL AND NEW.street <> '' THEN
            v_matches := regexp_matches(NEW.street, '^(.*)\s+(\d+[a-zA-Z]*)$');
            IF v_matches IS NOT NULL AND array_length(v_matches, 1) = 2 THEN
                v_street := TRIM(v_matches[1]);
                v_house_number := TRIM(v_matches[2]);
            ELSE
                v_street := NEW.street;
                v_house_number := '';
            END IF;
        ELSE
            v_street := '';
            v_house_number := '';
        END IF;

        -- Update tenant
        UPDATE tenants
        SET
            first_name = v_first_name,
            last_name = v_last_name,
            email = NEW.email,
            phone = NEW.phone,
            street = v_street,
            house_number = v_house_number,
            postal_code = NEW.zip,
            city = NEW.city
        WHERE id = NEW.tenant_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create trigger function to sync lease updates/inserts to contact address/unit
CREATE OR REPLACE FUNCTION sync_lease_to_contact()
RETURNS TRIGGER AS $$
DECLARE
    v_street TEXT;
    v_zip TEXT;
    v_city TEXT;
    v_unit_name TEXT;
BEGIN
    IF NEW.status = 'active' AND NEW.tenant_id IS NOT NULL THEN
        -- Get unit and property details
        SELECT 
            TRIM(COALESCE(p.street, '') || ' ' || COALESCE(p.house_number, '')), 
            p.zip, 
            p.city,
            u.unit_name
        INTO v_street, v_zip, v_city, v_unit_name
        FROM units u
        JOIN properties p ON p.id = u.property_id
        WHERE u.id = NEW.unit_id;

        -- Update the contact if it exists
        UPDATE contacts
        SET
            street = v_street,
            zip = v_zip,
            city = v_city,
            unit_name = v_unit_name
        WHERE tenant_id = NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Register Triggers
DROP TRIGGER IF EXISTS trg_sync_tenant_to_contact ON tenants;
CREATE TRIGGER trg_sync_tenant_to_contact
AFTER INSERT OR UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION sync_tenant_to_contact();

DROP TRIGGER IF EXISTS trg_sync_contact_to_tenant ON contacts;
CREATE TRIGGER trg_sync_contact_to_tenant
AFTER UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION sync_contact_to_tenant();

DROP TRIGGER IF EXISTS trg_sync_lease_to_contact ON leases;
CREATE TRIGGER trg_sync_lease_to_contact
AFTER INSERT OR UPDATE ON leases
FOR EACH ROW
EXECUTE FUNCTION sync_lease_to_contact();
