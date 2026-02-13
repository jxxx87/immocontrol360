-- Create meters table
create table meters (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  portfolio_id uuid references portfolios(id) on delete cascade not null,
  property_id uuid references properties(id) on delete cascade not null,
  unit_id uuid references units(id) on delete set null, -- Optional if meter is for whole property
  meter_number text not null,
  meter_type text check (meter_type in ('Strom', 'Kaltwasser', 'Warmwasser', 'Gas', 'Wärmemengen', 'Sonstiges')),
  unit text check (unit in ('kWh', 'Wh', 'm³', 'Liter', 'sonstiges')),
  meter_name text,
  location text,
  supplier text,
  contract_number text,
  notes text,
  last_reading_value numeric,
  last_reading_date date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS on meters
alter table meters enable row level security;

create policy "Users can view their own meters"
  on meters for select
  using (auth.uid() = user_id);

create policy "Users can insert their own meters"
  on meters for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own meters"
  on meters for update
  using (auth.uid() = user_id);

create policy "Users can delete their own meters"
  on meters for delete
  using (auth.uid() = user_id);


-- Create meter_readings table
create table meter_readings (
  id uuid default gen_random_uuid() primary key,
  meter_id uuid references meters(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null, -- Redundant but good for simple RLS
  portfolio_id uuid references portfolios(id) on delete cascade not null, -- Also somewhat redundant but useful
  reading_value numeric not null,
  reading_date date not null default current_date,
  note text,
  created_at timestamp with time zone default now()
);

-- Enable RLS on meter_readings
alter table meter_readings enable row level security;

create policy "Users can view their own meter readings"
  on meter_readings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own meter readings"
  on meter_readings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own meter readings"
  on meter_readings for update
  using (auth.uid() = user_id);

create policy "Users can delete their own meter readings"
  on meter_readings for delete
  using (auth.uid() = user_id);


-- Create function to update meters.last_reading_value/date on new reading
create or replace function update_meter_last_reading()
returns trigger as $$
begin
  update meters
  set last_reading_value = new.reading_value,
      last_reading_date = new.reading_date,
      updated_at = now()
  where id = new.meter_id
  -- Only update if the new reading is newer or same date (assuming sequential inputs mostly)
  -- Or just always update to the latest inserted reading based on date?
  -- Let's just update if the new date is >= current last_reading_date or if last_reading_date is null.
  and (last_reading_date is null or new.reading_date >= last_reading_date);
  return new;
end;
$$ language plpgsql security definer;

-- Create trigger
create trigger on_reading_insert
  after insert on meter_readings
  for each row execute procedure update_meter_last_reading();
