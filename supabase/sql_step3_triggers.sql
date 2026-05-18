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
