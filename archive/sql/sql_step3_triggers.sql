\set ON_ERROR_STOP on
-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/supabase/sql_step3_triggers.sql. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
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
