-- Create bank_connections table
create table if not exists bank_connections (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users not null,
  bank_name text not null,
  account_id text not null,
  account_name text,
  iban text not null,
  balance decimal(12,2) default 0.00,
  status text default 'active'
);

-- Create bank_transactions table
create table if not exists bank_transactions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users not null,
  connection_id uuid references bank_connections(id) on delete cascade not null,
  transaction_id text not null,
  booking_date date not null,
  value_date date not null,
  amount decimal(12,2) not null,
  purpose text,
  counterpart_name text,
  counterpart_iban text,
  status text default 'pending', -- pending, suggested, matched, ignored
  matched_type text,             -- income, expense
  matched_target_id uuid,        -- references leases(id) or expenses(id)
  unique(user_id, transaction_id)
);

-- Create bank_matching_rules table (Learning Database)
create table if not exists bank_matching_rules (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users not null,
  counterpart_name text,
  counterpart_iban text,
  purpose_keyword text,
  target_type text not null,     -- income (for rent), expense (for operational cost)
  target_id uuid not null,       -- lease_id for income, category_id for expense
  property_id uuid references properties(id) on delete set null,
  unit_id uuid references units(id) on delete set null
);

-- Enable RLS
alter table bank_connections enable row level security;
alter table bank_transactions enable row level security;
alter table bank_matching_rules enable row level security;

-- Policies for bank_connections
drop policy if exists "Users can view their own bank connections" on bank_connections;
create policy "Users can view their own bank connections"
  on bank_connections for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own bank connections" on bank_connections;
create policy "Users can insert their own bank connections"
  on bank_connections for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own bank connections" on bank_connections;
create policy "Users can update their own bank connections"
  on bank_connections for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own bank connections" on bank_connections;
create policy "Users can delete their own bank connections"
  on bank_connections for delete using (auth.uid() = user_id);

-- Policies for bank_transactions
drop policy if exists "Users can view their own bank transactions" on bank_transactions;
create policy "Users can view their own bank transactions"
  on bank_transactions for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own bank transactions" on bank_transactions;
create policy "Users can insert their own bank transactions"
  on bank_transactions for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own bank transactions" on bank_transactions;
create policy "Users can update their own bank transactions"
  on bank_transactions for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own bank transactions" on bank_transactions;
create policy "Users can delete their own bank transactions"
  on bank_transactions for delete using (auth.uid() = user_id);

-- Policies for bank_matching_rules
drop policy if exists "Users can view their own matching rules" on bank_matching_rules;
create policy "Users can view their own matching rules"
  on bank_matching_rules for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own matching rules" on bank_matching_rules;
create policy "Users can insert their own matching rules"
  on bank_matching_rules for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own matching rules" on bank_matching_rules;
create policy "Users can update their own matching rules"
  on bank_matching_rules for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own matching rules" on bank_matching_rules;
create policy "Users can delete their own matching rules"
  on bank_matching_rules for delete using (auth.uid() = user_id);

-- Indexes
create index if not exists idx_bank_transactions_user_id on bank_transactions(user_id);
create index if not exists idx_bank_transactions_status on bank_transactions(status);
create index if not exists idx_bank_matching_rules_user_id on bank_matching_rules(user_id);
