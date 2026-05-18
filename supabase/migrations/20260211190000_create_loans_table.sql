-- Create loans table
create table if not exists loans (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users(id) not null,
  portfolio_id uuid references portfolios(id) not null,
  property_id uuid references properties(id) not null,
  
  bank_name text not null,
  account_number text,
  loan_amount numeric(15, 2) not null,
  start_date date not null,
  end_date date not null,
  interest_rate numeric(10, 6) not null, -- Stores decimal rate (e.g. 0.035 for 3.5%)
  initial_repayment_rate numeric(10, 6), -- Stores decimal rate (e.g. 0.02 for 2%)
  fixed_annuity numeric(15, 2), -- Monthly annuity payment
  
  current_debt numeric(15, 2), -- Optional: store cached current debt if needed, but usually calculated
  notes text
);

-- Indexes for performance
create index idx_loans_portfolio_id on loans(portfolio_id);
create index idx_loans_property_id on loans(property_id);
create index idx_loans_user_id on loans(user_id);

-- Enable RLS
alter table loans enable row level security;

-- Policies
create policy "Users can view their own loans" on loans for select using (auth.uid() = user_id);
create policy "Users can insert their own loans" on loans for insert with check (auth.uid() = user_id);
create policy "Users can update their own loans" on loans for update using (auth.uid() = user_id);
create policy "Users can delete their own loans" on loans for delete using (auth.uid() = user_id);
