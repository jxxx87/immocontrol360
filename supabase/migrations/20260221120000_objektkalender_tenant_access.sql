-- ============================================================
-- OBJEKTKALENDER: TENANT READ ACCESS
-- Allows tenants to read calendar data for their property
-- ============================================================

-- ── Events: Tenants can read events for their property ──────
CREATE POLICY "ok_tenants_read_events" ON objektkalender_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'tenant'
              AND ur.property_id = objektkalender_events.property_id
        )
    );

-- ── Events: Tenants can update their own unit's events (mark done) ──
CREATE POLICY "ok_tenants_update_own_events" ON objektkalender_events
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'tenant'
              AND ur.property_id = objektkalender_events.property_id
              AND ur.unit_id = objektkalender_events.assigned_unit_id
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'tenant'
              AND ur.property_id = objektkalender_events.property_id
              AND ur.unit_id = objektkalender_events.assigned_unit_id
        )
    );

-- ── Settings: Tenants can read settings for their property ──
CREATE POLICY "ok_tenants_read_settings" ON objektkalender_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'tenant'
              AND ur.property_id = objektkalender_settings.property_id
        )
    );

-- ── History: Tenants can read history for their property ────
CREATE POLICY "ok_tenants_read_history" ON objektkalender_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'tenant'
              AND ur.property_id = objektkalender_history.property_id
        )
    );

-- ── History: Tenants can insert history (when marking task done) ──
CREATE POLICY "ok_tenants_insert_history" ON objektkalender_history
    FOR INSERT WITH CHECK (
        auth.uid() = user_id
    );
