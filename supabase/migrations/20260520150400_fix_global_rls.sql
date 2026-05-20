-- Fix global RLS leakage on tenant portal tables

-- 1. tickets
DROP POLICY IF EXISTS "investors_manage_all_tickets" ON tickets;
DROP POLICY IF EXISTS "default_investors_manage_tickets" ON tickets;

CREATE POLICY "investors_manage_own_tickets" ON tickets
    FOR ALL USING (
        property_id IN (
            SELECT id FROM properties WHERE user_id = auth.uid()
        )
    );

-- 2. announcements
DROP POLICY IF EXISTS "investors_manage_announcements" ON announcements;
DROP POLICY IF EXISTS "default_investors_manage_announcements" ON announcements;

CREATE POLICY "investors_manage_own_announcements" ON announcements
    FOR ALL USING (
        property_id IN (
            SELECT id FROM properties WHERE user_id = auth.uid()
        )
    );

-- 3. user_roles
DROP POLICY IF EXISTS "investors_manage_roles" ON user_roles;

CREATE POLICY "investors_manage_own_roles" ON user_roles
    FOR ALL USING (
        property_id IN (
            SELECT id FROM properties WHERE user_id = auth.uid()
        ) OR user_id = auth.uid()
    );

-- 4. tenant_invitations
DROP POLICY IF EXISTS "investors_manage_invitations" ON tenant_invitations;
DROP POLICY IF EXISTS "default_investors_manage_invitations" ON tenant_invitations;

CREATE POLICY "investors_manage_own_invitations" ON tenant_invitations
    FOR ALL USING (
        invited_by = auth.uid() OR
        property_id IN (
            SELECT id FROM properties WHERE user_id = auth.uid()
        )
    );

-- 5. messages (remove global system message spoofing)
DROP POLICY IF EXISTS "investors_send_system_messages" ON messages;
DROP POLICY IF EXISTS "default_investors_send_system_messages" ON messages;
