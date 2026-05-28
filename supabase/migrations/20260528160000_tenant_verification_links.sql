-- Add address columns to tenants
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS street TEXT,
ADD COLUMN IF NOT EXISTS house_number TEXT,
ADD COLUMN IF NOT EXISTS postal_code TEXT,
ADD COLUMN IF NOT EXISTS city TEXT;

-- Create tenant_verification_links table
CREATE TABLE IF NOT EXISTS public.tenant_verification_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_updated BOOLEAN DEFAULT false NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.tenant_verification_links ENABLE ROW LEVEL SECURITY;

--authenticated policy
DROP POLICY IF EXISTS "Allow authenticated full access to tenant_verification_links" ON public.tenant_verification_links;
CREATE POLICY "Allow authenticated full access to tenant_verification_links"
ON public.tenant_verification_links
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- RPC 1: Get tenant by token
CREATE OR REPLACE FUNCTION public.get_tenant_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link record;
    v_tenant record;
    v_unit_name text;
BEGIN
    -- 1. Find and validate the link
    SELECT * INTO v_link 
    FROM tenant_verification_links 
    WHERE token = p_token AND expires_at > now();
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Link ist ungültig oder abgelaufen.');
    END IF;
    
    -- 2. Find the tenant
    SELECT * INTO v_tenant 
    FROM tenants 
    WHERE id = v_link.tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Mieter nicht gefunden.');
    END IF;

    -- 3. Get the unit name from their active lease (if any)
    SELECT u.unit_name INTO v_unit_name
    FROM leases l
    JOIN units u ON u.id = l.unit_id
    WHERE l.tenant_id = v_tenant.id AND l.status = 'active'
    LIMIT 1;

    RETURN json_build_object(
        'id', v_tenant.id,
        'first_name', v_tenant.first_name,
        'last_name', v_tenant.last_name,
        'street', COALESCE(v_tenant.street, ''),
        'house_number', COALESCE(v_tenant.house_number, ''),
        'postal_code', COALESCE(v_tenant.postal_code, ''),
        'city', COALESCE(v_tenant.city, ''),
        'phone', COALESCE(v_tenant.phone, ''),
        'email', COALESCE(v_tenant.email, ''),
        'unit_name', COALESCE(v_unit_name, 'Keine aktive Zuordnung'),
        'expires_at', v_link.expires_at,
        'is_updated', v_link.is_updated
    );
END;
$$;

-- RPC 2: Update tenant by token
CREATE OR REPLACE FUNCTION public.update_tenant_by_token(
    p_token text,
    p_first_name text,
    p_last_name text,
    p_street text,
    p_house_number text,
    p_postal_code text,
    p_city text,
    p_phone text,
    p_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link record;
    v_tenant_id uuid;
BEGIN
    -- 1. Find and validate the link
    SELECT * INTO v_link 
    FROM tenant_verification_links 
    WHERE token = p_token AND expires_at > now();
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Link ist ungültig oder abgelaufen.');
    END IF;
    
    v_tenant_id := v_link.tenant_id;
    
    -- 2. Update the tenant record
    UPDATE tenants 
    SET 
        first_name = p_first_name,
        last_name = p_last_name,
        street = p_street,
        house_number = p_house_number,
        postal_code = p_postal_code,
        city = p_city,
        phone = p_phone,
        email = p_email
    WHERE id = v_tenant_id;
    
    -- 3. Mark the link as updated
    UPDATE tenant_verification_links
    SET 
        is_updated = true,
        updated_at = now()
    WHERE id = v_link.id;
    
    RETURN json_build_object('success', true);
END;
$$;
