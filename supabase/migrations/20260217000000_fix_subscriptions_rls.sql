-- Add INSERT and UPDATE policies for subscriptions
-- Users can create their own subscription (for trial start)
CREATE POLICY "Users can insert own subscription"
ON public.subscriptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own subscription (for plan changes, trial restart)
CREATE POLICY "Users can update own subscription"
ON public.subscriptions FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
