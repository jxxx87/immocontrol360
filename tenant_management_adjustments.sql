-- 1. Create a view to expose tenant's registered email and last_sign_in_at to their landlord or themselves
CREATE OR REPLACE VIEW public.tenant_auth_info AS
SELECT 
    ur.user_id AS tenant_user_id,
    ur.tenant_id,
    u.email AS registered_email,
    u.last_sign_in_at AS last_sign_in_at
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
JOIN public.tenants t ON t.id = ur.tenant_id
WHERE ur.role = 'tenant'
  AND (t.user_id = auth.uid() OR ur.user_id = auth.uid());

GRANT SELECT ON public.tenant_auth_info TO authenticated;

-- 2. Create a function to completely delete a tenant, their invitations, verification links, role, auth account, profile, and nullify references
CREATE OR REPLACE FUNCTION public.delete_tenant_completely(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id uuid;
    v_landlord_id uuid;
BEGIN
    -- Get the landlord ID who owns this tenant
    SELECT user_id INTO v_landlord_id 
    FROM public.tenants 
    WHERE id = p_tenant_id;

    -- Verify that the current user is authorized (must be the landlord of this tenant)
    IF v_landlord_id IS NULL OR v_landlord_id != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized to delete this tenant';
    END IF;

    -- Get the tenant's user_id from user_roles if they registered
    SELECT user_id INTO v_user_id 
    FROM public.user_roles 
    WHERE tenant_id = p_tenant_id AND role = 'tenant'
    LIMIT 1;

    -- Nullify tenant_id references in other tables to avoid foreign key restrict errors
    UPDATE public.documents SET tenant_id = NULL WHERE tenant_id = p_tenant_id;
    UPDATE public.claims SET tenant_id = NULL WHERE tenant_id = p_tenant_id;
    UPDATE public.leases SET tenant_id = NULL WHERE tenant_id = p_tenant_id;
    UPDATE public.contacts SET tenant_id = NULL WHERE tenant_id = p_tenant_id;

    -- Delete verification links, invitations, and user_roles
    DELETE FROM public.tenant_verification_links WHERE tenant_id = p_tenant_id;
    DELETE FROM public.tenant_invitations WHERE tenant_id = p_tenant_id;
    DELETE FROM public.user_roles WHERE tenant_id = p_tenant_id;

    -- If a registered user account exists, delete it
    IF v_user_id IS NOT NULL THEN
        DELETE FROM public.profiles WHERE id = v_user_id;
        DELETE FROM auth.users WHERE id = v_user_id;
    END IF;

    -- Delete the tenant record itself
    DELETE FROM public.tenants WHERE id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_tenant_completely(uuid) TO authenticated;
