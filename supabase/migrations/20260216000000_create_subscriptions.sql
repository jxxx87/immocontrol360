-- Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    plan TEXT NOT NULL, -- 'starter', 'professional', 'enterprise'
    status TEXT NOT NULL, -- 'trialing', 'active', 'past_due', 'canceled', 'expired_trial'
    trial_ends_at TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own subscription
CREATE POLICY "Users can view own subscription" 
ON public.subscriptions FOR SELECT 
USING (auth.uid() = user_id);

-- Policy: Service role (Edge Functions) can manage everything
-- (Implicitly true for service_role, but explicit for clarity if needed by specific roles)

-- Function to handle updated_at
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER on_subscription_update
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
