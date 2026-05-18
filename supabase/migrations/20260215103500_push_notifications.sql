-- =====================================================
-- Push Notifications Infrastructure
-- =====================================================

-- 1. Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    device_info TEXT, -- e.g. "Android 14, Pixel 8"
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, fcm_token)
);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions
CREATE POLICY "Users can view own subscriptions"
    ON push_subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
    ON push_subscriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
    ON push_subscriptions FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
    ON push_subscriptions FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role can do everything (for Edge Function)
CREATE POLICY "Service role full access"
    ON push_subscriptions FOR ALL
    USING (auth.role() = 'service_role');

-- 2. Enable pg_net extension (for calling Edge Functions from triggers)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3. Helper function to call the Edge Function
CREATE OR REPLACE FUNCTION notify_push(
    p_table TEXT,
    p_record JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    edge_function_url TEXT;
    service_role_key TEXT;
BEGIN
    -- Get Supabase URL from config (set these in Supabase Dashboard > Settings)
    edge_function_url := current_setting('app.settings.supabase_url', true) 
        || '/functions/v1/send-push-notification';
    service_role_key := current_setting('app.settings.service_role_key', true);

    -- If settings not available, try environment approach
    IF edge_function_url IS NULL OR service_role_key IS NULL THEN
        RETURN;
    END IF;

    -- Call the Edge Function via pg_net
    PERFORM extensions.http_post(
        url := edge_function_url,
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', p_table,
            'record', p_record
        )::text,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_role_key
        )::jsonb
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Don't fail the original transaction if push fails
        RAISE WARNING 'Push notification failed: %', SQLERRM;
END;
$$;

-- 4. Trigger function for messages
CREATE OR REPLACE FUNCTION trigger_push_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only notify on INSERT and only if there's a receiver
    IF NEW.receiver_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM NEW.receiver_id THEN
        PERFORM notify_push('messages', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$$;

-- 5. Trigger function for tickets
CREATE OR REPLACE FUNCTION trigger_push_on_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM notify_push('tickets', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

-- 6. Trigger function for announcements
CREATE OR REPLACE FUNCTION trigger_push_on_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM notify_push('announcements', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

-- 7. Trigger function for documents
CREATE OR REPLACE FUNCTION trigger_push_on_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM notify_push('documents', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

-- 8. Trigger function for tenant registration
CREATE OR REPLACE FUNCTION trigger_push_on_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.role = 'tenant' THEN
        PERFORM notify_push('user_roles', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$$;

-- 9. Create the triggers
DROP TRIGGER IF EXISTS push_on_message ON messages;
CREATE TRIGGER push_on_message
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_on_message();

DROP TRIGGER IF EXISTS push_on_ticket ON tickets;
CREATE TRIGGER push_on_ticket
    AFTER INSERT ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_on_ticket();

DROP TRIGGER IF EXISTS push_on_announcement ON announcements;
CREATE TRIGGER push_on_announcement
    AFTER INSERT ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_on_announcement();

DROP TRIGGER IF EXISTS push_on_document ON documents;
CREATE TRIGGER push_on_document
    AFTER INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_on_document();

DROP TRIGGER IF EXISTS push_on_registration ON user_roles;
CREATE TRIGGER push_on_registration
    AFTER INSERT ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_on_registration();
