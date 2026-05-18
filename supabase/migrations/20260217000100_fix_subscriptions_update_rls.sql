-- Add UPDATE policy for subscriptions (INSERT policy already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'subscriptions'
        AND policyname = 'Users can update own subscription'
    ) THEN
        CREATE POLICY "Users can update own subscription"
        ON public.subscriptions FOR UPDATE
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;
END
$$;
