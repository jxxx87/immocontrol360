-- =====================================================
-- Enable Realtime Replication for notification tables
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- =====================================================

-- Enable replication for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable replication for tickets table
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;

-- Enable replication for announcements table
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;

-- Enable replication for documents table
ALTER PUBLICATION supabase_realtime ADD TABLE documents;

-- Enable replication for user_roles table
ALTER PUBLICATION supabase_realtime ADD TABLE user_roles;

-- Verify: Check which tables have replication enabled
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
