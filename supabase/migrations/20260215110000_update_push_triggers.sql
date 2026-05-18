-- Update trigger functions to use supabase_functions.http_request (Database Webhooks)

-- Messages trigger
CREATE OR REPLACE FUNCTION trigger_push_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.receiver_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM NEW.receiver_id THEN
        PERFORM net.http_post(
            url := 'https://agsmqvvwfufenaiekuox.supabase.co/functions/v1/send-push-notification',
            headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDcxNzE1MSwiZXhwIjoyMDg2MjkzMTUxfQ.TNsRHhA6AivTuuJNvBaSjHsH4TYZuQJf06Q5xRc9MxY"}'::jsonb,
            body := jsonb_build_object('type','INSERT','table','messages','record',to_jsonb(NEW))::text
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Tickets trigger
CREATE OR REPLACE FUNCTION trigger_push_on_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://agsmqvvwfufenaiekuox.supabase.co/functions/v1/send-push-notification',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDcxNzE1MSwiZXhwIjoyMDg2MjkzMTUxfQ.TNsRHhA6AivTuuJNvBaSjHsH4TYZuQJf06Q5xRc9MxY"}'::jsonb,
        body := jsonb_build_object('type','INSERT','table','tickets','record',to_jsonb(NEW))::text
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Announcements trigger
CREATE OR REPLACE FUNCTION trigger_push_on_announcement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://agsmqvvwfufenaiekuox.supabase.co/functions/v1/send-push-notification',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDcxNzE1MSwiZXhwIjoyMDg2MjkzMTUxfQ.TNsRHhA6AivTuuJNvBaSjHsH4TYZuQJf06Q5xRc9MxY"}'::jsonb,
        body := jsonb_build_object('type','INSERT','table','announcements','record',to_jsonb(NEW))::text
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Documents trigger
CREATE OR REPLACE FUNCTION trigger_push_on_document()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://agsmqvvwfufenaiekuox.supabase.co/functions/v1/send-push-notification',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDcxNzE1MSwiZXhwIjoyMDg2MjkzMTUxfQ.TNsRHhA6AivTuuJNvBaSjHsH4TYZuQJf06Q5xRc9MxY"}'::jsonb,
        body := jsonb_build_object('type','INSERT','table','documents','record',to_jsonb(NEW))::text
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- User roles (tenant registration) trigger
CREATE OR REPLACE FUNCTION trigger_push_on_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.role = 'tenant' THEN
        PERFORM net.http_post(
            url := 'https://agsmqvvwfufenaiekuox.supabase.co/functions/v1/send-push-notification',
            headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDcxNzE1MSwiZXhwIjoyMDg2MjkzMTUxfQ.TNsRHhA6AivTuuJNvBaSjHsH4TYZuQJf06Q5xRc9MxY"}'::jsonb,
            body := jsonb_build_object('type','INSERT','table','user_roles','record',to_jsonb(NEW))::text
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Drop old helper function
DROP FUNCTION IF EXISTS notify_push(TEXT, JSONB);
