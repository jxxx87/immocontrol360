-- ============================================================================
-- ImmoControlpro360 — Mieterportal Migration
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================================

-- 1. user_roles: Maps auth.users to application roles
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('investor', 'tenant')),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- 2. announcements: Property-wide announcements (one-way: investor → tenants)
CREATE TABLE IF NOT EXISTS announcements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. tickets: Maintenance/issue tickets
CREATE TABLE IF NOT EXISTS tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE NOT NULL,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
    tenant_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'in_progress', 'completed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    images TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. messages: Chat messages between investor and tenant
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    text TEXT,
    attachment_url TEXT,
    is_system BOOLEAN DEFAULT false,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. tenant_invitations: Track Magic Link invitation status
CREATE TABLE IF NOT EXISTS tenant_invitations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(email, tenant_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_announcements_property ON announcements(property_id);
CREATE INDEX IF NOT EXISTS idx_tickets_unit ON tickets(unit_id);
CREATE INDEX IF NOT EXISTS idx_tickets_property ON tickets(property_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON tenant_invitations(email);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_role" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "investors_manage_roles" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'investor'
        )
    );

-- Allow insert for new users who don't have a role yet (first login after invite)
CREATE POLICY "new_users_can_set_role" ON user_roles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investors_manage_announcements" ON announcements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'investor'
        )
    );

CREATE POLICY "tenants_read_announcements" ON announcements
    FOR SELECT USING (
        property_id IN (
            SELECT ur.property_id FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'tenant'
        )
    );

-- Fallback: users without a role entry (existing investors) can manage everything
CREATE POLICY "default_investors_manage_announcements" ON announcements
    FOR ALL USING (
        NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
        )
    );

-- tickets
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants_manage_own_tickets" ON tickets
    FOR ALL USING (tenant_user_id = auth.uid());

CREATE POLICY "investors_manage_all_tickets" ON tickets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'investor'
        )
    );

CREATE POLICY "default_investors_manage_tickets" ON tickets
    FOR ALL USING (
        NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
        )
    );

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_messages" ON messages
    FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "users_send_messages" ON messages
    FOR INSERT WITH CHECK (sender_id = auth.uid());

CREATE POLICY "users_update_own_received" ON messages
    FOR UPDATE USING (receiver_id = auth.uid());

-- System messages (is_system = true) - allow investors to insert on behalf
CREATE POLICY "investors_send_system_messages" ON messages
    FOR INSERT WITH CHECK (
        is_system = true AND
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'investor'
        )
    );

CREATE POLICY "default_investors_send_system_messages" ON messages
    FOR INSERT WITH CHECK (
        is_system = true AND
        NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
        )
    );

-- tenant_invitations
ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investors_manage_invitations" ON tenant_invitations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'investor'
        )
    );

CREATE POLICY "default_investors_manage_invitations" ON tenant_invitations
    FOR ALL USING (
        NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
        )
    );

-- ============================================================================
-- REALTIME: Enable for messages and tickets
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;

-- ============================================================================
-- STORAGE BUCKETS (run separately if needed)
-- ============================================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('tickets', 'tickets', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-documents', 'tenant-documents', false);
