-- Create cloud_connections table
CREATE TABLE IF NOT EXISTS cloud_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- e.g. 'onedrive', 'googledrive'
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    account_email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create portfolio_cloud_links table
CREATE TABLE IF NOT EXISTS portfolio_cloud_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    cloud_connection_id UUID NOT NULL REFERENCES cloud_connections(id) ON DELETE CASCADE,
    folder_id TEXT, -- Optional root folder ID for this portfolio in the cloud
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, portfolio_id)
);

-- RLS for cloud_connections
ALTER TABLE cloud_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cloud connections" 
    ON cloud_connections FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cloud connections" 
    ON cloud_connections FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cloud connections" 
    ON cloud_connections FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cloud connections" 
    ON cloud_connections FOR DELETE 
    USING (auth.uid() = user_id);

-- RLS for portfolio_cloud_links
ALTER TABLE portfolio_cloud_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own portfolio cloud links" 
    ON portfolio_cloud_links FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own portfolio cloud links" 
    ON portfolio_cloud_links FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own portfolio cloud links" 
    ON portfolio_cloud_links FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own portfolio cloud links" 
    ON portfolio_cloud_links FOR DELETE 
    USING (auth.uid() = user_id);
