CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    device_info TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, fcm_token)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "Service role full access"
    ON push_subscriptions FOR ALL
    USING (auth.role() = 'service_role');
