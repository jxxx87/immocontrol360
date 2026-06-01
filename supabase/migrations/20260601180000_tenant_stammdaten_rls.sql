-- Add RLS policies for tenants to read and update their own contact details from the tenants table.

DROP POLICY IF EXISTS "tenants_read_own_tenant" ON tenants;
CREATE POLICY "tenants_read_own_tenant" ON tenants
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT ur.tenant_id FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'tenant'
        )
    );

DROP POLICY IF EXISTS "tenants_update_own_tenant" ON tenants;
CREATE POLICY "tenants_update_own_tenant" ON tenants
    FOR UPDATE TO authenticated
    USING (
        id IN (
            SELECT ur.tenant_id FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'tenant'
        )
    )
    WITH CHECK (
        id IN (
            SELECT ur.tenant_id FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'tenant'
        )
    );
