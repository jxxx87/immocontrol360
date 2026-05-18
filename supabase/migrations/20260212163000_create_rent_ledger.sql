-- Create rent_ledger table
create table if not exists rent_ledger (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users not null,
  lease_id uuid references leases(id) on delete cascade not null,
  period_month date not null, -- First day of the month (YYYY-MM-01)
  due_date date, 
  expected_rent decimal(10,2) not null default 0,
  paid_amount decimal(10,2) default 0,
  status text check (status in ('open', 'paid', 'loss')) default 'open',
  note text,
  
  -- Ensure one entry per lease per month
  unique(lease_id, period_month)
);

-- Enable RLS
alter table rent_ledger enable row level security;

-- RLS Policies
create policy "Users can view their own rent ledger"
  on rent_ledger for select
  using (auth.uid() = user_id);

create policy "Users can insert their own rent ledger"
  on rent_ledger for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own rent ledger"
  on rent_ledger for update
  using (auth.uid() = user_id);

create policy "Users can delete their own rent ledger"
  on rent_ledger for delete
  using (auth.uid() = user_id);

-- Optional: Create index for faster queries
create index if not exists idx_rent_ledger_lease_id on rent_ledger(lease_id);
create index if not exists idx_rent_ledger_period_month on rent_ledger(period_month);
create index if not exists idx_rent_ledger_status on rent_ledger(status);
