-- Fix RLS policies for tenant_invitations to allow invited tenants (new users without a role yet) 
-- to read and update their own invitations when logging in.

DROP POLICY IF EXISTS "users_read_own_invitation" ON tenant_invitations;
CREATE POLICY "users_read_own_invitation" ON tenant_invitations
    FOR SELECT TO authenticated
    USING (
        lower(email) = lower(auth.jwt() ->> 'email')
    );

DROP POLICY IF EXISTS "users_update_own_invitation" ON tenant_invitations;
CREATE POLICY "users_update_own_invitation" ON tenant_invitations
    FOR UPDATE TO authenticated
    USING (
        lower(email) = lower(auth.jwt() ->> 'email')
    )
    WITH CHECK (
        lower(email) = lower(auth.jwt() ->> 'email')
    );
