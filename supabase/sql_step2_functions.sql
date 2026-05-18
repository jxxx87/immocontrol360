CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION notify_push(p_table TEXT, p_record JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    edge_function_url TEXT;
    service_role_key TEXT;
BEGIN
    edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-push-notification';
    service_role_key := current_setting('app.settings.service_role_key', true);

    IF edge_function_url IS NULL OR service_role_key IS NULL THEN
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := edge_function_url,
        body := jsonb_build_object('type', 'INSERT', 'table', p_table, 'record', p_record)::text,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_role_key)::jsonb
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Push notification failed: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_push_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.receiver_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM NEW.receiver_id THEN
        PERFORM notify_push('messages', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_push_on_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM notify_push('tickets', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_push_on_announcement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM notify_push('announcements', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_push_on_document()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM notify_push('documents', to_jsonb(NEW));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_push_on_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.role = 'tenant' THEN
        PERFORM notify_push('user_roles', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$$;
