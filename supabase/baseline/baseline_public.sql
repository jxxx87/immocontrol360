-- =============================================================================
-- ImmoControl360 · Ausgangsschema (Baseline) der Live-Datenbank – Schema public (+ Storage-Policies)
-- Erzeugt mit supabase/baseline/generate_baseline.sql aus dem Live-Katalog (nur lesend).
-- Stand: 2026-11-28 · PostgreSQL 17.6 · letzte eingetragene Migration: 20261128082403
-- Inhalt: 74 Tabellen, 3 Sichten, 157 Funktionen, 291 Policies (public), 32 Storage-Policies
--
-- NUR AUF EINER LEEREN DATENBANK (frisches Supabase-Projekt) ausführen, als eine Transaktion:
--   psql "<db-url>" -v ON_ERROR_STOP=1 --single-transaction -f baseline_public.sql
-- Danach optional seed_system_defaults.sql, dann alle Migrationen, die NACH dem oben genannten Stand
-- eingetragen wurden (Einzelheiten: supabase/baseline/README.md). Nie auf der Live-Datenbank ausführen.
--
-- notify_push ist hier eine Vault-Fassung (Schlüssel aus vault.decrypted_secrets), NICHT der Live-Rumpf.
-- Keine Daten außer Storage-Bucket-Einstellungen. Rollen anon/authenticated/service_role und die
-- Supabase-Schemata auth/storage/extensions/vault werden vorausgesetzt.
-- =============================================================================
set check_function_bodies = off;
set client_min_messages = warning;
select pg_catalog.set_config('search_path', '', false);

-- Funktionen, die berechnete Spalten, Spalten-Vorgaben oder CHECK-Constraints benutzen
-- (müssen vor den Tabellen in Abschnitt 3 existieren; Rechte und Kommentare folgen in 13/14)
CREATE OR REPLACE FUNCTION public.floor_plan_room_count(p_plan jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(
           case when jsonb_typeof(s -> 'rooms') = 'array' then jsonb_array_length(s -> 'rooms') else 0 end
         ), 0)::integer
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end) as s
$function$
;
CREATE OR REPLACE FUNCTION public.floor_plan_storey_labels(p_plan jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(array_agg(coalesce(nullif(e.s ->> 'label', ''), '?') order by e.ord), '{}'::text[])
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end)
       with ordinality as e(s, ord)
$function$
;
CREATE OR REPLACE FUNCTION public.floor_plan_total_area_mm2(p_plan jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(
           case when jsonb_typeof(r -> 'area_mm2') = 'number' then (r ->> 'area_mm2')::numeric else 0 end
         ), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end) as s
  cross join lateral jsonb_array_elements(
           case when jsonb_typeof(s -> 'rooms') = 'array' then s -> 'rooms' else '[]'::jsonb end) as r
$function$
;

-- -----------------------------------------------------------------------------
-- 2 · Erweiterungen
-- -----------------------------------------------------------------------------
create extension if not exists pg_graphql with schema graphql;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- -----------------------------------------------------------------------------
-- 3 · Tabellen (Spalten, Primär-/Unique-/Check-Constraints)
-- -----------------------------------------------------------------------------
create table public.announcements (
    id uuid default gen_random_uuid() not null,
    property_id uuid not null,
    title text not null,
    content text not null,
    created_by uuid,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    attachments jsonb default '[]'::jsonb,
    constraint announcements_pkey PRIMARY KEY (id)
);
create table public.bank_connections (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid not null,
    bank_name text not null,
    account_id text not null,
    account_name text,
    iban text not null,
    balance numeric(12,2) default 0.00,
    status text default 'active'::text,
    constraint bank_connections_pkey PRIMARY KEY (id)
);
create table public.bank_matching_rules (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid not null,
    counterpart_name text,
    counterpart_iban text,
    purpose_keyword text,
    target_type text not null,
    target_id uuid not null,
    property_id uuid,
    unit_id uuid,
    constraint bank_matching_rules_pkey PRIMARY KEY (id)
);
create table public.bank_transactions (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid not null,
    connection_id uuid not null,
    transaction_id text not null,
    booking_date date not null,
    value_date date not null,
    amount numeric(12,2) not null,
    purpose text,
    counterpart_name text,
    counterpart_iban text,
    status text default 'pending'::text,
    matched_type text,
    matched_target_id uuid,
    constraint bank_transactions_pkey PRIMARY KEY (id),
    constraint bank_transactions_connection_id_transaction_id_key UNIQUE (connection_id, transaction_id),
    constraint bank_transactions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'ignored'::text])))
);
create table public.claim_access_links (
    id uuid default extensions.uuid_generate_v4() not null,
    claim_id uuid not null,
    token_hash text,
    pin_hash text,
    expires_at timestamp with time zone not null,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone default now() not null,
    created_by uuid,
    is_active boolean default true,
    constraint claim_access_links_pkey PRIMARY KEY (id),
    constraint claim_access_links_pin_hash_bcrypt CHECK ((pin_hash ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'::text)),
    constraint claim_access_links_token_hash_sha256 CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);
create table public.claim_events (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    claim_id uuid not null,
    event_type text not null,
    event_date timestamp with time zone default now() not null,
    description text,
    document_id uuid,
    event_metadata jsonb default '{}'::jsonb not null,
    created_at timestamp with time zone default now(),
    constraint claim_events_pkey PRIMARY KEY (id),
    constraint claim_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'status_changed'::text, 'dunning_sent'::text, 'deadline_set'::text, 'deadline_expired'::text, 'tenant_contacted'::text, 'payment_received'::text, 'payment_reversed'::text, 'payment_plan_requested'::text, 'payment_plan_accepted'::text, 'payment_plan_failed'::text, 'escalated'::text, 'cancelled'::text, 'archived'::text, 'note_added'::text, 'closed'::text])))
);
create table public.claim_items (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    claim_id uuid not null,
    rent_ledger_id uuid,
    item_type text default 'rent'::text not null,
    original_amount numeric(12,2) not null,
    description text,
    period_month date,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    due_date date,
    fee_amount numeric(12,2) default 0 not null,
    interest_amount numeric(12,2) default 0 not null,
    rent_ledger_ids uuid[],
    constraint claim_items_pkey PRIMARY KEY (id),
    constraint claim_items_item_type_check CHECK ((item_type = ANY (ARRAY['rent'::text, 'utility_backpay'::text, 'damage'::text, 'deposit'::text, 'other'::text]))),
    constraint claim_items_original_amount_check CHECK ((original_amount >= (0)::numeric))
);
create table public.claim_payment_allocations (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    claim_payment_id uuid not null,
    claim_id uuid not null,
    claim_item_id uuid,
    allocation_bucket text not null,
    amount numeric(12,2) not null,
    created_at timestamp with time zone default now(),
    constraint claim_payment_allocations_pkey PRIMARY KEY (id),
    constraint chk_bucket_item_id CHECK ((((allocation_bucket = 'principal'::text) AND (claim_item_id IS NOT NULL)) OR ((allocation_bucket = ANY (ARRAY['fees'::text, 'interest'::text])) AND (claim_item_id IS NULL)))),
    constraint claim_payment_allocations_allocation_bucket_check CHECK ((allocation_bucket = ANY (ARRAY['fees'::text, 'interest'::text, 'principal'::text])))
);
create table public.claim_payments (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    claim_id uuid not null,
    rent_payment_id uuid,
    payment_date date not null,
    amount numeric(12,2) not null,
    allocation_type text default 'automatic'::text not null,
    status text default 'draft'::text not null,
    reversal_reference_id uuid,
    note text,
    created_at timestamp with time zone default now(),
    constraint claim_payments_pkey PRIMARY KEY (id),
    constraint chk_reversal_amount CHECK ((((allocation_type = 'reversal'::text) AND (amount < (0)::numeric) AND (reversal_reference_id IS NOT NULL)) OR ((allocation_type <> 'reversal'::text) AND (amount >= (0)::numeric) AND (reversal_reference_id IS NULL)))),
    constraint claim_payments_allocation_type_check CHECK ((allocation_type = ANY (ARRAY['automatic'::text, 'manual'::text, 'debtor_designated'::text, 'reversal'::text, 'waiver'::text]))),
    constraint claim_payments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'cancelled'::text])))
);
create table public.claims (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    lease_id uuid not null,
    tenant_id uuid,
    status text default 'draft'::text not null,
    escalation_level integer default 0 not null,
    interest_start_date date,
    interest_rate numeric(8,4) default 5.0000 not null,
    accumulated_unpaid_interest numeric(12,2) default 0 not null,
    accumulated_unpaid_fees numeric(12,2) default 0 not null,
    deadline date,
    next_action_at date,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancellation_reason text,
    archived_at timestamp with time zone,
    constraint claims_pkey PRIMARY KEY (id),
    constraint claims_accumulated_unpaid_fees_check CHECK ((accumulated_unpaid_fees >= (0)::numeric)),
    constraint claims_interest_rate_check CHECK ((interest_rate >= (0)::numeric)),
    constraint claims_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'sent'::text, 'action_required'::text, 'payment_plan_requested'::text, 'payment_plan_active'::text, 'settled'::text, 'cancelled'::text, 'archived'::text])))
);
create table public.cloud_connections (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    provider character varying(50) not null,
    access_token text,
    refresh_token text,
    expires_at timestamp with time zone,
    account_email text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    access_token_secret_id uuid,
    refresh_token_secret_id uuid,
    constraint cloud_connections_pkey PRIMARY KEY (id)
);
create table public.contact_requests (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default now() not null,
    name text not null,
    email text not null,
    message text not null,
    source_page text,
    client_hash text,
    notified_at timestamp with time zone,
    status text default 'new'::text not null,
    constraint contact_requests_pkey PRIMARY KEY (id),
    constraint contact_requests_client_hash_len CHECK (((client_hash IS NULL) OR (char_length(client_hash) <= 128))),
    constraint contact_requests_email_len CHECK ((((char_length(email) >= 3) AND (char_length(email) <= 254)) AND (POSITION(('@'::text) IN (email)) > 1))),
    constraint contact_requests_message_len CHECK (((char_length(message) >= 1) AND (char_length(message) <= 5000))),
    constraint contact_requests_name_len CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
    constraint contact_requests_source_page_len CHECK (((source_page IS NULL) OR (char_length(source_page) <= 200))),
    constraint contact_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'done'::text, 'spam'::text])))
);
create table public.contacts (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    contact_type text default 'other'::text not null,
    name text not null,
    street text,
    zip text,
    city text,
    phone text,
    email text,
    created_at timestamp with time zone default now(),
    unit_name text,
    tenant_id uuid,
    constraint contacts_pkey PRIMARY KEY (id)
);
create table public.deals (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid,
    name text default 'Neuer Deal'::text not null,
    purchase_price numeric default 0,
    total_investment numeric default 0,
    cold_rent_ist numeric default 0,
    cold_rent_soll numeric default 0,
    equity numeric default 0,
    loan_total numeric default 0,
    deal_data jsonb default '{}'::jsonb not null,
    scenario_data jsonb default '{}'::jsonb not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    deal_type text default 'buy_hold'::text not null,
    constraint deals_pkey PRIMARY KEY (id)
);
create table public.distribution_keys (
    id uuid default gen_random_uuid() not null,
    user_id uuid,
    name text not null,
    calculation_type text default 'area'::text not null,
    description text,
    created_at timestamp with time zone default now(),
    constraint distribution_keys_pkey PRIMARY KEY (id)
);
create table public.document_templates (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid,
    type character varying(50) not null,
    subject character varying(255),
    content_html text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name character varying(100),
    is_custom boolean default false not null,
    category character varying(50),
    constraint document_templates_pkey PRIMARY KEY (id),
    constraint document_templates_content_html_size_check CHECK (((content_html IS NULL) OR (octet_length(content_html) <= 5242880)))
);
create table public.documents (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    category text default 'other'::text not null,
    file_name text not null,
    file_path text not null,
    mime_type text,
    related_type text,
    related_id uuid,
    created_at timestamp with time zone default now(),
    property_id uuid,
    tenant_id uuid,
    unit_id uuid,
    storage_path text,
    name text,
    description text,
    constraint documents_pkey PRIMARY KEY (id)
);
create table public.economic_units (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    name text,
    total_investment_cost numeric default 0,
    equity_invested numeric default 0,
    market_value_total numeric default 0,
    notes text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint economic_units_pkey PRIMARY KEY (id)
);
create table public.expense_categories (
    id uuid default gen_random_uuid() not null,
    user_id uuid,
    name text not null,
    is_allocatable boolean default true not null,
    created_at timestamp with time zone default now(),
    is_recoverable boolean default true,
    distribution_key_id uuid,
    constraint expense_categories_pkey PRIMARY KEY (id),
    constraint expense_categories_user_id_name_key UNIQUE (user_id, name)
);
create table public.expenses (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    booking_date date not null,
    document_date date,
    receipt_number text,
    payee text,
    category_id uuid,
    category_custom text,
    property_id uuid,
    unit_id uuid,
    scope text default 'general'::text not null,
    is_allocatable boolean default false not null,
    amount numeric(12,2) not null,
    note text,
    created_at timestamp with time zone default now(),
    constraint expenses_pkey PRIMARY KEY (id)
);
create table public.floor_plans (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    name text default 'Grundriss'::text not null,
    property_id uuid,
    unit_id uuid,
    status text default 'draft'::text not null,
    plan_data jsonb default '[]'::jsonb not null,
    version_history jsonb default '[]'::jsonb,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    room_count integer generated always as (public.floor_plan_room_count(plan_data)) stored,
    total_area_mm2 numeric generated always as (public.floor_plan_total_area_mm2(plan_data)) stored,
    storey_labels text[] generated always as (public.floor_plan_storey_labels(plan_data)) stored,
    constraint floor_plans_pkey PRIMARY KEY (id),
    constraint floor_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'completed'::text])))
);
create table public.invoice_counters (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    year integer not null,
    last_number integer default 0 not null,
    created_at timestamp with time zone default now(),
    object_unit_id uuid,
    constraint invoice_counters_pkey PRIMARY KEY (id),
    constraint invoice_counters_unique_portfolio_year_object UNIQUE NULLS NOT DISTINCT (portfolio_id, year, object_unit_id)
);
create table public.invoices (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    property_id uuid,
    unit_id uuid,
    contact_id uuid,
    invoice_date date default CURRENT_DATE not null,
    nights integer,
    persons integer,
    invoice_number text not null,
    status text default 'draft'::text not null,
    net_amount numeric(12,2) default 0 not null,
    vat_rate numeric(5,2) default 0,
    gross_amount numeric(12,2) default 0 not null,
    created_at timestamp with time zone default now(),
    move_in date,
    move_out date,
    positions jsonb default '[]'::jsonb,
    sender_name text,
    sender_street text,
    sender_zip text,
    sender_city text,
    recipient_name text,
    recipient_street text,
    recipient_zip text,
    recipient_city text,
    vat_amount numeric(10,2) default 0 not null,
    constraint invoices_pkey PRIMARY KEY (id),
    constraint invoices_user_id_invoice_number_portfolio_id_key UNIQUE (user_id, invoice_number, portfolio_id),
    constraint invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'credited'::text, 'credit_note'::text])))
);
create table public.lease_cloud_folders (
    lease_id uuid not null,
    cloud_connection_id uuid not null,
    user_id uuid not null,
    folder_path text not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    constraint lease_cloud_folders_pkey PRIMARY KEY (lease_id, cloud_connection_id),
    constraint lease_cloud_folders_path_check CHECK ((((char_length(folder_path) >= 1) AND (char_length(folder_path) <= 2000)) AND (folder_path !~ '^/'::text) AND (folder_path !~ '/$'::text) AND (folder_path !~ '//'::text) AND (folder_path !~ '(^|/)\.{1,2}(/|$)'::text) AND (folder_path !~ '[[:cntrl:]]'::text)))
);
create table public.lease_notes (
    lease_id uuid not null,
    notes text default ''::text not null,
    updated_at timestamp with time zone default now() not null,
    updated_by uuid,
    constraint lease_notes_pkey PRIMARY KEY (lease_id),
    constraint lease_notes_length CHECK ((char_length(notes) <= 20000))
);
create table public.lease_rent_periods (
    id uuid default gen_random_uuid() not null,
    lease_id uuid not null,
    valid_from date not null,
    cold_rent numeric default 0 not null,
    service_charge numeric default 0 not null,
    heating_cost numeric default 0 not null,
    other_costs numeric default 0 not null,
    payment_due_day integer default 3 not null,
    created_by uuid default auth.uid(),
    created_at timestamp with time zone default now() not null,
    constraint lease_rent_periods_pkey PRIMARY KEY (id),
    constraint lease_rent_periods_amounts_check CHECK (((cold_rent >= (0)::numeric) AND (service_charge >= (0)::numeric) AND (heating_cost >= (0)::numeric) AND (other_costs >= (0)::numeric))),
    constraint lease_rent_periods_due_day_check CHECK (((payment_due_day >= 1) AND (payment_due_day <= 31)))
);
create table public.leases (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    unit_id uuid not null,
    tenant_id uuid,
    start_date date not null,
    end_date date,
    cold_rent numeric(12,2) default 0 not null,
    service_charge numeric(12,2) default 0 not null,
    heating_cost numeric(12,2) default 0 not null,
    other_costs numeric(12,2) default 0 not null,
    payment_due_day integer default 3 not null,
    status text default 'active'::text not null,
    created_at timestamp with time zone default now(),
    deposit numeric,
    last_rent_increase date,
    lease_type text default 'normal'::text,
    booking_start_date date,
    constraint leases_pkey PRIMARY KEY (id),
    constraint leases_end_after_start CHECK (((end_date IS NULL) OR (end_date >= start_date)))
);
create table public.loans (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    property_id uuid,
    bank_name text not null,
    account_number text,
    loan_amount numeric(15,2),
    start_date date not null,
    end_date date not null,
    interest_rate numeric(10,6) not null,
    initial_repayment_rate numeric(10,6),
    fixed_annuity numeric(15,2),
    current_debt numeric(15,2),
    notes text,
    actual_residual_debt numeric,
    actual_residual_debt_date date,
    economic_unit_id uuid,
    constraint loans_pkey PRIMARY KEY (id),
    constraint loans_interest_rate_check CHECK ((interest_rate >= (0)::numeric))
);
create table public.messages (
    id uuid default gen_random_uuid() not null,
    sender_id uuid not null,
    receiver_id uuid not null,
    ticket_id uuid,
    text text,
    attachment_url text,
    is_system boolean default false,
    read boolean default false,
    created_at timestamp with time zone default now(),
    constraint messages_pkey PRIMARY KEY (id)
);
create table public.meter_readings (
    id uuid default gen_random_uuid() not null,
    meter_id uuid not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    reading_value numeric not null,
    reading_date date default CURRENT_DATE not null,
    note text,
    created_at timestamp with time zone default now(),
    constraint meter_readings_pkey PRIMARY KEY (id)
);
create table public.meters (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    property_id uuid not null,
    unit_id uuid,
    meter_number text not null,
    meter_type text,
    unit text,
    meter_name text,
    location text,
    supplier text,
    contract_number text,
    notes text,
    last_reading_value numeric,
    last_reading_date date,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint meters_pkey PRIMARY KEY (id),
    constraint meters_meter_type_check CHECK ((meter_type = ANY (ARRAY['Strom'::text, 'Kaltwasser'::text, 'Warmwasser'::text, 'Gas'::text, 'Wärmemengen'::text, 'Sonstiges'::text]))),
    constraint meters_unit_check CHECK ((unit = ANY (ARRAY['kWh'::text, 'Wh'::text, 'm³'::text, 'Liter'::text, 'sonstiges'::text])))
);
create table public.objektkalender_events (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid not null,
    event_type text not null,
    title text not null,
    color text default '#3b82f6'::text,
    event_date date not null,
    recurring boolean default false,
    recurrence_rule text,
    recurring_end_date date,
    assigned_unit_id uuid,
    assigned_unit_name text,
    waste_type text,
    status text default 'pending'::text,
    completed_at timestamp with time zone,
    completed_by uuid,
    push_enabled boolean default true,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint objektkalender_events_pkey PRIMARY KEY (id),
    constraint objektkalender_events_color_check CHECK (((color IS NULL) OR (color ~ '^#[0-9A-Fa-f]{6}$'::text))),
    constraint objektkalender_events_event_type_check CHECK ((event_type = ANY (ARRAY['cleaning'::text, 'waste'::text, 'custom'::text]))),
    constraint objektkalender_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'overdue'::text]))),
    constraint objektkalender_events_waste_type_check CHECK (((waste_type = ANY (ARRAY['restmuell'::text, 'bio'::text, 'papier'::text, 'gelbe_tonne'::text, 'sonstiger'::text])) OR (waste_type IS NULL)))
);
create table public.objektkalender_history (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid not null,
    event_id uuid,
    event_type text not null,
    title text not null,
    event_date date not null,
    assigned_unit_name text,
    status text not null,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_at timestamp with time zone default now(),
    constraint objektkalender_history_pkey PRIMARY KEY (id)
);
create table public.objektkalender_settings (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid not null,
    cleaning_active boolean default false,
    cleaning_performer text default 'tenant'::text,
    cleaning_frequency text default 'monthly'::text,
    cleaning_weekday integer default 1 not null,
    waste_active boolean default false,
    waste_performer text default 'tenant'::text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint objektkalender_settings_pkey PRIMARY KEY (id),
    constraint objektkalender_settings_user_id_property_id_key UNIQUE (user_id, property_id),
    constraint objektkalender_settings_cleaning_frequency_check CHECK ((cleaning_frequency = ANY (ARRAY['monthly'::text, 'bimonthly'::text, 'weekly4'::text, 'weekly'::text]))),
    constraint objektkalender_settings_cleaning_performer_check CHECK ((cleaning_performer = ANY (ARRAY['tenant'::text, 'janitor'::text]))),
    constraint objektkalender_settings_cleaning_weekday_check CHECK (((cleaning_weekday >= 0) AND (cleaning_weekday <= 6))),
    constraint objektkalender_settings_waste_performer_check CHECK ((waste_performer = ANY (ARRAY['tenant'::text, 'janitor'::text])))
);
create table public.payment_plan_installments (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    payment_plan_id uuid not null,
    due_date date not null,
    amount numeric(12,2) not null,
    paid_amount numeric(12,2) default 0 not null,
    open_amount numeric(12,2) generated always as ((amount - paid_amount)) stored,
    status text default 'open'::text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint payment_plan_installments_pkey PRIMARY KEY (id),
    constraint payment_plan_installments_open_amount_check CHECK ((open_amount >= (0)::numeric)),
    constraint payment_plan_installments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text, 'partial'::text, 'overdue'::text, 'cancelled'::text])))
);
create table public.payment_plan_requests (
    id uuid default extensions.uuid_generate_v4() not null,
    claim_id uuid not null,
    access_link_id uuid,
    status text default 'requested'::text not null,
    requested_months integer not null,
    requested_rate numeric(10,2) not null,
    requested_total numeric(10,2) not null,
    adjustment_amount numeric(10,2) default 0,
    tenant_message text,
    created_at timestamp with time zone default now() not null,
    decided_at timestamp with time zone,
    decided_by uuid,
    constraint payment_plan_requests_pkey PRIMARY KEY (id),
    constraint payment_plan_requests_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text])))
);
create table public.payment_plans (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    claim_id uuid not null,
    status text default 'active'::text not null,
    plan_type text default 'installment_agreement'::text not null,
    total_amount numeric(12,2) not null,
    interest_or_fee_adjustment numeric(12,2) default 0 not null,
    monthly_rate numeric(12,2),
    first_due_date date,
    last_due_date date,
    requested_at timestamp with time zone,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancellation_reason text,
    fees_at_creation numeric(12,2) default 0 not null,
    interest_at_creation numeric(12,2) default 0 not null,
    constraint payment_plans_pkey PRIMARY KEY (id),
    constraint payment_plans_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'active'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);
create table public.pdf_templates (
    id uuid default gen_random_uuid() not null,
    portfolio_id uuid not null,
    user_id uuid not null,
    margin_mm integer default 15 not null,
    header_height_mm integer default 50 not null,
    footer_height_mm integer default 20 not null,
    accent_color text default '#0ea5e9'::text,
    elements jsonb default '[]'::jsonb,
    subtitles_by_report_type jsonb default '{}'::jsonb,
    logo_url text,
    updated_at timestamp with time zone default now(),
    updated_by uuid,
    created_at timestamp with time zone default now(),
    orientation_by_report_type jsonb default '{}'::jsonb,
    elements_by_report_orientation jsonb default '{}'::jsonb,
    constraint pdf_templates_pkey PRIMARY KEY (id),
    constraint pdf_templates_portfolio_id_key UNIQUE (portfolio_id)
);
create table public.portfolio_cloud_links (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    cloud_connection_id uuid not null,
    folder_id text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint portfolio_cloud_links_pkey PRIMARY KEY (id),
    constraint portfolio_cloud_links_user_id_portfolio_id_key UNIQUE (user_id, portfolio_id)
);
create table public.portfolio_shares (
    id uuid default gen_random_uuid() not null,
    portfolio_id uuid not null,
    shared_with_email text not null,
    permissions jsonb default '{}'::jsonb not null,
    status text default 'pending'::text not null,
    created_by uuid not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint portfolio_shares_pkey PRIMARY KEY (id),
    constraint portfolio_shares_portfolio_id_shared_with_email_key UNIQUE (portfolio_id, shared_with_email)
);
create table public.portfolios (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    name text not null,
    entity_type text default 'private'::text not null,
    ownership_percent numeric(5,2) default 100 not null,
    created_at timestamp with time zone default now(),
    company_name text,
    street text,
    house_number text,
    zip text,
    city text,
    email text,
    phone text,
    bank_name text,
    iban text,
    bic text,
    tax_number text,
    vat_id text,
    is_primary boolean default false,
    is_small_business boolean default false not null,
    constraint portfolios_pkey PRIMARY KEY (id)
);
create table public.profiles (
    id uuid not null,
    email text,
    created_at timestamp with time zone default now(),
    salutation text,
    name_suffix text,
    company text,
    first_name text,
    last_name text,
    street text,
    house_number text,
    zip text,
    city text,
    phone text,
    mobile text,
    bank_name text,
    iban text,
    bic text,
    tax_number text,
    vat_id text,
    updated_at timestamp with time zone default timezone('utc'::text, now()),
    settings_opening_hours_visible boolean default true,
    settings_opening_hours_text text default 'Mo-Fr 9:00 - 17:00 Uhr'::text,
    portfolio_name text,
    ownership_percent numeric,
    onboarding_complete boolean default false,
    claim_portal_allow_installments boolean default true,
    claim_portal_installment_max_months integer default 12,
    claim_portal_installment_surcharge_percent numeric(5,2) default 7.00,
    claim_portal_installment_options jsonb default '[{"months": 3, "surcharge_percent": 7}, {"months": 6, "surcharge_percent": 9}, {"months": 12, "surcharge_percent": 12}]'::jsonb,
    stripe_connect_id text,
    stripe_connect_enabled boolean default false,
    claim_portal_allow_stripe boolean default true,
    bank_account_holder text,
    constraint profiles_pkey PRIMARY KEY (id)
);
create table public.properties (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    portfolio_id uuid not null,
    street text not null,
    house_number text not null,
    zip text,
    city text,
    object_key text generated always as (((street || ' '::text) || house_number)) stored,
    created_at timestamp with time zone default now(),
    construction_year integer,
    property_type text default 'residential'::text,
    market_value_total numeric default 0,
    market_value_per_sqm numeric default 0,
    total_investment_cost numeric default 0,
    equity_invested numeric default 0,
    location_score_total integer default 5,
    dd_condition_exterior integer default 0,
    dd_condition_roof integer default 0,
    dd_condition_staircase integer default 0,
    dd_condition_units integer default 0,
    dd_condition_heating integer default 0,
    dd_energy_basement_ceiling integer default 0,
    dd_energy_attic_roof integer default 0,
    dd_energy_facade integer default 0,
    dd_energy_windows integer default 0,
    dd_energy_heating integer default 0,
    building_share_percent numeric default 80,
    afa_percent numeric default 2,
    economic_unit_id uuid,
    thumbnail_image text,
    constraint properties_pkey PRIMARY KEY (id)
);
create table public.push_subscriptions (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    fcm_token text not null,
    device_info text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint push_subscriptions_pkey PRIMARY KEY (id),
    constraint push_subscriptions_user_id_fcm_token_key UNIQUE (user_id, fcm_token)
);
create table public.renovation_calc_subtrades (
    id uuid default gen_random_uuid() not null,
    calc_trade_id uuid not null,
    user_id uuid not null,
    name text not null,
    quantity numeric default 0,
    unit_label text default 'Stk.'::text,
    unit_price numeric default 0,
    total_price numeric default 0,
    sort_order integer default 0,
    created_at timestamp with time zone default now(),
    constraint renovation_calc_subtrades_pkey PRIMARY KEY (id)
);
create table public.renovation_calc_trades (
    id uuid default gen_random_uuid() not null,
    calculation_id uuid not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    created_at timestamp with time zone default now(),
    constraint renovation_calc_trades_pkey PRIMARY KEY (id)
);
create table public.renovation_calculations (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid,
    unit_id uuid,
    name text not null,
    calc_type text default 'buy_and_hold'::text not null,
    status text default 'draft'::text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    building_config jsonb default '{}'::jsonb,
    total_cost numeric default 0,
    constraint renovation_calculations_pkey PRIMARY KEY (id),
    constraint renovation_calculations_calc_type_check CHECK ((calc_type = ANY (ARRAY['buy_and_hold'::text, 'fix_and_flip'::text]))),
    constraint renovation_calculations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'final'::text])))
);
create table public.renovation_invoices (
    id uuid default gen_random_uuid() not null,
    project_subtrade_id uuid not null,
    project_id uuid not null,
    user_id uuid not null,
    date date default CURRENT_DATE not null,
    amount numeric default 0 not null,
    note text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid default auth.uid(),
    constraint renovation_invoices_pkey PRIMARY KEY (id)
);
create table public.renovation_milestone_templates (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    is_completion_trigger boolean default false,
    created_at timestamp with time zone default now(),
    constraint renovation_milestone_templates_pkey PRIMARY KEY (id)
);
create table public.renovation_milestones (
    id uuid default gen_random_uuid() not null,
    project_trade_id uuid not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    is_completed boolean default false,
    is_completion_trigger boolean default false,
    completed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    constraint renovation_milestones_pkey PRIMARY KEY (id)
);
create table public.renovation_project_subtrades (
    id uuid default gen_random_uuid() not null,
    project_trade_id uuid not null,
    project_id uuid not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    budget_soll numeric default 0,
    quantity numeric,
    unit_label text,
    responsible_contact_id uuid,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint renovation_project_subtrades_pkey PRIMARY KEY (id)
);
create table public.renovation_project_trades (
    id uuid default gen_random_uuid() not null,
    project_id uuid not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    start_date date,
    end_date date,
    depends_on uuid,
    status text default 'open'::text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint renovation_project_trades_pkey PRIMARY KEY (id),
    constraint renovation_project_trades_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text])))
);
create table public.renovation_projects (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid not null,
    unit_id uuid,
    name text not null,
    status text default 'planned'::text not null,
    target_end_date date,
    budget_buffer_percent numeric default 10,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    gik_transferred_amount numeric default 0,
    created_by uuid default auth.uid(),
    constraint renovation_projects_pkey PRIMARY KEY (id),
    constraint renovation_projects_gik_transferred_amount_check CHECK (((gik_transferred_amount IS NULL) OR (gik_transferred_amount >= (0)::numeric))),
    constraint renovation_projects_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'active'::text, 'completed'::text, 'archived'::text])))
);
create table public.renovation_subtrades (
    id uuid default gen_random_uuid() not null,
    trade_id uuid not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    created_at timestamp with time zone default now(),
    default_quantity numeric default 0,
    default_unit_label text default 'Stk.'::text,
    default_unit_price numeric default 0,
    positions jsonb default '[]'::jsonb,
    constraint renovation_subtrades_pkey PRIMARY KEY (id)
);
create table public.renovation_tasks (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    project_id uuid not null,
    project_trade_id uuid,
    property_id uuid,
    title text not null,
    description text,
    is_completed boolean default false,
    due_date date,
    completed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid default auth.uid(),
    constraint renovation_tasks_pkey PRIMARY KEY (id)
);
create table public.renovation_trades (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    name text not null,
    sort_order integer default 0,
    created_at timestamp with time zone default now(),
    constraint renovation_trades_pkey PRIMARY KEY (id)
);
create table public.rent_charges (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    lease_id uuid not null,
    period_month date not null,
    due_date date,
    amount numeric(12,2) not null,
    status text default 'open'::text not null,
    created_at timestamp with time zone default now(),
    constraint rent_charges_pkey PRIMARY KEY (id),
    constraint rent_charges_lease_id_period_month_key UNIQUE (lease_id, period_month)
);
create table public.rent_ledger (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    user_id uuid not null,
    lease_id uuid not null,
    period_month date not null,
    due_date date,
    expected_rent numeric(10,2) default 0 not null,
    paid_amount numeric(10,2) default 0 not null,
    status text default 'open'::text not null,
    note text,
    constraint rent_ledger_pkey PRIMARY KEY (id),
    constraint rent_ledger_lease_id_period_month_key UNIQUE (lease_id, period_month),
    constraint rent_ledger_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text, 'loss'::text])))
);
create table public.rent_payments (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    lease_id uuid not null,
    payment_date date not null,
    period_month date,
    amount numeric(12,2) not null,
    note text,
    created_at timestamp with time zone default now(),
    claim_payment_id uuid,
    constraint rent_payments_pkey PRIMARY KEY (id)
);
create table public.rental_applicants (
    id uuid default gen_random_uuid() not null,
    process_id uuid not null,
    user_id uuid not null,
    status text default 'applied'::text not null,
    earliest_move_in date,
    salutation text,
    first_name text,
    last_name text,
    birth_date date,
    marital_status text,
    phone text,
    email text,
    introduction text,
    has_co_applicant boolean default false,
    co_salutation text,
    co_first_name text,
    co_last_name text,
    co_birth_date date,
    co_relationship text,
    co_email text,
    co_phone text,
    additional_persons_count integer default 0,
    is_employed boolean default false,
    monthly_income numeric(10,2),
    co_is_employed boolean default false,
    co_monthly_income numeric(10,2),
    street text,
    house_number text,
    postal_code text,
    city text,
    has_rent_arrears boolean default false,
    has_eviction_lawsuits boolean default false,
    has_insolvency_proceedings boolean default false,
    receives_social_benefits boolean default false,
    has_pets boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    received_mail_sent_at timestamp with time zone,
    constraint rental_applicants_pkey PRIMARY KEY (id),
    constraint rental_applicants_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'invited'::text, 'declined'::text, 'accepted'::text, 'contract_requested'::text, 'contract_declined'::text])))
);
create table public.rental_processes (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    unit_id uuid not null,
    status text default 'kein_prozess'::text not null,
    token text not null,
    listing_title text,
    listing_description text,
    listing_link text,
    required_documents text[] default '{}'::text[],
    custom_requirements text[] default '{}'::text[],
    rented_at timestamp with time zone,
    lease_start_date date,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint rental_processes_pkey PRIMARY KEY (id),
    constraint rental_processes_token_key UNIQUE (token),
    constraint rental_processes_status_check CHECK ((status = ANY (ARRAY['kein_prozess'::text, 'in_vermietung'::text, 'vermietet'::text])))
);
create table public.rental_viewing_bookings (
    id uuid default gen_random_uuid() not null,
    viewing_id uuid not null,
    applicant_id uuid not null,
    start_time time without time zone not null,
    end_time time without time zone not null,
    status text default 'booked'::text not null,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    confirmed_mail_sent_at timestamp with time zone,
    canceled_mail_sent_at timestamp with time zone,
    constraint rental_viewing_bookings_pkey PRIMARY KEY (id),
    constraint rental_viewing_bookings_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'canceled'::text])))
);
create table public.rental_viewings (
    id uuid default gen_random_uuid() not null,
    process_id uuid not null,
    user_id uuid not null,
    date date not null,
    start_time time without time zone not null,
    end_time time without time zone not null,
    slot_duration_minutes integer default 15 not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint rental_viewings_pkey PRIMARY KEY (id),
    constraint rental_viewings_slot_duration_check CHECK ((slot_duration_minutes > 0))
);
create table public.stripe_webhook_events (
    event_id text not null,
    event_type text not null,
    livemode boolean,
    connect_account text,
    stripe_created_at timestamp with time zone,
    status text default 'processing'::text not null,
    attempts integer default 1 not null,
    outcome text,
    last_error text,
    received_at timestamp with time zone default now() not null,
    started_at timestamp with time zone default now() not null,
    processed_at timestamp with time zone,
    constraint stripe_webhook_events_pkey PRIMARY KEY (event_id),
    constraint stripe_webhook_events_account_check CHECK (((connect_account IS NULL) OR (connect_account ~ '^acct_[A-Za-z0-9]{1,255}$'::text))),
    constraint stripe_webhook_events_attempts_check CHECK ((attempts >= 1)),
    constraint stripe_webhook_events_error_check CHECK (((last_error IS NULL) OR (char_length(last_error) <= 500))),
    constraint stripe_webhook_events_event_id_check CHECK ((event_id ~ '^evt_[A-Za-z0-9]{1,255}$'::text)),
    constraint stripe_webhook_events_event_type_check CHECK (((char_length(event_type) >= 1) AND (char_length(event_type) <= 100))),
    constraint stripe_webhook_events_outcome_check CHECK (((outcome IS NULL) OR (outcome ~ '^[a-z_]{1,100}$'::text))),
    constraint stripe_webhook_events_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'processed'::text, 'failed'::text])))
);
create table public.subscriptions (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    plan text not null,
    status text not null,
    trial_ends_at timestamp with time zone,
    current_period_end timestamp with time zone,
    stripe_customer_id text,
    stripe_subscription_id text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    cancel_at_period_end boolean default false not null,
    constraint subscriptions_pkey PRIMARY KEY (id),
    constraint subscriptions_user_id_key UNIQUE (user_id)
);
create table public.tenant_change_log (
    id uuid default gen_random_uuid() not null,
    tenant_id uuid not null,
    link_id uuid,
    source text default 'token_link'::text not null,
    old_values jsonb default '{}'::jsonb not null,
    new_values jsonb default '{}'::jsonb not null,
    created_at timestamp with time zone default now() not null,
    constraint tenant_change_log_pkey PRIMARY KEY (id)
);
create table public.tenant_invitations (
    id uuid default gen_random_uuid() not null,
    email text not null,
    tenant_id uuid,
    unit_id uuid,
    property_id uuid,
    invited_by uuid,
    status text default 'pending'::text,
    created_at timestamp with time zone default now(),
    constraint tenant_invitations_pkey PRIMARY KEY (id),
    constraint tenant_invitations_email_tenant_id_key UNIQUE (email, tenant_id),
    constraint tenant_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text])))
);
create table public.tenant_verification_links (
    id uuid default gen_random_uuid() not null,
    tenant_id uuid not null,
    token text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    expires_at timestamp with time zone not null,
    is_updated boolean default false not null,
    updated_at timestamp with time zone,
    created_by uuid,
    token_hash text,
    constraint tenant_verification_links_pkey PRIMARY KEY (id),
    constraint tenant_verification_links_token_key UNIQUE (token)
);
create table public.tenants (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    first_name text,
    last_name text,
    phone text,
    email text,
    occupants integer,
    created_at timestamp with time zone default now(),
    street text,
    house_number text,
    postal_code text,
    city text,
    salutation text,
    constraint tenants_pkey PRIMARY KEY (id),
    constraint tenants_salutation_check CHECK (((salutation IS NULL) OR (salutation = ANY (ARRAY['female'::text, 'male'::text, 'diverse'::text]))))
);
create table public.tickets (
    id uuid default gen_random_uuid() not null,
    unit_id uuid not null,
    property_id uuid not null,
    tenant_user_id uuid not null,
    title text not null,
    description text,
    status text default 'received'::text not null,
    priority text default 'normal'::text,
    images text[] default '{}'::text[],
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    constraint tickets_pkey PRIMARY KEY (id),
    constraint tickets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    constraint tickets_status_check CHECK ((status = ANY (ARRAY['received'::text, 'in_progress'::text, 'completed'::text])))
);
create table public.units (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid not null,
    unit_name text not null,
    floor text,
    sqm numeric(10,2),
    rooms numeric(5,2),
    bathrooms integer,
    bedrooms integer,
    balcony boolean default false,
    fitted_kitchen boolean default false,
    is_vacation_rental boolean default false,
    created_at timestamp with time zone default now(),
    target_rent numeric,
    ownership_share numeric default 0,
    cold_rent_ist numeric,
    service_charge_soll numeric,
    heating_cost_soll numeric,
    other_costs_soll numeric,
    deposit_soll numeric,
    thumbnail_image text,
    constraint units_pkey PRIMARY KEY (id)
);
create table public.user_roles (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    role text not null,
    tenant_id uuid,
    unit_id uuid,
    property_id uuid,
    created_at timestamp with time zone default now(),
    constraint user_roles_pkey PRIMARY KEY (id),
    constraint user_roles_user_id_key UNIQUE (user_id),
    constraint user_roles_role_check CHECK ((role = ANY (ARRAY['investor'::text, 'tenant'::text])))
);
create table public.user_smtp_settings (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    smtp_host text not null,
    smtp_port integer default 587 not null,
    smtp_user text not null,
    smtp_pass text,
    smtp_sender text not null,
    created_at timestamp with time zone default CURRENT_TIMESTAMP,
    updated_at timestamp with time zone default CURRENT_TIMESTAMP,
    smtp_pass_secret_id uuid,
    constraint user_smtp_settings_pkey PRIMARY KEY (id),
    constraint user_smtp_settings_user_id_key UNIQUE (user_id),
    constraint user_smtp_settings_no_plaintext_pass CHECK ((smtp_pass IS NULL))
);
create table public.utility_settlements (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    property_id uuid,
    period_start date not null,
    period_end date not null,
    status text default 'draft'::text not null,
    data jsonb default '{}'::jsonb,
    year integer,
    created_at timestamp with time zone default now(),
    economic_unit_id uuid,
    calculation_snapshot jsonb,
    constraint utility_settlements_pkey PRIMARY KEY (id),
    constraint utility_settlements_scope_check CHECK (((property_id IS NOT NULL) OR (economic_unit_id IS NOT NULL))),
    constraint utility_settlements_snapshot_is_object CHECK (((calculation_snapshot IS NULL) OR (jsonb_typeof(calculation_snapshot) = 'object'::text))),
    constraint utility_settlements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'done'::text])))
);

-- -----------------------------------------------------------------------------
-- 4 · Fremdschlüssel
-- -----------------------------------------------------------------------------
alter table public.announcements add constraint announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.announcements add constraint announcements_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.bank_connections add constraint bank_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.bank_matching_rules add constraint bank_matching_rules_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.bank_matching_rules add constraint bank_matching_rules_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.bank_matching_rules add constraint bank_matching_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.bank_transactions add constraint bank_transactions_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.bank_connections(id) ON DELETE RESTRICT;
alter table public.bank_transactions add constraint bank_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.claim_access_links add constraint claim_access_links_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;
alter table public.claim_access_links add constraint claim_access_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.claim_events add constraint claim_events_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.claim_events add constraint claim_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;
alter table public.claim_events add constraint claim_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.claim_items add constraint claim_items_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.claim_items add constraint claim_items_rent_ledger_id_fkey FOREIGN KEY (rent_ledger_id) REFERENCES public.rent_ledger(id) ON DELETE SET NULL;
alter table public.claim_items add constraint claim_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.claim_payment_allocations add constraint claim_payment_allocations_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.claim_payment_allocations add constraint claim_payment_allocations_claim_item_id_fkey FOREIGN KEY (claim_item_id) REFERENCES public.claim_items(id) ON DELETE RESTRICT;
alter table public.claim_payment_allocations add constraint claim_payment_allocations_claim_payment_id_fkey FOREIGN KEY (claim_payment_id) REFERENCES public.claim_payments(id) ON DELETE RESTRICT;
alter table public.claim_payment_allocations add constraint claim_payment_allocations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.claim_payments add constraint claim_payments_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.claim_payments add constraint claim_payments_rent_payment_id_fkey FOREIGN KEY (rent_payment_id) REFERENCES public.rent_payments(id) ON DELETE SET NULL;
alter table public.claim_payments add constraint claim_payments_reversal_reference_id_fkey FOREIGN KEY (reversal_reference_id) REFERENCES public.claim_payments(id);
alter table public.claim_payments add constraint claim_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.claims add constraint claims_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);
alter table public.claims add constraint claims_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE RESTRICT;
alter table public.claims add constraint claims_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
alter table public.claims add constraint claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.cloud_connections add constraint cloud_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.contacts add constraint contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
alter table public.contacts add constraint contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.deals add constraint deals_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE SET NULL;
alter table public.deals add constraint deals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.distribution_keys add constraint distribution_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.document_templates add constraint document_templates_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.document_templates add constraint document_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);
alter table public.documents add constraint documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.documents add constraint documents_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id);
alter table public.documents add constraint documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.economic_units add constraint economic_units_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.expense_categories add constraint expense_categories_distribution_key_id_fkey FOREIGN KEY (distribution_key_id) REFERENCES public.distribution_keys(id) ON DELETE SET NULL;
alter table public.expense_categories add constraint expense_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.expenses add constraint expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.floor_plans add constraint floor_plans_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.floor_plans add constraint floor_plans_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.floor_plans add constraint floor_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.invoice_counters add constraint invoice_counters_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.invoice_counters add constraint invoice_counters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE RESTRICT;
alter table public.invoices add constraint invoices_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.lease_cloud_folders add constraint lease_cloud_folders_cloud_connection_id_fkey FOREIGN KEY (cloud_connection_id) REFERENCES public.cloud_connections(id) ON DELETE CASCADE;
alter table public.lease_cloud_folders add constraint lease_cloud_folders_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;
alter table public.lease_cloud_folders add constraint lease_cloud_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.lease_notes add constraint lease_notes_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;
alter table public.lease_notes add constraint lease_notes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.lease_rent_periods add constraint lease_rent_periods_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.lease_rent_periods add constraint lease_rent_periods_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;
alter table public.leases add constraint leases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
alter table public.leases add constraint leases_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT;
alter table public.leases add constraint leases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.loans add constraint loans_economic_unit_id_fkey FOREIGN KEY (economic_unit_id) REFERENCES public.economic_units(id) ON DELETE RESTRICT;
alter table public.loans add constraint loans_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id);
alter table public.loans add constraint loans_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);
alter table public.loans add constraint loans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;
alter table public.meter_readings add constraint meter_readings_meter_id_fkey FOREIGN KEY (meter_id) REFERENCES public.meters(id) ON DELETE CASCADE;
alter table public.meter_readings add constraint meter_readings_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.meter_readings add constraint meter_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.meters add constraint meters_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.meters add constraint meters_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.meters add constraint meters_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.meters add constraint meters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.objektkalender_events add constraint objektkalender_events_assigned_unit_id_fkey FOREIGN KEY (assigned_unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.objektkalender_events add constraint objektkalender_events_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.objektkalender_events add constraint objektkalender_events_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.objektkalender_events add constraint objektkalender_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.objektkalender_history add constraint objektkalender_history_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.objektkalender_events(id) ON DELETE SET NULL;
alter table public.objektkalender_history add constraint objektkalender_history_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.objektkalender_history add constraint objektkalender_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.objektkalender_settings add constraint objektkalender_settings_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.objektkalender_settings add constraint objektkalender_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.payment_plan_installments add constraint payment_plan_installments_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES public.payment_plans(id) ON DELETE RESTRICT;
alter table public.payment_plan_installments add constraint payment_plan_installments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.payment_plan_requests add constraint payment_plan_requests_access_link_id_fkey FOREIGN KEY (access_link_id) REFERENCES public.claim_access_links(id) ON DELETE SET NULL;
alter table public.payment_plan_requests add constraint payment_plan_requests_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.payment_plan_requests add constraint payment_plan_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);
alter table public.payment_plans add constraint payment_plans_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);
alter table public.payment_plans add constraint payment_plans_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE RESTRICT;
alter table public.payment_plans add constraint payment_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.pdf_templates add constraint pdf_templates_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.pdf_templates add constraint pdf_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.pdf_templates add constraint pdf_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.portfolio_cloud_links add constraint portfolio_cloud_links_cloud_connection_id_fkey FOREIGN KEY (cloud_connection_id) REFERENCES public.cloud_connections(id) ON DELETE CASCADE;
alter table public.portfolio_cloud_links add constraint portfolio_cloud_links_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.portfolio_cloud_links add constraint portfolio_cloud_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.portfolio_shares add constraint portfolio_shares_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.portfolio_shares add constraint portfolio_shares_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.portfolios add constraint portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.properties add constraint properties_economic_unit_id_fkey FOREIGN KEY (economic_unit_id) REFERENCES public.economic_units(id) ON DELETE SET NULL;
alter table public.properties add constraint properties_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
alter table public.properties add constraint properties_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_calc_subtrades add constraint renovation_calc_subtrades_calc_trade_id_fkey FOREIGN KEY (calc_trade_id) REFERENCES public.renovation_calc_trades(id) ON DELETE CASCADE;
alter table public.renovation_calc_subtrades add constraint renovation_calc_subtrades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_calc_trades add constraint renovation_calc_trades_calculation_id_fkey FOREIGN KEY (calculation_id) REFERENCES public.renovation_calculations(id) ON DELETE CASCADE;
alter table public.renovation_calc_trades add constraint renovation_calc_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_calculations add constraint renovation_calculations_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.renovation_calculations add constraint renovation_calculations_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.renovation_calculations add constraint renovation_calculations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_invoices add constraint renovation_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.renovation_invoices add constraint renovation_invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.renovation_projects(id) ON DELETE CASCADE;
alter table public.renovation_invoices add constraint renovation_invoices_project_subtrade_id_fkey FOREIGN KEY (project_subtrade_id) REFERENCES public.renovation_project_subtrades(id) ON DELETE CASCADE;
alter table public.renovation_invoices add constraint renovation_invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_milestone_templates add constraint renovation_milestone_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_milestones add constraint renovation_milestones_project_trade_id_fkey FOREIGN KEY (project_trade_id) REFERENCES public.renovation_project_trades(id) ON DELETE CASCADE;
alter table public.renovation_milestones add constraint renovation_milestones_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_project_subtrades add constraint renovation_project_subtrades_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.renovation_projects(id) ON DELETE CASCADE;
alter table public.renovation_project_subtrades add constraint renovation_project_subtrades_project_trade_id_fkey FOREIGN KEY (project_trade_id) REFERENCES public.renovation_project_trades(id) ON DELETE CASCADE;
alter table public.renovation_project_subtrades add constraint renovation_project_subtrades_responsible_contact_id_fkey FOREIGN KEY (responsible_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
alter table public.renovation_project_subtrades add constraint renovation_project_subtrades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_project_trades add constraint renovation_project_trades_depends_on_fkey FOREIGN KEY (depends_on) REFERENCES public.renovation_project_trades(id) ON DELETE SET NULL;
alter table public.renovation_project_trades add constraint renovation_project_trades_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.renovation_projects(id) ON DELETE CASCADE;
alter table public.renovation_project_trades add constraint renovation_project_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_projects add constraint renovation_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.renovation_projects add constraint renovation_projects_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.renovation_projects add constraint renovation_projects_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.renovation_projects add constraint renovation_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_subtrades add constraint renovation_subtrades_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.renovation_trades(id) ON DELETE CASCADE;
alter table public.renovation_subtrades add constraint renovation_subtrades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_tasks add constraint renovation_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.renovation_tasks add constraint renovation_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.renovation_projects(id) ON DELETE CASCADE;
alter table public.renovation_tasks add constraint renovation_tasks_project_trade_id_fkey FOREIGN KEY (project_trade_id) REFERENCES public.renovation_project_trades(id) ON DELETE SET NULL;
alter table public.renovation_tasks add constraint renovation_tasks_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.renovation_tasks add constraint renovation_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.renovation_trades add constraint renovation_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rent_charges add constraint rent_charges_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE CASCADE;
alter table public.rent_charges add constraint rent_charges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rent_ledger add constraint rent_ledger_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE RESTRICT;
alter table public.rent_ledger add constraint rent_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rent_payments add constraint rent_payments_claim_payment_id_fkey FOREIGN KEY (claim_payment_id) REFERENCES public.claim_payments(id) ON DELETE RESTRICT;
alter table public.rent_payments add constraint rent_payments_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.leases(id) ON DELETE RESTRICT;
alter table public.rent_payments add constraint rent_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rental_applicants add constraint rental_applicants_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.rental_processes(id) ON DELETE CASCADE;
alter table public.rental_applicants add constraint rental_applicants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rental_processes add constraint rental_processes_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;
alter table public.rental_processes add constraint rental_processes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rental_viewing_bookings add constraint rental_viewing_bookings_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.rental_applicants(id) ON DELETE CASCADE;
alter table public.rental_viewing_bookings add constraint rental_viewing_bookings_viewing_id_fkey FOREIGN KEY (viewing_id) REFERENCES public.rental_viewings(id) ON DELETE CASCADE;
alter table public.rental_viewings add constraint rental_viewings_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.rental_processes(id) ON DELETE CASCADE;
alter table public.rental_viewings add constraint rental_viewings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.subscriptions add constraint subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tenant_change_log add constraint tenant_change_log_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.tenant_verification_links(id) ON DELETE SET NULL;
alter table public.tenant_change_log add constraint tenant_change_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.tenant_invitations add constraint tenant_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.tenant_invitations add constraint tenant_invitations_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.tenant_invitations add constraint tenant_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.tenant_invitations add constraint tenant_invitations_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.tenant_verification_links add constraint tenant_verification_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.tenant_verification_links add constraint tenant_verification_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.tenants add constraint tenants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tickets add constraint tickets_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.tickets add constraint tickets_tenant_user_id_fkey FOREIGN KEY (tenant_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tickets add constraint tickets_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;
alter table public.units add constraint units_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;
alter table public.units add constraint units_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_roles add constraint user_roles_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
alter table public.user_roles add constraint user_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
alter table public.user_roles add constraint user_roles_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
alter table public.user_roles add constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_smtp_settings add constraint user_smtp_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.utility_settlements add constraint utility_settlements_economic_unit_id_fkey FOREIGN KEY (economic_unit_id) REFERENCES public.economic_units(id) ON DELETE RESTRICT;
alter table public.utility_settlements add constraint utility_settlements_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;
alter table public.utility_settlements add constraint utility_settlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 5 · Funktionen
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_portfolio_share(share_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        return false;
    end if;

    if not exists (select 1 from auth.users u
                   where u.id = auth.uid() and u.email_confirmed_at is not null) then
        return false;
    end if;

    update public.portfolio_shares s
       set status = 'accepted',
           updated_at = now()
     where s.id = accept_portfolio_share.share_id
       and s.status = 'pending'
       and lower(s.shared_with_email) = v_email
       and exists (select 1 from public.portfolios p
                   where p.id = s.portfolio_id and p.user_id = s.created_by);

    return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.accept_tenant_invitation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_role public.user_roles%rowtype;
  v_inv public.tenant_invitations%rowtype;
begin
  if v_uid is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('accept_tenant_invitation'), hashtext(v_uid::text));

  select * into v_role from public.user_roles
  where user_id = v_uid
  order by created_at, id
  limit 1;
  if found then
    return jsonb_build_object(
      'role', v_role.role, 'tenant_id', v_role.tenant_id, 'unit_id', v_role.unit_id,
      'property_id', v_role.property_id, 'id', v_role.id);
  end if;

  if exists (select 1 from public.portfolios p where p.user_id = v_uid) then
    return null;
  end if;

  select lower(trim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid;

  if v_email is null or v_email = '' or v_confirmed is null then
    return null;
  end if;

  select i.* into v_inv
  from public.tenant_invitations i
  join public.tenants t on t.id = i.tenant_id
  where lower(trim(i.email)) = v_email
    and i.status = 'pending'
  order by i.created_at desc, i.id
  limit 1
  for update of i;

  if not found then
    return null;
  end if;

  insert into public.user_roles (user_id, role, tenant_id, unit_id, property_id)
  values (v_uid, 'tenant', v_inv.tenant_id, v_inv.unit_id, v_inv.property_id)
  returning * into v_role;

  update public.tenant_invitations set status = 'accepted' where id = v_inv.id;

  return jsonb_build_object(
    'role', v_role.role, 'tenant_id', v_role.tenant_id, 'unit_id', v_role.unit_id,
    'property_id', v_role.property_id, 'id', v_role.id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.applicant_document_upload_allowed(p_object_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process_id uuid;
    v_applicant_id uuid;
    v_existing integer;
begin
    if p_object_name is null
       or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z_]{1,40}(_[0-9]{1,16})?\.(pdf|jpg|jpeg|png)$' then
        return false;
    end if;

    v_process_id := split_part(p_object_name, '/', 1)::uuid;
    v_applicant_id := split_part(p_object_name, '/', 2)::uuid;

    if not exists (
        select 1
        from public.rental_applicants a
        join public.rental_processes p on p.id = a.process_id
        where a.id = v_applicant_id
          and p.id = v_process_id
          and p.status = 'in_vermietung'
          and a.created_at > now() - interval '24 hours'
    ) then
        return false;
    end if;

    select count(*) into v_existing
    from storage.objects o
    where o.bucket_id = 'applicant-documents'
      and o.name like v_process_id::text || '/' || v_applicant_id::text || '/%';

    return v_existing < 12;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.bank_transactions_unmatch_deleted_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_type text;
begin
    v_type := case tg_table_name
                  when 'rent_payments' then 'income'
                  when 'expenses' then 'expense'
              end;
    if v_type is not null then
        update public.bank_transactions bt
           set status = 'pending',
               matched_type = null,
               matched_target_id = null
         where bt.matched_target_id = old.id
           and bt.matched_type = v_type;
    end if;
    return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.block_claim_events_modification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_own_note boolean;
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Eigene Notiz: note_added ohne Systemquelle und ohne Positionsbezug (z. B. "Position gelöscht")
  v_own_note := old.event_type = 'note_added'
                and coalesce(old.event_metadata->>'source', '') = ''
                and not (coalesce(old.event_metadata, '{}'::jsonb) ? 'item_id');

  if tg_op = 'UPDATE' then
    if to_jsonb(new) = to_jsonb(old) then
      return new;
    end if;
    -- Ein verknüpftes Dokument wurde gelöscht (claim_events.document_id ON DELETE SET NULL)
    if new.document_id is null
       and (to_jsonb(new) - 'document_id') = (to_jsonb(old) - 'document_id') then
      return new;
    end if;
    -- Eigene Notizen dürfen korrigiert werden; Typ, Forderung, Verfasser und Datum bleiben
    if v_own_note
       and new.event_type = 'note_added'
       and coalesce(new.event_metadata->>'source', '') = ''
       and not (coalesce(new.event_metadata, '{}'::jsonb) ? 'item_id')
       and (to_jsonb(new) - array['description', 'event_metadata', 'document_id'])
         = (to_jsonb(old) - array['description', 'event_metadata', 'document_id']) then
      return new;
    end if;
    raise exception 'Einträge der Forderungshistorie können nicht geändert werden. Bitte ergänzen Sie stattdessen eine Notiz.';
  end if;

  -- DELETE
  if v_own_note then
    return old;
  end if;
  if old.event_type = 'payment_received' then
    raise exception 'Zahlungsbuchungen bleiben in der Forderungshistorie erhalten. Eine Zahlung wird storniert, nicht gelöscht.';
  elsif old.event_type = 'payment_plan_accepted' then
    raise exception 'Ratenzahlungsvereinbarungen bleiben in der Forderungshistorie erhalten. Ein Ratenplan wird aufgehoben, nicht gelöscht.';
  end if;
  raise exception 'Einträge der Forderungshistorie (z. B. Anlage, Mahnungen, Fristen, Statuswechsel, Zahlungen, Stornos) können nicht gelöscht werden. Löschbar sind nur eigene Notizen.';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.block_physical_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return old;
  end if;
  raise exception 'Forderungen können nicht gelöscht werden. Bitte stornieren oder archivieren.';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.block_posted_allocation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text;
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return new;
  end if;
  select status into v_status from public.claim_payments where id = old.claim_payment_id;
  if v_status in ('posted', 'cancelled') then
    raise exception 'Allocations for posted payments cannot be modified.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.block_posted_payment_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return new;
  end if;
  if old.status in ('posted', 'cancelled') then
    raise exception 'Gebuchte oder stornierte Zahlungen können nicht geändert werden. Bitte die Zahlung in der Forderungsakte stornieren.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.book_viewing(p_token text, p_applicant_id uuid, p_viewing_id uuid, p_start_time time without time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process_id uuid;
    v_now timestamp := now() at time zone 'Europe/Berlin';
    v_app record;
    v_viewing public.rental_viewings%rowtype;
    v_start_min integer;
    v_view_start integer;
    v_view_end integer;
    v_end time;
    v_booking public.rental_viewing_bookings%rowtype;
begin
    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';
    if v_process_id is null then
        raise exception 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.';
    end if;

    select a.id, a.status into v_app
    from public.rental_applicants a
    where a.id = p_applicant_id and a.process_id = v_process_id
    for update;
    if not found then
        raise exception 'Bewerbung nicht gefunden. Bitte nutzen Sie den persönlichen Link aus Ihrer Bestätigungs-E-Mail.';
    end if;
    if v_app.status in ('declined', 'accepted', 'contract_declined') then
        raise exception 'Für diese Bewerbung ist keine Terminbuchung möglich.';
    end if;

    select * into v_viewing
    from public.rental_viewings
    where id = p_viewing_id and process_id = v_process_id;
    if not found then
        raise exception 'Besichtigungstag nicht gefunden.';
    end if;

    if p_start_time is null
       or v_viewing.slot_duration_minutes is null
       or v_viewing.slot_duration_minutes <= 0
       or extract(second from p_start_time) <> 0 then
        raise exception 'Ungültiger Termin.';
    end if;

    v_start_min := extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer;
    v_view_start := extract(hour from v_viewing.start_time)::integer * 60 + extract(minute from v_viewing.start_time)::integer;
    v_view_end := extract(hour from v_viewing.end_time)::integer * 60 + extract(minute from v_viewing.end_time)::integer;

    if v_start_min < v_view_start
       or (v_start_min - v_view_start) % v_viewing.slot_duration_minutes <> 0
       or v_start_min + v_viewing.slot_duration_minutes > v_view_end then
        raise exception 'Ungültiger Termin.';
    end if;

    if (v_viewing.date + p_start_time) <= v_now then
        raise exception 'Dieser Termin liegt in der Vergangenheit. Bitte wählen Sie einen anderen Termin.';
    end if;

    if exists (
        select 1
        from public.rental_viewing_bookings b
        join public.rental_viewings v on v.id = b.viewing_id
        where b.applicant_id = v_app.id
          and b.status = 'booked'
          and v.process_id = v_process_id
          and v.date >= v_now::date
    ) then
        raise exception 'Sie haben bereits einen Termin gebucht. Bitte sagen Sie diesen zuerst ab, wenn Sie einen anderen Termin wählen möchten.';
    end if;

    v_end := p_start_time + make_interval(mins => v_viewing.slot_duration_minutes);

    begin
        insert into public.rental_viewing_bookings (viewing_id, applicant_id, start_time, end_time, status)
        values (v_viewing.id, v_app.id, p_start_time, v_end, 'booked')
        returning * into v_booking;
    exception when unique_violation then
        raise exception 'Dieser Termin wurde gerade von einem anderen Bewerber gebucht. Bitte wählen Sie einen anderen Slot.'
            using errcode = 'unique_violation';
    end;

    return json_build_object(
        'id', v_booking.id,
        'viewing_id', v_booking.viewing_id,
        'date', v_viewing.date,
        'start_time', to_char(v_booking.start_time, 'HH24:MI:SS'),
        'end_time', to_char(v_booking.end_time, 'HH24:MI:SS'),
        'status', v_booking.status
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_lease_rent(p_lease_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'read')
     )
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_rent_ledger(p_lease_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'read')
       or public.has_lease_access(p_lease_id, 'finanzen', 'read')
     )
$function$
;
CREATE OR REPLACE FUNCTION public.can_self_assign_tenant_role(p_tenant_id uuid, p_unit_id uuid, p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and p_tenant_id is not null
     and not exists (select 1 from public.portfolios p where p.user_id = auth.uid())
     and not exists (select 1 from public.user_roles r where r.user_id = auth.uid())
     and exists (
       select 1
       from public.tenant_invitations i
       join auth.users u on u.id = auth.uid()
       where i.tenant_id = p_tenant_id
         and i.unit_id is not distinct from p_unit_id
         and i.property_id is not distinct from p_property_id
         and i.status = 'pending'
         and u.email is not null
         and u.email_confirmed_at is not null
         and lower(trim(i.email)) = lower(trim(u.email))
     )
$function$
;
CREATE OR REPLACE FUNCTION public.can_write_lease_rent(p_lease_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'write')
     )
$function$
;
CREATE OR REPLACE FUNCTION public.can_write_rent_ledger(p_lease_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'write')
       or public.has_lease_access(p_lease_id, 'finanzen', 'write')
     )
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_viewing_booking(p_token text, p_booking_id uuid, p_applicant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_booking_id uuid;
begin
    update public.rental_viewing_bookings b
       set status = 'canceled',
           canceled_at = now()
      from public.rental_viewings v,
           public.rental_processes p
     where b.id = p_booking_id
       and b.applicant_id = p_applicant_id
       and b.status = 'booked'
       and v.id = b.viewing_id
       and p.id = v.process_id
       and p.token = p_token
       and p.status = 'in_vermietung'
    returning b.id into v_booking_id;

    if v_booking_id is null then
        raise exception 'Termin nicht gefunden oder bereits abgesagt.';
    end if;

    return json_build_object('id', v_booking_id, 'status', 'canceled');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_claim_allocation_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment_user_id uuid;
  v_payment_claim_id uuid;
  v_payment_allocation_type text;
  v_payment_status text;
  v_claim_user_id uuid;
  v_item_user_id uuid;
  v_item_claim_id uuid;
  v_item_amount numeric;
  v_fees numeric;
  v_sum numeric;
begin
  -- 1. Zahlung existiert und gehört zu Nutzer und Forderung
  select user_id, claim_id, allocation_type, status
    into v_payment_user_id, v_payment_claim_id, v_payment_allocation_type, v_payment_status
    from public.claim_payments where id = new.claim_payment_id;
  if not found then
    raise exception 'claim_payment_id does not exist.';
  end if;
  if v_payment_user_id is distinct from new.user_id then
    raise exception 'claim_payment_id does not belong to the user.';
  end if;
  if v_payment_claim_id is distinct from new.claim_id then
    raise exception 'claim_id does not match the claim_payment claim_id.';
  end if;
  if tg_op = 'INSERT' and v_payment_status = 'cancelled' then
    raise exception 'Stornierte Zahlungen können keine neuen Zuordnungen erhalten.';
  end if;

  -- Vorzeichen-Check
  if new.amount > 0 and v_payment_allocation_type = 'reversal' then
    raise exception 'Reversal allocations must be negative or zero.';
  end if;
  if new.amount < 0 and v_payment_allocation_type is distinct from 'reversal' then
    raise exception 'Normal allocations must be positive or zero.';
  end if;

  -- 2. Forderung gehört dem Nutzer
  select user_id into v_claim_user_id from public.claims where id = new.claim_id;
  if not found or v_claim_user_id is distinct from new.user_id then
    raise exception 'claim_id does not belong to the user.';
  end if;

  -- 3. Position (falls angegeben) gehört zu Nutzer und Forderung
  if new.claim_item_id is not null then
    select user_id, claim_id into v_item_user_id, v_item_claim_id
      from public.claim_items where id = new.claim_item_id;
    if not found or v_item_user_id is distinct from new.user_id then
      raise exception 'claim_item_id does not belong to the user.';
    end if;
    if v_item_claim_id is distinct from new.claim_id then
      raise exception 'claim_item_id does not belong to this claim.';
    end if;
  end if;

  -- 4. Keine Überzuordnung (R2-06). Die Zeilensperre serialisiert gleichzeitige Zuordnungen.
  if new.amount > 0 and new.allocation_bucket = 'principal' and new.claim_item_id is not null then
    select original_amount into v_item_amount
      from public.claim_items where id = new.claim_item_id
       for no key update;
    select coalesce(sum(a.amount), 0) into v_sum
      from public.claim_payment_allocations a
      join public.claim_payments cp on cp.id = a.claim_payment_id
     where a.claim_item_id = new.claim_item_id
       and a.allocation_bucket = 'principal'
       and cp.status <> 'cancelled'
       and a.id <> new.id;
    if v_sum + new.amount > coalesce(v_item_amount, 0) + 0.005 then
      raise exception 'Die Zuordnung (% EUR) übersteigt den offenen Betrag der Position (% EUR).',
        public.claim_format_eur(new.amount),
        public.claim_format_eur(greatest(0, coalesce(v_item_amount, 0) - v_sum));
    end if;
  elsif new.amount > 0 and new.allocation_bucket = 'fees' then
    select accumulated_unpaid_fees into v_fees
      from public.claims where id = new.claim_id
       for no key update;
    select coalesce(sum(a.amount), 0) into v_sum
      from public.claim_payment_allocations a
      join public.claim_payments cp on cp.id = a.claim_payment_id
     where a.claim_id = new.claim_id
       and a.allocation_bucket = 'fees'
       and cp.status <> 'cancelled'
       and a.id <> new.id;
    if v_sum + new.amount > coalesce(v_fees, 0) + 0.005 then
      raise exception 'Die Zuordnung auf Mahnkosten (% EUR) übersteigt die offenen Mahnkosten der Forderung (% EUR).',
        public.claim_format_eur(new.amount),
        public.claim_format_eur(greatest(0, coalesce(v_fees, 0) - v_sum));
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_claim_event_document_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (
      select 1 from public.claims c
       where c.id = new.claim_id
         and (c.user_id = new.user_id or public.has_claim_access(new.claim_id, '*', 'read'))) then
      raise exception 'claim_id gehört nicht zum Nutzer.';
    end if;
  end if;

  if new.document_id is not null then
    if not exists (select 1 from public.documents where id = new.document_id and user_id = new.user_id) then
      raise exception 'document_id does not belong to the user.';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_claim_item_rent_ledger_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.claims c where c.id = new.claim_id and c.user_id = new.user_id) then
      raise exception 'claim_id gehört nicht zum Eigentümer der Position.';
    end if;
  end if;

  if new.rent_ledger_id is not null
     and (tg_op = 'INSERT' or new.rent_ledger_id is distinct from old.rent_ledger_id or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.rent_ledger where id = new.rent_ledger_id and user_id = new.user_id) then
      raise exception 'rent_ledger_id does not belong to the user.';
    end if;
  end if;

  if new.rent_ledger_ids is not null
     and (tg_op = 'INSERT' or new.rent_ledger_ids is distinct from old.rent_ledger_ids or new.user_id is distinct from old.user_id) then
    if exists (
      select 1 from unnest(new.rent_ledger_ids) as t(x)
       where x is null
          or not exists (select 1 from public.rent_ledger r where r.id = t.x and r.user_id = new.user_id)) then
      raise exception 'rent_ledger_ids gehören nicht zum Nutzer.';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_claim_payment_rent_payment_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.claims c where c.id = new.claim_id and c.user_id = new.user_id) then
      raise exception 'claim_id gehört nicht zum Eigentümer der Zahlung.';
    end if;
  end if;

  if new.rent_payment_id is not null
     and (tg_op = 'INSERT' or new.rent_payment_id is distinct from old.rent_payment_id or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.rent_payments where id = new.rent_payment_id and user_id = new.user_id) then
      raise exception 'rent_payment_id does not belong to the user.';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_claim_reactivation_duplicates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_x uuid;
  v_dup uuid;
  v_dup_period date;
begin
  if old.status not in ('cancelled', 'archived', 'settled')
     or new.status in ('cancelled', 'archived', 'settled') then
    return new;
  end if;

  for v_x in
    select distinct t.x
      from public.claim_items ci
      cross join lateral unnest(array_append(coalesce(ci.rent_ledger_ids, '{}'::uuid[]), ci.rent_ledger_id)) as t(x)
     where ci.claim_id = new.id
       and t.x is not null
     order by t.x
  loop
    perform pg_advisory_xact_lock(hashtextextended('claim_rent_ledger:' || v_x::text, 0));
  end loop;

  select t.x into v_dup
    from public.claim_items ci
    cross join lateral unnest(array_append(coalesce(ci.rent_ledger_ids, '{}'::uuid[]), ci.rent_ledger_id)) as t(x)
   where ci.claim_id = new.id
     and t.x is not null
     and exists (
       select 1
         from public.claim_items o
         join public.claims c on c.id = o.claim_id
        where o.claim_id <> new.id
          and c.status not in ('cancelled', 'archived', 'settled')
          and (o.rent_ledger_id = t.x or t.x = any(o.rent_ledger_ids)))
   limit 1;

  if v_dup is not null then
    select period_month into v_dup_period from public.rent_ledger where id = v_dup;
    raise exception 'Die Forderung kann nicht wieder geöffnet werden: Für die Miete % besteht inzwischen eine andere aktive Forderung.',
      coalesce(to_char(v_dup_period, 'MM/YYYY'), v_dup::text);
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_duplicate_active_claim_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ids uuid[];
  v_x uuid;
  v_dup uuid;
  v_dup_period date;
begin
  -- Bei UPDATE nur prüfen, wenn sich die Mietzuordnung ändert (Altbestand bleibt bearbeitbar)
  if tg_op = 'UPDATE'
     and new.rent_ledger_id is not distinct from old.rent_ledger_id
     and new.rent_ledger_ids is not distinct from old.rent_ledger_ids
     and new.claim_id is not distinct from old.claim_id then
    return new;
  end if;

  v_ids := array(
    select distinct x
      from unnest(array_append(coalesce(new.rent_ledger_ids, '{}'::uuid[]), new.rent_ledger_id)) as t(x)
     where x is not null
     order by x);

  if cardinality(v_ids) = 0 then
    return new;
  end if;

  foreach v_x in array v_ids
  loop
    perform pg_advisory_xact_lock(hashtextextended('claim_rent_ledger:' || v_x::text, 0));
  end loop;

  select x into v_dup
    from unnest(v_ids) as t(x)
   where exists (
     select 1
       from public.claim_items ci
       join public.claims c on c.id = ci.claim_id
      where ci.id <> new.id
        and c.status not in ('cancelled', 'archived', 'settled')
        and (ci.rent_ledger_id = t.x or t.x = any(ci.rent_ledger_ids)))
   limit 1;

  if v_dup is not null then
    select period_month into v_dup_period from public.rent_ledger where id = v_dup;
    raise exception 'Für die Miete % existiert bereits eine aktive Forderung.',
      coalesce(to_char(v_dup_period, 'MM/YYYY'), v_dup::text);
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_user_exists_by_email(check_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if auth.uid() is null then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    if check_email is null or btrim(check_email) = '' then
        return false;
    end if;

    return exists (
        select 1 from auth.users u
        where lower(u.email) = lower(btrim(check_email))
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_format_eur(p_value numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select replace(to_char(round(coalesce(p_value, 0), 2), 'FM9999999990.00'), '.', ',')
$function$
;
CREATE OR REPLACE FUNCTION public.claim_interest_amount(p_principal numeric, p_rate numeric, p_from date, p_to date)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_principal is null or p_rate is null or p_from is null or p_to is null
      or p_principal <= 0 or p_rate <= 0 or p_to <= p_from
      then 0::numeric
    else round(p_principal * p_rate / 36500.0 * (p_to - p_from), 2)
  end
$function$
;
CREATE OR REPLACE FUNCTION public.claim_live_interest(p_claim_id uuid, p_as_of date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select public.claim_interest_amount(
             coalesce((
               select sum(greatest(0::numeric, ci.original_amount - coalesce(pd.paid, 0::numeric)))
                 from public.claim_items ci
                 left join lateral (
                   select sum(a.amount) as paid
                     from public.claim_payment_allocations a
                     join public.claim_payments cp on cp.id = a.claim_payment_id
                    where a.claim_item_id = ci.id
                      and a.allocation_bucket = 'principal'
                      and cp.status = 'posted'
                 ) pd on true
                where ci.claim_id = c.id
                  and not exists (
                    select 1 from public.payment_plans pl
                     where pl.claim_id = c.id
                       and pl.status = 'active'
                       and coalesce(ci.created_at, '-infinity'::timestamptz) <= pl.created_at)
             ), 0::numeric),
             c.interest_rate,
             c.interest_start_date,
             p_as_of)
      from public.claims c
     where c.id = p_claim_id
  ), 0::numeric)
$function$
;
CREATE OR REPLACE FUNCTION public.claim_portal_check_access(p_token text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_link public.claim_access_links%rowtype;
  v_token_hash text;
  v_pin_ok boolean := false;
  v_owner uuid;
  v_recent integer;
  v_since_success integer;
  c_window constant interval := interval '15 minutes';
  c_max_in_window constant integer := 5;
  c_max_total constant integer := 10;
begin
  if p_token is null or btrim(p_token) = '' or length(p_token) > 256 then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  v_token_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select l.* into v_link
    from public.claim_access_links l
   where l.token_hash = v_token_hash
   order by l.created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  if v_link.revoked_at is not null or v_link.is_active is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'link_revoked',
      'error', 'Dieser Link wurde widerrufen oder gesperrt. Bitte wenden Sie sich an Ihren Vermieter.');
  end if;

  if v_link.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'link_expired',
      'error', 'Dieser Link ist abgelaufen. Bitte wenden Sie sich an Ihren Vermieter.');
  end if;

  select c.user_id into v_owner from public.claims c where c.id = v_link.claim_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  select count(*) filter (where e.event_date > clock_timestamp() - c_window),
         count(*) filter (where e.event_date > coalesce(v_link.last_used_at, v_link.created_at))
    into v_recent, v_since_success
    from public.claim_events e
   where e.claim_id = v_link.claim_id
     and e.event_type = 'note_added'
     and e.event_metadata ->> 'portal_event' = 'pin_failed'
     and e.event_metadata ->> 'link_id' = v_link.id::text;

  if v_recent >= c_max_in_window then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts',
      'error', 'Zu viele falsche Eingaben. Bitte warten Sie 15 Minuten und versuchen Sie es dann erneut.');
  end if;

  -- PIN nur gegen den bcrypt-Hash prüfen (kein Klartext-Vergleich)
  begin
    v_pin_ok := p_pin is not null
                and length(p_pin) <= 64
                and v_link.pin_hash is not null
                and extensions.crypt(btrim(p_pin), v_link.pin_hash) = v_link.pin_hash;
  exception when others then
    v_pin_ok := false;  -- kein gültiger bcrypt-Hash (Altbestand)
  end;

  if not v_pin_ok then
    insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
    values (v_owner, v_link.claim_id, 'note_added', clock_timestamp(),
            'Mieterportal: falscher Zugangscode (PIN) eingegeben',
            jsonb_build_object('source', 'claim_portal', 'portal_event', 'pin_failed', 'link_id', v_link.id));

    v_recent := v_recent + 1;
    v_since_success := v_since_success + 1;

    if v_since_success >= c_max_total then
      update public.claim_access_links
         set is_active = false,
             revoked_at = coalesce(revoked_at, now())
       where id = v_link.id;

      insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
      values (v_owner, v_link.claim_id, 'note_added', clock_timestamp(),
              'Mieterportal: Link nach zu vielen falschen PIN-Eingaben gesperrt. Bei Bedarf bitte einen neuen Portal-Link erstellen.',
              jsonb_build_object('source', 'claim_portal', 'portal_event', 'link_locked', 'link_id', v_link.id,
                                 'failed_attempts', v_since_success));

      return jsonb_build_object('ok', false, 'code', 'link_locked',
        'error', 'Der Link wurde nach zu vielen falschen Eingaben gesperrt. Bitte wenden Sie sich an Ihren Vermieter.');
    end if;

    return jsonb_build_object('ok', false, 'code', 'invalid_pin',
      'error', 'Der Zugangscode (PIN) ist nicht korrekt.',
      'attempts_left', least(c_max_in_window - v_recent, c_max_total - v_since_success));
  end if;

  update public.claim_access_links set last_used_at = clock_timestamp() where id = v_link.id;

  return jsonb_build_object('ok', true, 'link_id', v_link.id, 'claim_id', v_link.claim_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_portal_installment_options(p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_options jsonb := p_options;
  v_default constant jsonb := '[{"months": 3, "surcharge_percent": 7}, {"months": 6, "surcharge_percent": 9}, {"months": 12, "surcharge_percent": 12}]'::jsonb;
  v_result jsonb;
begin
  if v_options is null then
    return v_default;
  end if;

  if jsonb_typeof(v_options) = 'string' then
    begin
      v_options := (v_options #>> '{}')::jsonb;
    exception when others then
      return v_default;
    end;
  end if;

  if v_options is null or jsonb_typeof(v_options) <> 'array' then
    return v_default;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('months', x.months, 'surcharge_percent', x.surcharge_percent)
                            order by x.months), '[]'::jsonb)
    into v_result
  from (
    select distinct on (y.months) y.months, y.surcharge_percent
    from (
      select e.ord,
             case when jsonb_typeof(e.opt -> 'months') in ('number', 'string')
                   and (e.opt ->> 'months') ~ '^\s*[0-9]{1,3}(\.0+)?\s*$'
                  then btrim(e.opt ->> 'months')::numeric::integer end as months,
             case when jsonb_typeof(e.opt -> 'surcharge_percent') in ('number', 'string')
                   and (e.opt ->> 'surcharge_percent') ~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*$'
                  then btrim(e.opt ->> 'surcharge_percent')::numeric end as surcharge_percent
      from jsonb_array_elements(v_options) with ordinality as e(opt, ord)
      where jsonb_typeof(e.opt) = 'object'
    ) y
    where y.months between 1 and 120
      and y.surcharge_percent between 0 and 100
    order by y.months, y.ord
  ) x;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_portal_plan_request_block_reason(p_claim_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text;
  v_owner uuid;
  v_allow boolean;
  v_options jsonb;
  v_total_due numeric;
begin
  select c.status, c.user_id into v_status, v_owner from public.claims c where c.id = p_claim_id;
  if not found then
    return 'Für diese Forderung ist derzeit keine Ratenzahlung möglich.';
  end if;

  if v_status in ('settled', 'cancelled', 'archived') then
    return 'Für diese Forderung ist keine Ratenzahlung mehr möglich.';
  end if;

  if v_status = 'payment_plan_active'
     or exists (select 1 from public.payment_plans pp where pp.claim_id = p_claim_id and pp.status = 'active') then
    return 'Für diese Forderung besteht bereits eine Ratenzahlungsvereinbarung.';
  end if;

  if exists (select 1 from public.payment_plan_requests r where r.claim_id = p_claim_id and r.status = 'requested') then
    return 'Es liegt bereits eine Anfrage zur Ratenzahlung vor. Ihr Vermieter wird sich bei Ihnen melden.';
  end if;

  if v_status not in ('draft', 'open', 'sent', 'action_required', 'payment_plan_requested') then
    return 'Für diese Forderung ist derzeit keine Ratenzahlung möglich.';
  end if;

  select coalesce(p.claim_portal_allow_installments, true),
         public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_allow, v_options
    from public.profiles p
   where p.id = v_owner;
  if not found then
    v_allow := true;
    v_options := public.claim_portal_installment_options(null);
  end if;

  if not v_allow or jsonb_array_length(v_options) = 0 then
    return 'Ihr Vermieter bietet für diese Forderung keine Ratenzahlung über das Portal an.';
  end if;

  select t.total_due into v_total_due from public.claim_totals_view t where t.claim_id = p_claim_id;
  if coalesce(v_total_due, 0) <= 0 then
    return 'Für diese Forderung ist kein offener Betrag vorhanden.';
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (now() at time zone 'Europe/Berlin')::date
$function$
;
CREATE OR REPLACE FUNCTION public.cloud_connections_delete_secrets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.access_token_secret_id is not null or old.refresh_token_secret_id is not null then
    delete from vault.secrets s
     where s.id in (old.access_token_secret_id, old.refresh_token_secret_id);
  end if;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cloud_get_tokens(p_connection_id uuid, p_user_id uuid)
 RETURNS TABLE(access_token text, refresh_token text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(c.access_token, sa.decrypted_secret) as access_token,
         coalesce(c.refresh_token, sr.decrypted_secret) as refresh_token
    from public.cloud_connections c
    left join vault.decrypted_secrets sa on sa.id = c.access_token_secret_id
    left join vault.decrypted_secrets sr on sr.id = c.refresh_token_secret_id
   where c.id = p_connection_id
     and c.user_id = p_user_id;
$function$
;
CREATE OR REPLACE FUNCTION public.cloud_store_tokens(p_connection_id uuid, p_user_id uuid, p_access_token text, p_refresh_token text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.cloud_connections%rowtype;
  v_access text;
  v_refresh text;
  v_access_id uuid;
  v_refresh_id uuid;
  v_keep boolean := public.cloud_tokens_keep_plaintext();
begin
  if p_connection_id is null or p_user_id is null then
    raise exception 'Verbindung und Nutzer sind erforderlich' using errcode = '22004';
  end if;

  select * into r
    from public.cloud_connections c
   where c.id = p_connection_id and c.user_id = p_user_id
   for update;
  if not found then
    raise exception 'Cloud-Verbindung nicht gefunden' using errcode = 'P0002';
  end if;

  v_access := coalesce(nullif(p_access_token, ''), r.access_token);
  v_refresh := coalesce(nullif(p_refresh_token, ''), r.refresh_token);

  v_access_id := public.cloud_vault_put(r.access_token_secret_id, v_access, format('cloud_connection:%s:access_token', r.id));
  v_refresh_id := public.cloud_vault_put(r.refresh_token_secret_id, v_refresh, format('cloud_connection:%s:refresh_token', r.id));

  update public.cloud_connections c
     set access_token_secret_id = v_access_id,
         refresh_token_secret_id = v_refresh_id,
         access_token = case when v_keep then v_access else null end,
         refresh_token = case when v_keep then v_refresh else null end,
         expires_at = coalesce(p_expires_at, c.expires_at)
   where c.id = r.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cloud_tokens_keep_plaintext()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select false $function$
;
CREATE OR REPLACE FUNCTION public.cloud_vault_put(p_secret_id uuid, p_value text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if p_value is null or p_value = '' then
    return p_secret_id;
  end if;

  if p_secret_id is not null and exists (select 1 from vault.secrets s where s.id = p_secret_id) then
    perform vault.update_secret(p_secret_id, p_value);
    return p_secret_id;
  end if;

  -- Eintrag gleichen Namens (z. B. aus einem abgebrochenen Lauf) wiederverwenden
  select s.id into v_id from vault.secrets s where s.name = p_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_value);
    return v_id;
  end if;

  return vault.create_secret(p_value, p_name, 'ImmoControl360: OAuth-Token einer Cloud-Verbindung');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.convert_rental_applicant_to_tenant(p_applicant_id uuid, p_start_date date, p_cold_rent numeric, p_service_charge numeric DEFAULT 0, p_heating_cost numeric DEFAULT 0, p_deposit numeric DEFAULT NULL::numeric, p_payment_due_day integer DEFAULT 3)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_app public.rental_applicants%rowtype;
    v_process public.rental_processes%rowtype;
    v_tenant_id uuid;
    v_lease_id uuid;
    v_salutation text;
begin
    if v_uid is null then
        raise exception 'Nicht angemeldet.';
    end if;
    if p_start_date is null then
        raise exception 'Bitte einen Mietbeginn angeben.';
    end if;
    if p_cold_rent is null or p_cold_rent <= 0 then
        raise exception 'Bitte eine Kaltmiete größer 0 € angeben.';
    end if;
    if coalesce(p_service_charge, 0) < 0 or coalesce(p_heating_cost, 0) < 0 or coalesce(p_deposit, 0) < 0 then
        raise exception 'Beträge dürfen nicht negativ sein.';
    end if;
    if p_payment_due_day is null or p_payment_due_day < 1 or p_payment_due_day > 31 then
        raise exception 'Bitte einen Fälligkeitstag zwischen 1 und 31 angeben.';
    end if;

    select * into v_app from public.rental_applicants where id = p_applicant_id;
    if not found then
        raise exception 'Bewerbung nicht gefunden.';
    end if;

    select * into v_process from public.rental_processes where id = v_app.process_id for update;
    if not found then
        raise exception 'Vermietungsprozess nicht gefunden.';
    end if;
    if v_process.status <> 'in_vermietung' then
        raise exception 'Für diesen Vermietungsprozess wurde bereits ein Mieter angenommen.';
    end if;

    if exists (select 1 from public.leases l
               where l.unit_id = v_process.unit_id
                 and l.status = 'active'
                 and (l.end_date is null or l.end_date >= p_start_date)) then
        raise exception 'Für diese Einheit besteht bereits ein aktiver Mietvertrag, der den gewählten Mietbeginn überschneidet.';
    end if;

    -- Anrede aus dem Bewerbungsportal als tenants.salutation; leer/unbekannt = keine Angabe (neutrale Briefanrede)
    v_salutation := case lower(btrim(coalesce(v_app.salutation, '')))
                        when 'frau' then 'female'
                        when 'female' then 'female'
                        when 'herr' then 'male'
                        when 'male' then 'male'
                        when 'divers' then 'diverse'
                        when 'diverse' then 'diverse'
                        else null
                    end;

    insert into public.tenants (user_id, salutation, first_name, last_name, email, phone, occupants)
    values (v_uid, v_salutation, v_app.first_name, v_app.last_name, v_app.email, v_app.phone,
            coalesce(v_app.additional_persons_count, 0) + 1)
    returning id into v_tenant_id;

    insert into public.leases (user_id, tenant_id, unit_id, start_date, cold_rent, service_charge,
                               heating_cost, deposit, payment_due_day, lease_type, status)
    values (v_uid, v_tenant_id, v_process.unit_id, p_start_date, p_cold_rent, coalesce(p_service_charge, 0),
            coalesce(p_heating_cost, 0), p_deposit, p_payment_due_day, 'normal', 'active')
    returning id into v_lease_id;

    update public.rental_processes
       set status = 'vermietet',
           lease_start_date = p_start_date,
           rented_at = now()
     where id = v_process.id;

    update public.rental_applicants
       set status = 'accepted'
     where id = v_app.id;

    return json_build_object('tenant_id', v_tenant_id, 'lease_id', v_lease_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_claim_advanced(p_lease_id uuid, p_rent_ledger_ids uuid[], p_manual_items jsonb, p_fee_amount numeric, p_interest_rate numeric, p_accumulated_interest numeric, p_interest_start_date date, p_deadline_days integer, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_tenant_id uuid;
  v_lease_found boolean;
  v_ledger_ids uuid[];
  v_sorted_ids uuid[] := '{}'::uuid[];
  v_manual jsonb;
  v_parsed jsonb := '[]'::jsonb;
  v_m jsonb;
  v_ledger record;
  v_found integer := 0;
  v_open numeric;
  v_rent_total numeric := 0;
  v_manual_total numeric := 0;
  v_first_period date;
  v_first_due date;
  v_dup uuid;
  v_active public.claims%rowtype;
  v_has_active boolean := false;
  v_claim_id uuid;
  v_deadline date;
  v_fee numeric;
  v_interest numeric;
  v_rate numeric;
  v_cap numeric := 0;
  v_metadata_items jsonb := '[]'::jsonb;
  v_desc_text text := '';
  v_desc_rent text := '';
  v_item_desc text;
  v_item_amount numeric;
  v_item_type text;
  v_item_due date;
  v_is_first boolean := true;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  -- Mietvertrag + Berechtigung (Eigentümer oder Schreibrecht „finanzen")
  select true, l.tenant_id, l.user_id
    into v_lease_found, v_tenant_id, v_owner
    from public.leases l where l.id = p_lease_id;
  if not coalesce(v_lease_found, false)
     or (v_owner <> v_caller and not public.has_lease_access(p_lease_id, 'finanzen', 'write')) then
    raise exception 'Mietvertrag nicht gefunden oder keine Berechtigung.';
  end if;

  if v_tenant_id is null then
    raise exception 'Fehler: Diesem Mietvertrag ist kein Mieter zugewiesen! Bitte weisen Sie dem Mietvertrag einen Mieter zu, bevor Sie eine Forderung erstellen.';
  end if;

  -- Eingaben normalisieren und prüfen
  v_ledger_ids := array(select distinct x from unnest(coalesce(p_rent_ledger_ids, '{}'::uuid[])) as t(x) where x is not null);
  v_manual := coalesce(p_manual_items, '[]'::jsonb);
  if jsonb_typeof(v_manual) <> 'array' then
    raise exception 'Ungültige manuelle Positionen.';
  end if;
  if cardinality(v_ledger_ids) = 0 and jsonb_array_length(v_manual) = 0 then
    raise exception 'Keine Forderungspositionen angegeben.';
  end if;

  v_fee := round(coalesce(p_fee_amount, 0), 2);
  v_interest := round(coalesce(p_accumulated_interest, 0), 2);
  v_rate := coalesce(p_interest_rate, 0);
  if v_fee < 0 then
    raise exception 'Die Mahngebühr darf nicht negativ sein.';
  end if;
  if v_interest < 0 then
    raise exception 'Die aufgelaufenen Zinsen dürfen nicht negativ sein.';
  end if;
  if v_rate < 0 or v_rate > 100 then
    raise exception 'Ungültiger Zinssatz.';
  end if;
  if p_deadline_days is not null and (p_deadline_days < 0 or p_deadline_days > 365) then
    raise exception 'Die Frist muss zwischen 0 und 365 Tagen liegen.';
  end if;

  -- Mieten: sperren, Zugehörigkeit, Offenstand und Doppelanmahnung prüfen
  if cardinality(v_ledger_ids) > 0 then
    for v_ledger in
      select id, lease_id, expected_rent, coalesce(paid_amount, 0) as paid_amount, period_month, due_date
        from public.rent_ledger
       where id = any(v_ledger_ids) and user_id = v_owner
       order by period_month
         for update
    loop
      v_found := v_found + 1;
      if v_ledger.lease_id <> p_lease_id then
        raise exception 'Alle ausgewählten Mieten müssen zum selben Mietvertrag gehören.';
      end if;
      v_open := round(v_ledger.expected_rent - v_ledger.paid_amount, 2);
      if v_open <= 0 then
        raise exception 'Die Miete % ist bereits bezahlt.', to_char(v_ledger.period_month, 'MM/YYYY');
      end if;

      select ci.claim_id into v_dup
        from public.claim_items ci
        join public.claims c on c.id = ci.claim_id
       where (ci.rent_ledger_id = v_ledger.id or v_ledger.id = any(ci.rent_ledger_ids))
         and c.status not in ('settled', 'cancelled', 'archived')
       limit 1;
      if v_dup is not null then
        raise exception 'Für die Miete % existiert bereits eine aktive Forderung.', to_char(v_ledger.period_month, 'MM/YYYY');
      end if;

      v_rent_total := v_rent_total + v_open;
      v_sorted_ids := array_append(v_sorted_ids, v_ledger.id);
      if v_first_period is null then
        v_first_period := v_ledger.period_month;
        v_first_due := v_ledger.due_date;
      end if;
      v_desc_rent := v_desc_rent || to_char(v_ledger.period_month, 'MM/YYYY') || ', ';
      v_metadata_items := v_metadata_items || jsonb_build_array(jsonb_build_object(
        'rent_ledger_id', v_ledger.id, 'period_month', v_ledger.period_month,
        'amount', v_open, 'description', 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY')));
    end loop;

    if v_found <> cardinality(v_ledger_ids) then
      raise exception 'Mindestens eine ausgewählte Miete wurde nicht gefunden oder gehört nicht zu diesem Mietvertrag.';
    end if;

    if cardinality(v_ledger_ids) = 1 then
      v_desc_text := v_desc_text || 'Mietrückstand ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
    else
      v_desc_text := v_desc_text || 'Mietrückstände ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
    end if;
  end if;

  -- Manuelle Positionen: Betrag > 0, gültiger Typ und Fälligkeit
  for v_m in select value from jsonb_array_elements(v_manual)
  loop
    if jsonb_typeof(v_m) <> 'object' then
      raise exception 'Ungültige manuelle Position.';
    end if;
    v_item_desc := nullif(trim(coalesce(v_m->>'description', '')), '');
    begin
      v_item_amount := round(nullif(trim(coalesce(v_m->>'amount', '')), '')::numeric, 2);
    exception when others then
      raise exception 'Manuelle Position "%": ungültiger Betrag.', coalesce(v_item_desc, '');
    end;
    if v_item_amount is null or v_item_amount <= 0 then
      raise exception 'Manuelle Position "%": Der Betrag muss größer als 0 sein.', coalesce(v_item_desc, '');
    end if;
    v_item_type := coalesce(nullif(v_m->>'item_type', ''), 'other');
    if v_item_type not in ('rent', 'utility_backpay', 'damage', 'deposit', 'other') then
      raise exception 'Manuelle Position "%": unbekannter Positionstyp.', coalesce(v_item_desc, '');
    end if;
    begin
      v_item_due := nullif(trim(coalesce(v_m->>'dueDate', '')), '')::date;
    exception when others then
      raise exception 'Manuelle Position "%": ungültiges Fälligkeitsdatum.', coalesce(v_item_desc, '');
    end;

    v_manual_total := v_manual_total + v_item_amount;
    v_desc_text := v_desc_text || coalesce(v_item_desc, 'Position') || ', ';
    v_parsed := v_parsed || jsonb_build_array(jsonb_build_object(
      'description', v_item_desc, 'amount', v_item_amount, 'item_type', v_item_type, 'due_date', v_item_due));
    v_metadata_items := v_metadata_items || jsonb_build_array(jsonb_build_object(
      'description', v_item_desc, 'amount', v_item_amount, 'item_type', v_item_type, 'due_date', v_item_due));
  end loop;

  if length(v_desc_text) > 0 then
    v_desc_text := substring(v_desc_text from 1 for length(v_desc_text) - 2);
  end if;
  v_deadline := case when p_deadline_days is null then null else public.claim_today() + p_deadline_days end;

  -- Aktive Forderung zum Mietvertrag?
  select * into v_active
    from public.claims
   where lease_id = p_lease_id and user_id = v_owner
     and status not in ('settled', 'cancelled', 'archived')
   order by created_at desc
   limit 1
     for update;
  v_has_active := found;

  if v_has_active then
    v_claim_id := v_active.id;

    -- Zinssatz muss zur bestehenden Forderung passen (H2-12, H3-02)
    if v_active.interest_start_date is null then
      if v_rate > 0 or v_interest > 0 then
        raise exception 'Die bestehende Forderung zu diesem Mietvertrag ist unverzinst. Bitte die neuen Positionen ohne Zinsen erfassen oder die bestehende Forderung zuerst abschließen.';
      end if;
    elsif abs(coalesce(v_active.interest_rate, 0) - v_rate) > 0.00005 then
      raise exception 'Die bestehende Forderung zu diesem Mietvertrag wird mit % %% verzinst. Bitte denselben Zinssatz verwenden oder die bestehende Forderung zuerst abschließen.',
        replace(trim_scale(coalesce(v_active.interest_rate, 0))::text, '.', ',');
    end if;

    -- Zinsen der bisherigen Posten bis heute festschreiben, Zinsbeginn = heute.
    -- Die Zinsen der neuen Posten bis heute übergibt die Oberfläche (p_accumulated_interest).
    v_cap := coalesce(public.claim_live_interest(v_claim_id, public.claim_today()), 0);

    update public.claims set
      accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap + v_interest, 2),
      accumulated_unpaid_fees = coalesce(accumulated_unpaid_fees, 0) + v_fee,
      interest_start_date = case when interest_start_date is null then null
                                 else greatest(interest_start_date, public.claim_today()) end,
      deadline = greatest(deadline, v_deadline),
      next_action_at = greatest(next_action_at, v_deadline),
      updated_at = now()
    where id = v_claim_id;
  else
    insert into public.claims (user_id, lease_id, tenant_id, status, escalation_level,
        interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
        deadline, next_action_at)
    values (v_owner, p_lease_id, v_tenant_id, 'open', 0,
        p_interest_start_date, v_rate, v_interest, v_fee,
        v_deadline, v_deadline)
    returning id into v_claim_id;
  end if;

  -- Mieten als EINE Position (Einzelmonat zusätzlich im Einzelfeld rent_ledger_id)
  if cardinality(v_sorted_ids) > 0 then
    insert into public.claim_items (
        user_id, claim_id, item_type, original_amount, period_month,
        description, due_date, rent_ledger_id, rent_ledger_ids, fee_amount, interest_amount)
    values (
        v_owner, v_claim_id, 'rent', v_rent_total, v_first_period,
        case when cardinality(v_sorted_ids) = 1 then 'Mietrückstand ' else 'Mietrückstände ' end
          || substring(v_desc_rent from 1 for length(v_desc_rent) - 2),
        coalesce(v_first_due, v_first_period + 3),
        case when cardinality(v_sorted_ids) = 1 then v_sorted_ids[1] else null end,
        v_sorted_ids, v_fee, v_interest);
    v_is_first := false;
  end if;

  -- Manuelle Positionen
  for v_m in select value from jsonb_array_elements(v_parsed)
  loop
    insert into public.claim_items (user_id, claim_id, item_type, original_amount, description, due_date, fee_amount, interest_amount)
    values (v_owner, v_claim_id, v_m->>'item_type', (v_m->>'amount')::numeric, v_m->>'description',
            nullif(v_m->>'due_date', '')::date,
            case when v_is_first then v_fee else 0 end,
            case when v_is_first then v_interest else 0 end);
    v_is_first := false;
  end loop;

  -- Ereignis
  if v_has_active then
    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (v_caller, v_claim_id, 'note_added', 'Forderungspositionen hinzugefügt: ' || v_desc_text,
        jsonb_build_object('source', 'append_advanced', 'items', v_metadata_items,
            'total_principal_amount', v_rent_total + v_manual_total, 'fee_amount', v_fee,
            'accumulated_interest', v_interest, 'capitalized_interest', v_cap,
            'old_interest_start_date', v_active.interest_start_date,
            'interest_rate', v_rate, 'note', p_note));
  else
    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (v_caller, v_claim_id, 'created', 'Forderung erstellt: ' || v_desc_text,
        jsonb_build_object('source', 'create_advanced', 'items', v_metadata_items,
            'total_principal_amount', v_rent_total + v_manual_total, 'fee_amount', v_fee,
            'accumulated_interest', v_interest, 'interest_start_date', p_interest_start_date,
            'interest_rate', v_rate, 'deadline', v_deadline, 'note', p_note));
  end if;

  return v_claim_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_claim_portal_link(p_claim_id uuid, p_expires_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_days integer := coalesce(p_expires_days, 14);
  v_token text;
  v_token_hash text;
  v_pin text;
  v_bytes bytea;
  v_value bigint;
  v_tries integer := 0;
  v_link_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;

  select c.user_id into v_owner from public.claims c where c.id = p_claim_id for update;
  if not found
     or (v_owner is distinct from v_uid
         and not coalesce(public.has_claim_access(p_claim_id, 'finanzen', 'write'), false)) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung, einen Portal-Link zu erstellen.'
      using errcode = '42501';
  end if;

  if v_days < 1 or v_days > 90 then
    raise exception 'Die Gültigkeit des Portal-Links muss zwischen 1 und 90 Tagen liegen.';
  end if;

  loop
    v_tries := v_tries + 1;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
    exit when not exists (select 1 from public.claim_access_links l where l.token_hash = v_token_hash);
    if v_tries >= 5 then
      raise exception 'Der Portal-Link konnte nicht erzeugt werden. Bitte erneut versuchen.';
    end if;
  end loop;

  -- 6-stellige PIN gleichverteilt (Zufallswerte >= 4772 * 900000 werden verworfen)
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_value := get_byte(v_bytes, 0)::bigint * 16777216
             + get_byte(v_bytes, 1)::bigint * 65536
             + get_byte(v_bytes, 2)::bigint * 256
             + get_byte(v_bytes, 3)::bigint;
    exit when v_value < 4294800000;
  end loop;
  v_pin := (100000 + v_value % 900000)::text;

  update public.claim_access_links
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where claim_id = p_claim_id
     and (is_active is distinct from false or revoked_at is null);

  v_expires := now() + make_interval(days => v_days);

  insert into public.claim_access_links (claim_id, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id, v_token_hash, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          v_expires, v_uid, true)
  returning id into v_link_id;

  return jsonb_build_object('link_id', v_link_id, 'token', v_token, 'pin', v_pin, 'expires_at', v_expires);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_credit_note(p_invoice_id uuid)
 RETURNS public.invoices
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_orig public.invoices%rowtype;
    v_new public.invoices%rowtype;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
    v_small boolean;
    v_positions jsonb := '[]'::jsonb;
    v_pos jsonb;
    v_out jsonb;
    v_raw jsonb;
    v_rate numeric;
    v_key text;
    v_amount numeric;
    v_number text;
    v_attempt integer := 0;
    v_rows integer;
begin
    if auth.uid() is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_invoice_id is null then
        raise exception 'Keine Rechnung angegeben.';
    end if;

    -- Sperren (verhindert doppelte Gutschriften); FOR UPDATE liefert nur Zeilen mit Schreibrecht
    select * into v_orig from public.invoices i where i.id = p_invoice_id for update;
    if not found or not public.has_portfolio_access(v_orig.portfolio_id, 'finanzen', 'write') then
        raise exception 'Die Rechnung wurde nicht gefunden oder Sie haben keine Schreibberechtigung.';
    end if;
    if v_orig.status is distinct from 'issued' then
        raise exception 'Eine Gutschrift kann nur zu einer ausgestellten Rechnung erstellt werden. Die Rechnung wurde inzwischen geändert oder bereits storniert.';
    end if;

    -- Positionen spiegeln (entspricht isInvoiceSmallBusiness / getPositionVatRate / r2 in lib/invoiceDocument.js)
    v_small := jsonb_typeof(v_orig.positions) = 'array'
               and exists (select 1 from jsonb_array_elements(v_orig.positions) e(x)
                            where e.x -> 'smallBusiness' = 'true'::jsonb);

    for v_pos in
        select case when jsonb_typeof(e.x) = 'object' then e.x else '{}'::jsonb end
          from jsonb_array_elements(case when jsonb_typeof(v_orig.positions) = 'array'
                                         then v_orig.positions else '[]'::jsonb end)
               with ordinality as e(x, ord)
         order by e.ord
    loop
        v_raw := v_pos -> 'vatRate';
        v_rate := case
            when v_small or v_pos -> 'smallBusiness' = 'true'::jsonb then 0
            when v_raw is null or v_raw = 'null'::jsonb or v_raw = '""'::jsonb then 7
            when jsonb_typeof(v_raw) = 'number' then (v_raw #>> '{}')::numeric
            when jsonb_typeof(v_raw) = 'string'
                 and btrim(v_raw #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
                then btrim(v_raw #>> '{}')::numeric
            else 7
        end;

        v_out := v_pos || jsonb_build_object(
            'vatRate', v_rate,
            'refInvoiceId', v_orig.id,
            'refInvoiceNumber', coalesce(v_orig.invoice_number, ''),
            'refInvoiceDate', v_orig.invoice_date);

        -- Beträge wie parseFloat(): Zahl, sonst führender Zahlenwert eines Textes, sonst 0; dann negiert
        foreach v_key in array array['pricePerNight', 'netTotal', 'vat', 'grossTotal'] loop
            v_raw := v_pos -> v_key;
            v_amount := case jsonb_typeof(v_raw)
                when 'number' then (v_raw #>> '{}')::numeric
                when 'string' then substring(v_raw #>> '{}' from '^\s*([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)')::numeric
            end;
            v_out := v_out || jsonb_build_object(v_key, round(-coalesce(v_amount, 0), 2));
        end loop;

        if v_small then
            v_out := v_out || jsonb_build_object('smallBusiness', true);
        end if;
        v_positions := v_positions || jsonb_build_array(v_out);
    end loop;

    -- Nummer aus dem Nummernkreis des Portfolios; bei Kollision (gleichzeitige Vergabe) neu vergeben
    loop
        v_attempt := v_attempt + 1;
        v_number := public.get_next_invoice_number(v_orig.portfolio_id, null, extract(year from v_today)::integer);
        begin
            insert into public.invoices (
                user_id, portfolio_id, property_id, unit_id, contact_id, invoice_date, invoice_number,
                sender_name, sender_street, sender_zip, sender_city,
                recipient_name, recipient_street, recipient_zip, recipient_city,
                move_in, move_out, persons, nights, vat_rate, positions,
                net_amount, vat_amount, gross_amount, status)
            values (
                v_orig.user_id, v_orig.portfolio_id, v_orig.property_id, v_orig.unit_id, v_orig.contact_id,
                v_today, v_number,
                v_orig.sender_name, v_orig.sender_street, v_orig.sender_zip, v_orig.sender_city,
                v_orig.recipient_name, v_orig.recipient_street, v_orig.recipient_zip, v_orig.recipient_city,
                v_orig.move_in, v_orig.move_out, nullif(v_orig.persons, 0), v_orig.nights, v_orig.vat_rate,
                v_positions,
                round(-coalesce(v_orig.net_amount, 0), 2),
                round(-coalesce(v_orig.vat_amount, 0), 2),
                round(-coalesce(v_orig.gross_amount, 0), 2),
                'credit_note')
            returning * into v_new;
            exit;
        exception when unique_violation then
            if v_attempt >= 5 then
                raise exception 'Es konnte keine eindeutige Gutschriftsnummer vergeben werden. Bitte versuchen Sie es erneut.';
            end if;
        end;
    end loop;

    update public.invoices
       set status = 'credited'
     where id = v_orig.id
       and status = 'issued';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Die Rechnung wurde inzwischen geändert oder bereits storniert. Es wurde keine Gutschrift erstellt.';
    end if;

    return v_new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_payment_plan(p_claim_id uuid, p_first_due_date date, p_installment_count integer, p_adjustment_amount numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_adj numeric;
  v_cap numeric := 0;
  v_fees_before numeric;
  v_interest_after numeric;
  v_plan_total numeric;
  v_base_total numeric;
  v_rate numeric;
  v_last numeric;
  v_last_due date;
  v_plan_id uuid;
  v_i integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(p_claim_id, 'finanzen', 'write')) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung kann kein Ratenplan mehr erstellt werden (Status: %).', v_claim.status;
  end if;

  if exists (select 1 from public.payment_plans where claim_id = p_claim_id and status = 'active') then
    raise exception 'Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.';
  end if;

  if p_installment_count is null or p_installment_count < 1 or p_installment_count > 120 then
    raise exception 'Die Anzahl der Raten muss zwischen 1 und 120 liegen.';
  end if;
  if p_first_due_date is null then
    raise exception 'Bitte das Fälligkeitsdatum der ersten Rate angeben.';
  end if;
  v_adj := round(coalesce(p_adjustment_amount, 0), 2);
  if v_adj < 0 then
    raise exception 'Der Aufschlag darf nicht negativ sein.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- 1. Zinsen bis heute festschreiben; während des Plans laufen für die Planpositionen
  --    keine weiteren Zinsen (claim_live_interest lässt sie aus).
  v_cap := coalesce(public.claim_live_interest(p_claim_id, public.claim_today()), 0);
  v_fees_before := coalesce(v_claim.accumulated_unpaid_fees, 0);
  v_interest_after := round(coalesce(v_claim.accumulated_unpaid_interest, 0) + v_cap, 2);

  -- 2. Aufschlag als Gebühr auf die Forderung buchen (sonst ist die letzte Rate nicht buchbar)
  update public.claims set
    accumulated_unpaid_interest = v_interest_after,
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, public.claim_today()) end,
    accumulated_unpaid_fees = v_fees_before + v_adj,
    updated_at = now()
  where id = p_claim_id;

  select round(coalesce(t.total_due, 0), 2) into v_plan_total
    from public.claim_totals_view t where t.claim_id = p_claim_id;
  v_plan_total := coalesce(v_plan_total, 0);
  v_base_total := v_plan_total - v_adj;
  if v_base_total <= 0 then
    raise exception 'Für diese Forderung ist kein offener Betrag vorhanden.';
  end if;

  -- 3. Raten: gleich hohe Raten, letzte Rate = Rest
  v_rate := round(v_plan_total / p_installment_count, 2);
  v_last := v_plan_total - v_rate * (p_installment_count - 1);
  if v_rate <= 0 or v_last <= 0 then
    raise exception 'Der offene Betrag (% EUR) ist für % Raten zu klein.',
      public.claim_format_eur(v_plan_total), p_installment_count;
  end if;
  v_last_due := (p_first_due_date + make_interval(months => p_installment_count - 1))::date;

  insert into public.payment_plans (
      user_id, claim_id, status, plan_type, total_amount, interest_or_fee_adjustment,
      monthly_rate, first_due_date, last_due_date, accepted_at,
      fees_at_creation, interest_at_creation)
  values (
      v_claim.user_id, p_claim_id, 'active', 'installment_agreement', v_plan_total, v_adj,
      v_rate, p_first_due_date, v_last_due, now(),
      v_fees_before, v_interest_after)
  returning id into v_plan_id;

  for v_i in 1..p_installment_count loop
    insert into public.payment_plan_installments (user_id, payment_plan_id, due_date, amount, paid_amount, status)
    values (v_claim.user_id, v_plan_id,
            (p_first_due_date + make_interval(months => v_i - 1))::date,
            case when v_i = p_installment_count then v_last else v_rate end,
            0, 'open');
  end loop;

  update public.claims set status = 'payment_plan_active', next_action_at = p_first_due_date, updated_at = now()
  where id = p_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
  values (v_caller, p_claim_id, 'payment_plan_accepted', now(), 'Ratenzahlungsvereinbarung erstellt',
      jsonb_build_object(
          'payment_plan_id', v_plan_id,
          'plan_total', v_plan_total, 'base_claim_total', v_base_total,
          'adjustment', v_adj, 'surcharge_booked_as_fee', true,
          'capitalized_interest', v_cap,
          'installment_count', p_installment_count,
          'monthly_rate', v_rate, 'last_installment', v_last,
          'first_due_date', p_first_due_date, 'last_due_date', v_last_due, 'note', p_note,
          'fees_at_creation', v_fees_before, 'interest_at_creation', v_interest_after));

  perform set_config('app.claims_rpc_bypass', '', true);
  return v_plan_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.decline_portfolio_share(share_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    delete from public.portfolio_shares s
     where s.id = decline_portfolio_share.share_id
       and lower(s.shared_with_email) = v_email;

    if not found then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_claim_item(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_item public.claim_items%rowtype;
  v_claim public.claims%rowtype;
  v_other uuid;
  v_plan_created timestamptz;
  v_moved_to uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_item from public.claim_items where id = p_item_id;
  if not found then
    raise exception 'Position nicht gefunden';
  end if;
  select * into v_claim from public.claims where id = v_item.claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_item.claim_id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Bei abgeschlossenen Forderungen können keine Positionen gelöscht werden (Status: %).',
      case v_claim.status when 'settled' then 'erledigt' when 'cancelled' then 'storniert' else 'archiviert' end;
  end if;

  if exists (select 1 from public.claim_payment_allocations where claim_item_id = p_item_id) then
    raise exception 'Diese Position hat bereits zugeordnete Zahlungen. Bitte zuerst die Zahlungen rückabwickeln.';
  end if;

  select max(created_at) into v_plan_created
    from public.payment_plans where claim_id = v_item.claim_id and status = 'active';
  if v_plan_created is not null and coalesce(v_item.created_at, '-infinity'::timestamptz) <= v_plan_created then
    raise exception 'Diese Position ist Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;

  select id into v_other
    from public.claim_items
   where claim_id = v_item.claim_id and id <> p_item_id
   order by created_at asc nulls first, id
   limit 1;
  if v_other is null then
    raise exception 'Die letzte Position einer Forderung kann nicht gelöscht werden. Bitte stornieren Sie stattdessen die Forderung.';
  end if;

  -- Gebühr/Zinsen der Position auf die älteste verbleibende Position übertragen
  if coalesce(v_item.fee_amount, 0) > 0 or coalesce(v_item.interest_amount, 0) > 0 then
    update public.claim_items set
      fee_amount = fee_amount + coalesce(v_item.fee_amount, 0),
      interest_amount = interest_amount + coalesce(v_item.interest_amount, 0)
    where id = v_other;
    v_moved_to := v_other;
  end if;

  delete from public.claim_items where id = p_item_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_claim.user_id, v_item.claim_id, 'note_added',
          'Forderungsposition gelöscht: ' || coalesce(v_item.description, '') || ' (' || v_item.original_amount || ' EUR)',
          jsonb_build_object('source', 'item_deleted', 'item_id', p_item_id, 'description', v_item.description,
                             'amount', v_item.original_amount, 'fee_amount', v_item.fee_amount,
                             'interest_amount', v_item.interest_amount, 'fees_moved_to_item', v_moved_to,
                             'deleted_by', v_caller));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_portfolio(p_portfolio_id uuid, p_target_id uuid DEFAULT NULL::uuid, p_delete_properties boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_src public.portfolios%rowtype;
    v_n int;
    v_dupes text;
    v_we_ids uuid[];
    v_result jsonb := '{}'::jsonb;
begin
    if v_uid is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_portfolio_id is null then
        raise exception 'Kein Portfolio angegeben.';
    end if;

    -- Quelle sperren (gleichzeitige Löschungen/Überträge serialisieren); nur der Eigentümer
    select * into v_src from public.portfolios po where po.id = p_portfolio_id for update;
    if not found or v_src.user_id is distinct from v_uid then
        raise exception 'Nur der Eigentümer kann dieses Portfolio löschen.';
    end if;
    if coalesce(v_src.is_primary, false) then
        raise exception 'Das Hauptportfolio kann nicht gelöscht werden.';
    end if;

    if p_target_id is not null then
        if p_target_id = p_portfolio_id then
            raise exception 'Bitte wählen Sie ein anderes Portfolio als Ziel.';
        end if;
        perform 1 from public.portfolios po where po.id = p_target_id and po.user_id = v_uid for update;
        if not found then
            raise exception 'Bitte wählen Sie eines Ihrer eigenen Portfolios als Ziel.';
        end if;

        -- Doppelte Rechnungsnummern würden den Übertrag am Unique-Index scheitern lassen
        select string_agg(num, ', ') into v_dupes
          from (select distinct s.invoice_number as num
                  from public.invoices s
                  join public.invoices d on d.portfolio_id = p_target_id and d.invoice_number = s.invoice_number
                 where s.portfolio_id = p_portfolio_id
                 order by 1
                 limit 3) x;
        if v_dupes is not null then
            raise exception 'Im Zielportfolio gibt es bereits Rechnungen mit denselben Nummern (z. B. %). Die Rechnungen können deshalb nicht übertragen werden. Bitte wählen Sie ein anderes Zielportfolio. Es wurde nichts verändert.', v_dupes;
        end if;

        update public.properties set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('properties', v_n);

        update public.meters set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('meters', v_n);

        update public.meter_readings set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('meter_readings', v_n);

        update public.invoices set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('invoices', v_n);

        update public.loans set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('loans', v_n);

        update public.deals set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('deals', v_n);

        -- Rechnungsnummern-Zähler: gleicher Zähler im Ziel -> höchster Stand; sonst umhängen.
        -- Zusammengeführte Quell-Zähler entfallen mit dem Portfolio (CASCADE).
        update public.invoice_counters d
           set last_number = greatest(d.last_number, s.last_number)
          from public.invoice_counters s
         where s.portfolio_id = p_portfolio_id
           and d.portfolio_id = p_target_id
           and d.year = s.year
           and d.object_unit_id is not distinct from s.object_unit_id;
        update public.invoice_counters s
           set portfolio_id = p_target_id
         where s.portfolio_id = p_portfolio_id
           and not exists (select 1 from public.invoice_counters d
                            where d.portfolio_id = p_target_id
                              and d.year = s.year
                              and d.object_unit_id is not distinct from s.object_unit_id);

        -- Portfolio-Vorlagen: übernehmen, sofern das Ziel keine Vorlage gleichen Typs hat (sonst entfallen sie)
        delete from public.document_templates s
         where s.portfolio_id = p_portfolio_id
           and exists (select 1 from public.document_templates d
                        where d.portfolio_id = p_target_id and d.type = s.type);
        update public.document_templates set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('document_templates', v_n);

        -- PDF-Vorlage (eine je Portfolio): nur übernehmen, wenn das Ziel noch keine hat
        if not exists (select 1 from public.pdf_templates where portfolio_id = p_target_id) then
            update public.pdf_templates
               set portfolio_id = p_target_id
             where id = (select t.id from public.pdf_templates t where t.portfolio_id = p_portfolio_id limit 1);
        end if;
    else
        if exists (select 1 from public.invoices where portfolio_id = p_portfolio_id) then
            raise exception 'Dieses Portfolio enthält Rechnungen. Rechnungen unterliegen Aufbewahrungspflichten (§ 147 AO, § 14b UStG) und werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio.';
        end if;
        if exists (select 1 from public.loans l
                    where l.portfolio_id = p_portfolio_id
                       or l.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)) then
            raise exception 'Dieses Portfolio enthält Darlehen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder löschen Sie die Darlehen zuerst unter „Finanzierungen“.';
        end if;

        if exists (select 1 from public.properties where portfolio_id = p_portfolio_id) then
            if not coalesce(p_delete_properties, false) then
                raise exception 'Dieses Portfolio enthält Immobilien. Bitte wählen Sie ein Ziel-Portfolio für die Übertragung aus ODER bestätigen Sie die endgültige Löschung.';
            end if;
            if exists (select 1 from public.documents doc
                        where doc.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)
                           or doc.unit_id in (select u.id from public.units u
                                                join public.properties pr on pr.id = u.property_id
                                               where pr.portfolio_id = p_portfolio_id))
               or exists (select 1 from public.claims c
                            join public.leases l on l.id = c.lease_id
                            join public.units u on u.id = l.unit_id
                            join public.properties pr on pr.id = u.property_id
                           where pr.portfolio_id = p_portfolio_id) then
                raise exception 'Zu den Objekten gibt es noch Dokumente oder Forderungsakten. Diese verhindern das Löschen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder entfernen Sie Dokumente/Forderungen zuerst.';
            end if;
            if exists (select 1 from public.leases l
                         join public.units u on u.id = l.unit_id
                         join public.properties pr on pr.id = u.property_id
                        where pr.portfolio_id = p_portfolio_id) then
                raise exception 'Zu den Objekten gibt es noch Mietverträge. Mietverträge mit Mietkonto und Zahlungen werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder entfernen Sie die Mietverträge zuerst.';
            end if;
            if exists (select 1 from public.utility_settlements us
                        where us.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)) then
                raise exception 'Zu den Objekten gibt es noch Nebenkostenabrechnungen. Diese werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio.';
            end if;

            select coalesce(array_agg(distinct pr.economic_unit_id), '{}'::uuid[]) into v_we_ids
              from public.properties pr
             where pr.portfolio_id = p_portfolio_id and pr.economic_unit_id is not null;

            -- Objekte mit Einheiten, Zählern usw. (Fremdschlüssel); weitere Sperren der DB brechen alles ab
            delete from public.properties where portfolio_id = p_portfolio_id;
            get diagnostics v_n = row_count;
            v_result := v_result || jsonb_build_object('properties_deleted', v_n);

            -- Verwaiste Wirtschaftseinheiten ohne Darlehen und NK-Abrechnungen entfernen
            delete from public.economic_units e
             where e.id = any(v_we_ids)
               and not exists (select 1 from public.properties pr where pr.economic_unit_id = e.id)
               and not exists (select 1 from public.loans l where l.economic_unit_id = e.id)
               and not exists (select 1 from public.utility_settlements us where us.economic_unit_id = e.id);
        end if;

        -- Portfolio-eigene Schreibvorlagen entfallen mit dem Portfolio (unabhängig vom Fremdschlüssel)
        delete from public.document_templates where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('document_templates_deleted', v_n);
    end if;

    delete from public.portfolios po
     where po.id = p_portfolio_id
       and po.user_id = v_uid
       and coalesce(po.is_primary, false) = false;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
        raise exception 'Das Portfolio wurde nicht gelöscht (keine Berechtigung).';
    end if;

    return v_result || jsonb_build_object('deleted', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_tenant_completely(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_landlord_id uuid;
  v_account_ids uuid[];
  v_uid uuid;
begin
  select user_id into v_landlord_id from public.tenants where id = p_tenant_id;

  if v_caller is null or v_landlord_id is null or v_landlord_id <> v_caller then
    raise exception 'Not authorized to delete this tenant';
  end if;

  if exists (select 1 from public.leases l
              where l.tenant_id = p_tenant_id
                and (l.end_date >= current_date
                     or (l.end_date is null and l.status = 'active'))) then
    raise exception 'Der Mieter hat einen laufenden oder künftigen Mietvertrag und kann deshalb nicht gelöscht werden. Bitte beenden Sie zuerst das Mietverhältnis oder entziehen Sie nur den Portalzugang.'
      using hint = 'tenant_has_active_lease';
  end if;

  if exists (select 1 from public.claims c
              where (c.tenant_id = p_tenant_id
                     or c.lease_id in (select l.id from public.leases l where l.tenant_id = p_tenant_id))
                and c.status not in ('settled', 'cancelled', 'archived')) then
    raise exception 'Für den Mieter bestehen noch offene Forderungen. Bitte schließen Sie diese zuerst ab (erledigt oder storniert) oder entziehen Sie nur den Portalzugang.'
      using hint = 'tenant_has_open_claims';
  end if;

  select coalesce(array_agg(distinct ur.user_id), '{}')
    into v_account_ids
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  where ur.tenant_id = p_tenant_id
    and ur.role = 'tenant'
    and ur.user_id <> v_caller
    and exists (select 1 from public.tenant_invitations i
                where i.tenant_id = p_tenant_id
                  and lower(trim(i.email)) = lower(trim(u.email)));

  update public.documents set tenant_id = null where tenant_id = p_tenant_id;
  update public.claims set tenant_id = null where tenant_id = p_tenant_id;
  update public.leases set tenant_id = null where tenant_id = p_tenant_id;
  update public.contacts set tenant_id = null where tenant_id = p_tenant_id;

  delete from public.tenant_verification_links where tenant_id = p_tenant_id;
  delete from public.tenant_invitations where tenant_id = p_tenant_id;
  delete from public.user_roles where tenant_id = p_tenant_id;

  foreach v_uid in array v_account_ids loop
    if not exists (select 1 from public.user_roles where user_id = v_uid)
       and not exists (select 1 from public.portfolios where user_id = v_uid)
       and not exists (select 1 from public.properties where user_id = v_uid)
       and not exists (select 1 from public.tenants where user_id = v_uid)
    then
      begin
        delete from public.profiles where id = v_uid;
        delete from auth.users where id = v_uid;
      exception when foreign_key_violation then
        null;
      end;
    end if;
  end loop;

  delete from public.tenants where id = p_tenant_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.economic_unit_is_linked(check_economic_unit_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.properties pr
                 where pr.economic_unit_id = check_economic_unit_id)
$function$
;
CREATE OR REPLACE FUNCTION public.floor_plan_can_write(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select case
             when fp.property_id is not null then
               public.has_property_access(fp.property_id, 'immobilien', 'write')
               or public.has_property_access(fp.property_id, 'investorportal', 'write')
             when fp.unit_id is not null then
               public.has_unit_access(fp.unit_id, 'immobilien', 'write')
               or public.has_unit_access(fp.unit_id, 'investorportal', 'write')
             else fp.user_id = (select auth.uid())
           end
    from public.floor_plans fp
    where fp.id = p_plan_id
  ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.floor_plans_user_id_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_kind text;
    v_ref uuid;
    v_old_kind text;
    v_old_ref uuid;
    v_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer. ON DELETE SET NULL beim Löschen eines
    -- Objekts/einer Einheit (läuft als Tabelleneigentümer), RPCs und Server bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    -- Maßgeblich ist wie in den Policies die Zuordnung: Objekt, sonst Einheit.
    if new.property_id is not null then
        v_kind := 'property';
        v_ref := new.property_id;
    elsif new.unit_id is not null then
        v_kind := 'unit';
        v_ref := new.unit_id;
    else
        -- Ohne Zuordnung verlangt die Update-Policy ohnehin user_id = auth.uid().
        return new;
    end if;

    -- Eigenes Konto oder Eigentümer der Zuordnung: wie beim Anlegen erlaubt.
    if public.rls_user_ok(new.user_id, v_kind, v_ref) then
        return new;
    end if;

    -- Ein anderes Konto nur, wenn user_id unverändert bleibt …
    if new.user_id is distinct from old.user_id then
        raise exception 'user_id kann nur auf das eigene Konto oder den Eigentümer der Daten geändert werden.'
            using errcode = '42501';
    end if;

    -- … und die Zuordnung gleich bleibt (z. B. Plan eines Teammitglieds bearbeiten).
    if old.property_id is not null then
        v_old_kind := 'property';
        v_old_ref := old.property_id;
    elsif old.unit_id is not null then
        v_old_kind := 'unit';
        v_old_ref := old.unit_id;
    end if;
    if v_old_kind is not distinct from v_kind and v_old_ref is not distinct from v_ref then
        return new;
    end if;

    -- Neu zugeordnet und die bisherige user_id passt nicht: Eigentümer der neuen Zuordnung,
    -- sonst fiele der Plan beim Löschen des Objekts an das bisherige Konto zurück.
    if v_kind = 'property' then
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = v_ref;
    else
        select po.user_id into v_owner
          from public.units u
          join public.properties pr on pr.id = u.property_id
          join public.portfolios po on po.id = pr.portfolio_id
         where u.id = v_ref;
    end if;
    new.user_id := coalesce(v_owner, auth.uid());
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_claim_access_link(p_claim_id uuid, p_token text, p_pin text, p_expires_days integer DEFAULT 14)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_claim_owner uuid;
  v_token text := btrim(coalesce(p_token, ''));
  v_pin text := btrim(coalesce(p_pin, ''));
  v_days integer := coalesce(p_expires_days, 14);
  v_bytes bytea;
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;

  select c.user_id into v_claim_owner from public.claims c where c.id = p_claim_id;
  if not found
     or (v_claim_owner is distinct from v_uid
         and not coalesce(public.has_claim_access(p_claim_id, 'finanzen', 'write'), false)) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung, einen Portal-Link zu erstellen.'
      using errcode = '42501';
  end if;

  if v_days < 1 or v_days > 90 then
    raise exception 'Die Gültigkeit des Portal-Links muss zwischen 1 und 90 Tagen liegen.';
  end if;

  if length(v_token) < 32 or length(v_token) > 128 or v_token !~ '^[A-Za-z0-9_-]+$'
     or exists (select 1 from public.claim_access_links l
                 where l.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')) then
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  if v_pin !~ '^[0-9]{5,8}$' then
    v_bytes := extensions.gen_random_bytes(4);
    v_pin := (100000 + ((get_byte(v_bytes, 0)::bigint * 16777216
                         + get_byte(v_bytes, 1) * 65536
                         + get_byte(v_bytes, 2) * 256
                         + get_byte(v_bytes, 3)) % 900000))::text;
  end if;

  update public.claim_access_links
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where claim_id = p_claim_id
     and (is_active is distinct from false or revoked_at is null);

  insert into public.claim_access_links (claim_id, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          now() + make_interval(days => v_days),
          v_uid,
          true)
  returning id into v_link_id;

  return v_link_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select u.id
    from auth.users u
   where p_email is not null
     and btrim(p_email) <> ''
     and lower(btrim(u.email)) = lower(btrim(p_email))
   order by u.created_at
   limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_investor_properties(uid uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select pr.id
    from public.properties pr
   where pr.user_id = uid
     and auth.uid() is not null
     and (uid = auth.uid() or public.has_property_access(pr.id, '*', 'read'));
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_landlord_info(p_property_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_role record;
    v_property_id uuid;
    v_property_owner uuid;
    v_portfolio_owner uuid;
    v_visible boolean;
    v_text text;
begin
    if v_uid is null then
        return null;
    end if;

    select ur.tenant_id, ur.unit_id, ur.property_id into v_role
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'tenant'
    order by ur.created_at desc nulls last
    limit 1;

    if not found then
        return null;
    end if;

    if p_property_id is not null then
        if p_property_id is distinct from v_role.property_id
           and not exists (select 1 from public.units u
                           where u.id = v_role.unit_id
                             and u.property_id = p_property_id)
           and not exists (select 1 from public.leases l
                           join public.units u on u.id = l.unit_id
                           where v_role.tenant_id is not null
                             and l.tenant_id = v_role.tenant_id
                             and u.property_id = p_property_id) then
            return null;
        end if;
        v_property_id := p_property_id;
    else
        v_property_id := coalesce(
            v_role.property_id,
            (select u.property_id from public.units u where u.id = v_role.unit_id)
        );
    end if;

    if v_property_id is null then
        return null;
    end if;

    select pr.user_id, po.user_id
      into v_property_owner, v_portfolio_owner
    from public.properties pr
    left join public.portfolios po on po.id = pr.portfolio_id
    where pr.id = v_property_id;

    if not found then
        return null;
    end if;

    -- Öffnungszeiten aus dem Profil des Portfolio-Eigentümers (wie bisher in der Topbar)
    select p.settings_opening_hours_visible, p.settings_opening_hours_text
      into v_visible, v_text
    from public.profiles p
    where p.id = coalesce(v_portfolio_owner, v_property_owner);

    return json_build_object(
        'property_id', v_property_id,
        'landlord_user_id', coalesce(v_property_owner, v_portfolio_owner),
        'opening_hours_visible', v_visible,
        'opening_hours_text', v_text
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select r.role from public.user_roles r
  where r.user_id = auth.uid()
  order by r.created_at, r.id
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_tenancy()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_role record;
    v_tenant json;
    v_leases json;
    v_role_unit json;
begin
    if v_uid is null then
        return null;
    end if;

    select ur.tenant_id, ur.unit_id, ur.property_id into v_role
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'tenant'
      and ur.tenant_id is not null
    order by ur.created_at desc nulls last
    limit 1;

    if not found then
        return null;
    end if;

    select json_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
      into v_tenant
    from public.tenants t
    where t.id = v_role.tenant_id;

    select coalesce(json_agg(x.obj order by x.sort_active, x.start_date desc), '[]'::json)
      into v_leases
    from (
        select l.start_date,
               case when lower(l.status) in ('active', 'aktiv') then 0 else 1 end as sort_active,
               json_build_object(
                   'id', l.id,
                   'status', l.status,
                   'start_date', l.start_date,
                   'end_date', l.end_date,
                   'cold_rent', l.cold_rent,
                   'service_charge', l.service_charge,
                   'heating_cost', l.heating_cost,
                   'other_costs', l.other_costs,
                   'deposit', l.deposit,
                   'payment_due_day', l.payment_due_day,
                   'unit', json_build_object(
                       'id', u.id,
                       'unit_name', u.unit_name,
                       'floor', u.floor,
                       'sqm', u.sqm,
                       'rooms', u.rooms,
                       'property', json_build_object(
                           'id', p.id,
                           'street', p.street,
                           'house_number', p.house_number,
                           'zip', p.zip,
                           'city', p.city
                       )
                   )
               ) as obj
        from public.leases l
        join public.units u on u.id = l.unit_id
        join public.properties p on p.id = u.property_id
        where l.tenant_id = v_role.tenant_id
    ) x;

    if v_role.unit_id is not null then
        select json_build_object(
                   'id', u.id,
                   'unit_name', u.unit_name,
                   'floor', u.floor,
                   'sqm', u.sqm,
                   'rooms', u.rooms,
                   'property', json_build_object(
                       'id', p.id,
                       'street', p.street,
                       'house_number', p.house_number,
                       'zip', p.zip,
                       'city', p.city
                   )
               )
          into v_role_unit
        from public.units u
        join public.properties p on p.id = u.property_id
        where u.id = v_role.unit_id;
    end if;

    return json_build_object(
        'tenant_id', v_role.tenant_id,
        'unit_id', v_role.unit_id,
        'property_id', v_role.property_id,
        'tenant', v_tenant,
        'leases', v_leases,
        'role_unit', v_role_unit
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_next_invoice_number(p_portfolio_id uuid, p_object_unit_id uuid, p_year integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- p_object_unit_id wird bewusst ignoriert (Parameter bleibt für ältere Aufrufer): Rechnungsnummern sind
-- je Portfolio eindeutig (invoices (portfolio_id, invoice_number)), deshalb zählt EIN Zähler je Portfolio
-- und Jahr (object_unit_id NULL). Ältere Zähler je Einheit und bereits vergebene Nummern „JJJJ-NNN“
-- fließen als Untergrenze ein.
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
  v_counter bigint;
  v_used numeric;
  v_next numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if p_portfolio_id is null or p_year is null then
    raise exception 'Portfolio und Jahr sind erforderlich.';
  end if;

  select user_id into v_owner from public.portfolios where id = p_portfolio_id;
  if v_owner is null
     or (v_owner <> v_caller and not public.has_portfolio_access(p_portfolio_id, 'finanzen', 'write')) then
    raise exception 'Portfolio nicht gefunden oder keine Berechtigung.';
  end if;

  -- Vergabe je Portfolio und Jahr serialisieren
  perform pg_advisory_xact_lock(hashtextextended(
    'invoice_counter:' || p_portfolio_id::text || ':' || p_year::text, 0));

  select max(c.last_number) into v_counter
    from public.invoice_counters c
   where c.portfolio_id = p_portfolio_id
     and c.year = p_year;

  select max(substring(btrim(i.invoice_number) from ('^' || p_year::text || '-([0-9]+)$'))::numeric)
    into v_used
    from public.invoices i
   where i.portfolio_id = p_portfolio_id;

  v_next := greatest(coalesce(v_counter, 0), coalesce(v_used, 0)) + 1;
  if v_next > 2147483647 then
    raise exception 'Rechnungsnummer konnte nicht vergeben werden.';
  end if;

  select c.id into v_id
    from public.invoice_counters c
   where c.portfolio_id = p_portfolio_id
     and c.year = p_year
     and c.object_unit_id is null
     for update;

  if v_id is null then
    insert into public.invoice_counters (user_id, portfolio_id, year, object_unit_id, last_number)
    values (v_owner, p_portfolio_id, p_year, null, v_next::integer);
  else
    update public.invoice_counters
       set last_number = v_next::integer
     where id = v_id;
  end if;

  return p_year::text || '-' || case when v_next < 1000 then lpad(v_next::text, 3, '0') else v_next::text end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pending_invitations()
 RETURNS TABLE(id uuid, portfolio_id uuid, portfolio_name text, sender_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        return;
    end if;

    return query
    select
        ps.id,
        ps.portfolio_id,
        p.name as portfolio_name,
        coalesce(pr.first_name || ' ' || pr.last_name, p.company_name, 'Unbekannt') as sender_name,
        ps.created_at
    from public.portfolio_shares ps
    join public.portfolios p on p.id = ps.portfolio_id
    left join public.profiles pr on pr.id = p.user_id
    where lower(ps.shared_with_email) = v_email
      and ps.status = 'pending'
      and p.user_id = ps.created_by;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_claim_by_token(p_token text, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_access jsonb;
  v_claim public.claims%rowtype;
  v_allow boolean;
  v_options jsonb;
  v_request_open boolean;
  v_request_allowed boolean;
  v_result json;
begin
  v_access := public.claim_portal_check_access(p_token, p_pin);

  if not coalesce((v_access ->> 'ok')::boolean, false) then
    if v_access ->> 'code' in ('invalid_pin', 'link_locked') then
      return json_build_object(
        'error', v_access ->> 'error',
        'code', v_access ->> 'code',
        'attempts_left', v_access -> 'attempts_left');
    end if;
    raise exception using message = v_access ->> 'error', hint = v_access ->> 'code';
  end if;

  select * into v_claim from public.claims c where c.id = (v_access ->> 'claim_id')::uuid;

  if not found or v_claim.status in ('cancelled', 'archived') then
    raise exception using message = 'Diese Forderung ist bereits abgeschlossen oder storniert.', hint = 'claim_closed';
  end if;

  select coalesce(p.claim_portal_allow_installments, true),
         public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_allow, v_options
    from public.profiles p
   where p.id = v_claim.user_id;
  if not found then
    v_allow := true;
    v_options := public.claim_portal_installment_options(null);
  end if;

  v_request_open := exists (select 1 from public.payment_plan_requests r
                             where r.claim_id = v_claim.id and r.status = 'requested');
  v_request_allowed := public.claim_portal_plan_request_block_reason(v_claim.id) is null;

  select json_build_object(
      'claim_id', v_claim.id,
      'link_id', (v_access ->> 'link_id')::uuid,
      'status', v_claim.status,
      'deadline', v_claim.deadline,
      'interest_rate', v_claim.interest_rate,
      'accumulated_unpaid_fees', v_claim.accumulated_unpaid_fees,
      'accumulated_unpaid_interest', v_claim.accumulated_unpaid_interest,
      'tenant', (select json_build_object('first_name', t.first_name, 'last_name', t.last_name)
                   from public.tenants t where t.id = v_claim.tenant_id),
      'lease', (
          select json_build_object(
              'unit', (
                  select json_build_object(
                      'unit_name', u.unit_name,
                      'property', (select json_build_object('street', pr.street, 'house_number', pr.house_number,
                                                            'city', pr.city, 'zip', pr.zip)
                                     from public.properties pr where pr.id = u.property_id)
                  )
                  from public.units u where u.id = l.unit_id
              )
          ) from public.leases l where l.id = v_claim.lease_id
      ),
      'items', (
          select json_agg(json_build_object(
              'id', ci.id,
              'item_type', ci.item_type,
              'description', ci.description,
              'original_amount', ci.original_amount,
              'created_at', ci.created_at,
              'fee_amount', ci.fee_amount,
              'interest_amount', ci.interest_amount,
              'open_amount', cv.open_amount
          ))
          from public.claim_items ci
          left join public.claim_item_totals_view cv on cv.claim_item_id = ci.id
          where ci.claim_id = v_claim.id
      ),
      'totals', (
          select json_build_object(
              'total_due', tv.total_due,
              'current_principal_open', tv.current_principal_open,
              'total_fees_open', tv.total_fees_open,
              'total_interest_open', tv.total_interest_open
          )
          from public.claim_totals_view tv where tv.claim_id = v_claim.id
      ),
      'settings', json_build_object(
          'allow_installments', v_allow,
          'installment_options', v_options
      ),
      'payment_plan_request_open', v_request_open,
      'payment_plan_request_allowed', v_request_allowed,
      'bank_details', (
          select json_build_object(
              'account_holder', coalesce(p.bank_account_holder, ''),
              'iban', coalesce(p.iban, ''),
              'bic', coalesce(p.bic, '')
          )
          from public.profiles p where p.id = v_claim.user_id
      )
  ) into v_result;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_rental_applicant_for_booking(p_token text, p_applicant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process_id uuid;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
    v_app record;
    v_booking json;
begin
    if p_applicant_id is null then
        return null;
    end if;

    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';
    if v_process_id is null then
        return null;
    end if;

    select a.id, a.first_name, a.last_name, a.status into v_app
    from public.rental_applicants a
    where a.id = p_applicant_id and a.process_id = v_process_id;
    if not found then
        return null;
    end if;

    select json_build_object(
               'id', b.id,
               'viewing_id', b.viewing_id,
               'date', v.date,
               'start_time', to_char(b.start_time, 'HH24:MI:SS'),
               'end_time', to_char(b.end_time, 'HH24:MI:SS')
           )
      into v_booking
    from public.rental_viewing_bookings b
    join public.rental_viewings v on v.id = b.viewing_id
    where b.applicant_id = v_app.id
      and b.status = 'booked'
      and v.process_id = v_process_id
      and v.date >= v_today
    order by v.date, b.start_time
    limit 1;

    return json_build_object(
        'id', v_app.id,
        'first_name', v_app.first_name,
        'last_name', v_app.last_name,
        'can_book', v_app.status not in ('declined', 'accepted', 'contract_declined'),
        'booking', v_booking
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_rental_process_by_token(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process record;
    v_unit record;
    v_property record;
begin
    select * into v_process
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if not found then
        return json_build_object('error', 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
    end if;

    select * into v_unit
    from public.units
    where id = v_process.unit_id;

    if not found then
        return json_build_object('error', 'Einheit nicht gefunden.');
    end if;

    select * into v_property
    from public.properties
    where id = v_unit.property_id;

    return json_build_object(
        'id', v_process.id,
        'listing_title', coalesce(v_process.listing_title, ''),
        'listing_description', coalesce(v_process.listing_description, ''),
        'required_documents', coalesce(v_process.required_documents, '{}'::text[]),
        'custom_requirements', coalesce(v_process.custom_requirements, '{}'::text[]),
        'unit_name', v_unit.unit_name,
        'floor', coalesce(v_unit.floor, ''),
        'sqm', coalesce(v_unit.sqm, 0),
        'rooms', coalesce(v_unit.rooms, 0),
        'bathrooms', coalesce(v_unit.bathrooms, 0),
        'bedrooms', coalesce(v_unit.bedrooms, 0),
        'balcony', coalesce(v_unit.balcony, false),
        'fitted_kitchen', coalesce(v_unit.fitted_kitchen, false),
        'target_rent', coalesce(v_unit.target_rent, 0),
        'service_charge_soll', coalesce(v_unit.service_charge_soll, 0),
        'heating_cost_soll', coalesce(v_unit.heating_cost_soll, 0),
        'street', v_property.street,
        'house_number', coalesce(v_property.house_number, ''),
        'city', v_property.city,
        'zip', coalesce(v_property.zip, '')
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_rental_viewing_schedule(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process_id uuid;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if v_process_id is null then
        return json_build_object('error', 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
    end if;

    return json_build_object(
        'viewings', coalesce((
            select json_agg(json_build_object(
                       'id', v.id,
                       'date', v.date,
                       'start_time', to_char(v.start_time, 'HH24:MI:SS'),
                       'end_time', to_char(v.end_time, 'HH24:MI:SS'),
                       'slot_duration_minutes', v.slot_duration_minutes
                   ) order by v.date, v.start_time)
            from public.rental_viewings v
            where v.process_id = v_process_id
              and v.date >= v_today
              and v.slot_duration_minutes > 0
        ), '[]'::json),
        'booked', coalesce((
            select json_agg(json_build_object(
                       'viewing_id', b.viewing_id,
                       'start_time', to_char(b.start_time, 'HH24:MI:SS')
                   ))
            from public.rental_viewing_bookings b
            join public.rental_viewings v on v.id = b.viewing_id
            where v.process_id = v_process_id
              and v.date >= v_today
              and b.status = 'booked'
        ), '[]'::json)
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_smtp_password(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d.decrypted_secret
    from public.user_smtp_settings s
    join vault.decrypted_secrets d
      on d.id = s.smtp_pass_secret_id
     and d.name = 'smtp_pass:' || s.user_id::text
   where s.user_id = p_user_id
   limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_tenant_auth_info()
 RETURNS TABLE(tenant_user_id uuid, tenant_id uuid, registered_email character varying, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select ur.user_id, ur.tenant_id, u.email::character varying, u.last_sign_in_at
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  join public.tenants t on t.id = ur.tenant_id
  where ur.role = 'tenant'
    and auth.uid() is not null
    and (ur.user_id = auth.uid()
         or public.has_tenant_access(t.id, 'mietverhaeltnisse', 'read'))
$function$
;
CREATE OR REPLACE FUNCTION public.get_tenant_by_token(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hash text := public.tenant_link_token_hash(p_token);
  v_link public.tenant_verification_links%rowtype;
  v_tenant public.tenants%rowtype;
  v_unit_name text;
  v_prop_street text;
  v_prop_house_number text;
  v_prop_postal_code text;
  v_prop_city text;
  v_use_property boolean;
begin
  if v_hash is null then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  select * into v_link
  from public.tenant_verification_links
  where token_hash = v_hash and expires_at > now()
  limit 1;

  if not found then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  if v_link.is_updated then
    return json_build_object(
      'error', 'Dieser Link wurde bereits verwendet. Wenn Sie weitere Änderungen mitteilen möchten, wenden Sie sich bitte an Ihren Vermieter.',
      'used', true);
  end if;

  select * into v_tenant from public.tenants where id = v_link.tenant_id;
  if not found then
    return json_build_object('error', 'Mieter nicht gefunden.');
  end if;

  select u.unit_name, p.street, p.house_number, p.zip, p.city
    into v_unit_name, v_prop_street, v_prop_house_number, v_prop_postal_code, v_prop_city
  from public.leases l
  join public.units u on u.id = l.unit_id
  join public.properties p on p.id = u.property_id
  where l.tenant_id = v_tenant.id and l.status = 'active'
  order by l.start_date desc nulls last, l.id
  limit 1;

  v_use_property := coalesce(nullif(btrim(v_tenant.street), ''), nullif(btrim(v_tenant.house_number), ''),
                             nullif(btrim(v_tenant.postal_code), ''), nullif(btrim(v_tenant.city), '')) is null
                    and v_prop_street is not null;

  return json_build_object(
    'first_name', v_tenant.first_name,
    'last_name', v_tenant.last_name,
    'street', coalesce(case when v_use_property then v_prop_street else v_tenant.street end, ''),
    'house_number', coalesce(case when v_use_property then v_prop_house_number else v_tenant.house_number end, ''),
    'postal_code', coalesce(case when v_use_property then v_prop_postal_code else v_tenant.postal_code end, ''),
    'city', coalesce(case when v_use_property then v_prop_city else v_tenant.city end, ''),
    'address_from_property', v_use_property,
    'phone', coalesce(v_tenant.phone, ''),
    'email', coalesce(v_tenant.email, ''),
    'unit_name', coalesce(v_unit_name, 'Keine aktive Zuordnung'),
    'expires_at', v_link.expires_at,
    'is_updated', v_link.is_updated
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_claim_access(check_claim_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.claims c
    join public.leases l on l.id = c.lease_id
    join public.units u on u.id = l.unit_id
    join public.properties pr on pr.id = u.property_id
    where c.id = check_claim_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$function$
;
CREATE OR REPLACE FUNCTION public.has_economic_unit_access(check_economic_unit_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and check_economic_unit_id is not null
     and (
       exists (select 1 from public.economic_units e
               where e.id = check_economic_unit_id and e.user_id = auth.uid())
       or exists (select 1 from public.properties pr
                  where pr.economic_unit_id = check_economic_unit_id
                    and public.has_portfolio_access(pr.portfolio_id, category, access_type))
       or (not exists (select 1 from public.properties pr
                       where pr.economic_unit_id = check_economic_unit_id)
           and exists (select 1 from public.economic_units e
                       join public.portfolios po on po.user_id = e.user_id
                       where e.id = check_economic_unit_id
                         and public.has_portfolio_access(po.id, category, access_type)))
     )
$function$
;
CREATE OR REPLACE FUNCTION public.has_invoice_access(check_invoice_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.invoices i
    where i.id = check_invoice_id
      and public.has_portfolio_access(i.portfolio_id, category, access_type))
$function$
;
CREATE OR REPLACE FUNCTION public.has_lease_access(check_lease_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.leases l
    join public.units u on u.id = l.unit_id
    join public.properties pr on pr.id = u.property_id
    where l.id = check_lease_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$function$
;
CREATE OR REPLACE FUNCTION public.has_portfolio_access(check_portfolio_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and check_portfolio_id is not null
     and (
       exists (select 1 from public.portfolios p
               where p.id = check_portfolio_id and p.user_id = auth.uid())
       or exists (select 1 from public.portfolio_shares s
                  where s.portfolio_id = check_portfolio_id
                    and s.status = 'accepted'
                    and lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    and public.share_permits(s.permissions, category, access_type))
     )
$function$
;
CREATE OR REPLACE FUNCTION public.has_property_access(check_property_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.properties pr
    where pr.id = check_property_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$function$
;
CREATE OR REPLACE FUNCTION public.has_renovation_calculation_access(check_calc_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.renovation_calculations c
    where c.id = check_calc_id
      and (c.user_id = auth.uid()
           or public.has_property_access(c.property_id, category, access_type)))
$function$
;
CREATE OR REPLACE FUNCTION public.has_renovation_project_access(check_project_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.renovation_projects p
    where p.id = check_project_id
      and (p.user_id = auth.uid()
           or public.has_property_access(p.property_id, category, access_type)))
$function$
;
CREATE OR REPLACE FUNCTION public.has_tenant_access(check_tenant_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
     and check_tenant_id is not null
     and (
       exists (select 1 from public.tenants t
               where t.id = check_tenant_id and t.user_id = auth.uid())
       or exists (select 1 from public.tenants t
                  join public.leases l on l.tenant_id = t.id
                  join public.units u on u.id = l.unit_id
                  join public.properties pr on pr.id = u.property_id
                  join public.portfolios po on po.id = pr.portfolio_id
                  where t.id = check_tenant_id
                    and po.user_id = t.user_id
                    and public.has_portfolio_access(pr.portfolio_id, category, access_type))
     )
$function$
;
CREATE OR REPLACE FUNCTION public.has_unit_access(check_unit_id uuid, category text, access_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.units u
    join public.properties pr on pr.id = u.property_id
    where u.id = check_unit_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$function$
;
CREATE OR REPLACE FUNCTION public.import_rows(p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
    c_max constant integer := 5000;
    v_uid uuid := auth.uid();
    v_list text;
    v_item jsonb;
    v_i integer;
    v_idx integer;
    v_id uuid;
    v_ref uuid;
    v_unit_id uuid;
    v_tenant_id uuid;
    v_rows text;
    v_ctx text;
    v_portfolio_ids uuid[] := '{}';
    v_property_ids uuid[] := '{}';
    v_unit_ids uuid[] := '{}';
    v_tenant_ids uuid[] := '{}';
    v_leases integer := 0;
    v_booking integer := 0;
    v_booking_start date;
    v_state text;
    v_msg text;
    v_detail text;
    v_hint text;
    v_column text;
    v_constraint text;
    v_reason text;
begin
    if v_uid is null then
        raise exception 'Nicht angemeldet.' using errcode = '42501';
    end if;
    if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
        raise exception 'Ungültiger Importplan.' using errcode = '22023';
    end if;
    foreach v_list in array array['portfolios', 'properties', 'units', 'tenants', 'leases'] loop
        if p_plan ? v_list and jsonb_typeof(p_plan -> v_list) <> 'array' then
            raise exception 'Ungültiger Importplan (%).', v_list using errcode = '22023';
        end if;
        if jsonb_array_length(coalesce(p_plan -> v_list, '[]'::jsonb)) > c_max then
            raise exception 'Zu viele Einträge im Import (%): höchstens % je Art.', v_list, c_max using errcode = '22023';
        end if;
    end loop;

    begin
        -- 1. Portfolios
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'portfolios', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Portfolio „' || coalesce(v_item ->> 'name', '') || '“ konnte nicht angelegt werden';

            insert into public.portfolios (user_id, name)
            values (v_uid, nullif(btrim(v_item ->> 'name'), ''))
            returning id into v_id;
            v_portfolio_ids[v_i] := v_id;
        end loop;

        -- 2. Immobilien
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'properties', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Immobilie ' || btrim(coalesce(v_item ->> 'street', '') || ' ' || coalesce(v_item ->> 'house_number', ''))
                     || ' konnte nicht angelegt werden';

            v_ref := nullif(v_item ->> 'portfolio_id', '')::uuid;
            if v_ref is null then
                v_idx := (v_item ->> 'portfolio_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_portfolio_ids, 1), 0) then
                    v_ref := v_portfolio_ids[v_idx + 1];
                end if;
                if v_ref is null then
                    raise exception 'Verweis auf das Portfolio fehlt im Importplan.';
                end if;
            elsif not exists (select 1 from public.portfolios po where po.id = v_ref and po.user_id = v_uid) then
                raise exception 'Das Portfolio wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            insert into public.properties (user_id, portfolio_id, street, house_number, zip, city, construction_year, property_type)
            values (v_uid, v_ref,
                    nullif(btrim(v_item ->> 'street'), ''),
                    nullif(btrim(v_item ->> 'house_number'), ''),
                    nullif(btrim(v_item ->> 'zip'), ''),
                    nullif(btrim(v_item ->> 'city'), ''),
                    (v_item ->> 'construction_year')::integer,
                    coalesce(nullif(btrim(v_item ->> 'property_type'), ''), 'residential'))
            returning id into v_id;
            v_property_ids[v_i] := v_id;
        end loop;

        -- 3. Einheiten
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'units', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Einheit „' || coalesce(v_item ->> 'unit_name', '') || '“ konnte nicht angelegt werden';

            v_ref := nullif(v_item ->> 'property_id', '')::uuid;
            if v_ref is null then
                v_idx := (v_item ->> 'property_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_property_ids, 1), 0) then
                    v_ref := v_property_ids[v_idx + 1];
                end if;
                if v_ref is null then
                    raise exception 'Verweis auf die Immobilie fehlt im Importplan.';
                end if;
            elsif not exists (select 1
                                from public.properties pr
                                join public.portfolios po on po.id = pr.portfolio_id
                               where pr.id = v_ref and po.user_id = v_uid) then
                raise exception 'Die Immobilie wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            insert into public.units (user_id, property_id, unit_name, floor, sqm, rooms, bathrooms, bedrooms,
                                      balcony, fitted_kitchen, is_vacation_rental, cold_rent_ist, target_rent)
            values (v_uid, v_ref,
                    nullif(btrim(v_item ->> 'unit_name'), ''),
                    nullif(btrim(v_item ->> 'floor'), ''),
                    (v_item ->> 'sqm')::numeric,
                    (v_item ->> 'rooms')::numeric,
                    (v_item ->> 'bathrooms')::integer,
                    (v_item ->> 'bedrooms')::integer,
                    coalesce((v_item ->> 'balcony')::boolean, false),
                    coalesce((v_item ->> 'fitted_kitchen')::boolean, false),
                    coalesce((v_item ->> 'is_vacation_rental')::boolean, false),
                    (v_item ->> 'cold_rent_ist')::numeric,
                    (v_item ->> 'target_rent')::numeric)
            returning id into v_id;
            v_unit_ids[v_i] := v_id;
        end loop;

        -- 4. Mieter
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'tenants', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Mieter ' || coalesce(v_item ->> 'last_name', '') || ' konnte nicht angelegt werden';

            insert into public.tenants (user_id, first_name, last_name, email, phone, occupants)
            values (v_uid,
                    nullif(btrim(v_item ->> 'first_name'), ''),
                    nullif(btrim(v_item ->> 'last_name'), ''),
                    nullif(btrim(v_item ->> 'email'), ''),
                    nullif(btrim(v_item ->> 'phone'), ''),
                    (v_item ->> 'occupants')::integer)
            returning id into v_id;
            v_tenant_ids[v_i] := v_id;
        end loop;

        -- 5. Mietverträge
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'leases', '[]'::jsonb)) loop
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '') || 'Mietvertrag konnte nicht angelegt werden';

            v_unit_id := nullif(v_item ->> 'unit_id', '')::uuid;
            if v_unit_id is null then
                v_idx := (v_item ->> 'unit_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_unit_ids, 1), 0) then
                    v_unit_id := v_unit_ids[v_idx + 1];
                end if;
                if v_unit_id is null then
                    raise exception 'Verweis auf die Einheit fehlt im Importplan.';
                end if;
            elsif not exists (select 1
                                from public.units u
                                join public.properties pr on pr.id = u.property_id
                                join public.portfolios po on po.id = pr.portfolio_id
                               where u.id = v_unit_id and po.user_id = v_uid) then
                raise exception 'Die Einheit wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            v_tenant_id := nullif(v_item ->> 'tenant_id', '')::uuid;
            if v_tenant_id is null then
                v_idx := (v_item ->> 'tenant_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_tenant_ids, 1), 0) then
                    v_tenant_id := v_tenant_ids[v_idx + 1];
                end if;
                if v_tenant_id is null then
                    raise exception 'Verweis auf den Mieter fehlt im Importplan.';
                end if;
            elsif not exists (select 1 from public.tenants t where t.id = v_tenant_id) then
                raise exception 'Der Mieter wurde nicht gefunden.';
            end if;

            v_booking_start := (v_item ->> 'booking_start_date')::date;

            insert into public.leases (user_id, unit_id, tenant_id, status, start_date, cold_rent, service_charge,
                                       heating_cost, other_costs, deposit, last_rent_increase, booking_start_date)
            values (v_uid, v_unit_id, v_tenant_id, 'active',
                    (v_item ->> 'start_date')::date,
                    coalesce((v_item ->> 'cold_rent')::numeric, 0),
                    coalesce((v_item ->> 'service_charge')::numeric, 0),
                    coalesce((v_item ->> 'heating_cost')::numeric, 0),
                    coalesce((v_item ->> 'other_costs')::numeric, 0),
                    (v_item ->> 'deposit')::numeric,
                    (v_item ->> 'last_rent_increase')::date,
                    v_booking_start);
            v_leases := v_leases + 1;
            if v_booking_start is not null then
                v_booking := v_booking + 1;
            end if;
        end loop;

    exception when others then
        -- Zeitüberschreitung/Abbruch (query_canceled) fängt "others" nicht – rollt ebenfalls alles zurück.
        get stacked diagnostics
            v_state = returned_sqlstate,
            v_msg = message_text,
            v_detail = pg_exception_detail,
            v_hint = pg_exception_hint,
            v_column = column_name,
            v_constraint = constraint_name;

        v_reason := case
            when v_state = '42501' and (v_msg like 'new row violates row-level security policy%' or v_msg like 'permission denied%')
                then 'keine Berechtigung für diesen Datensatz'
            when v_state = '23502'
                then 'Pflichtangabe fehlt' || coalesce(' (' || v_column || ')', '')
            when v_state = '23505'
                then 'ein gleichartiger Datensatz ist bereits vorhanden' || coalesce(' (' || v_constraint || ')', '')
            when v_state = '23503'
                then 'ein verknüpfter Datensatz fehlt oder wurde inzwischen gelöscht'
            when v_state = '23514'
                then 'unzulässiger Wert' || coalesce(' (' || v_constraint || ')', '')
            when v_state in ('22P02', '22007', '22008', '22003', '22023', '2200N')
                then 'ungültiger Wert im Importplan'
            else null
        end;

        raise exception using
            errcode = v_state,
            message = coalesce(v_ctx || ': ', '') || coalesce(v_reason, v_msg),
            detail = case when v_reason is not null then v_msg else coalesce(v_detail, '') end,
            hint = coalesce(v_hint, '');
    end;

    return jsonb_build_object(
        'portfolios', coalesce(array_length(v_portfolio_ids, 1), 0),
        'properties', coalesce(array_length(v_property_ids, 1), 0),
        'units', coalesce(array_length(v_unit_ids, 1), 0),
        'tenants', coalesce(array_length(v_tenant_ids, 1), 0),
        'leases', v_leases,
        'booking_start_leases', v_booking
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_applicant_document_owner(p_object_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_first text := split_part(coalesce(p_object_name, ''), '/', 1);
    v_id uuid;
begin
    if auth.uid() is null
       or v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    v_id := v_first::uuid;

    if exists (select 1 from public.rental_processes p
               where p.id = v_id and p.user_id = auth.uid()) then
        return true;
    end if;

    return exists (select 1 from public.rental_applicants a
                   where a.id = v_id and a.user_id = auth.uid());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.keep_user_id_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if tg_op = 'UPDATE' then
        new.user_id := old.user_id;
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lease_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if pg_trigger_depth() = 1 then
        if exists (select 1 from public.rent_payments rp where rp.lease_id = old.id)
           or exists (select 1 from public.claims c where c.lease_id = old.id)
           or exists (
               select 1
                 from public.rent_ledger rl
                where rl.lease_id = old.id
                  and (coalesce(rl.paid_amount, 0) <> 0
                       or rl.status = 'loss'
                       or coalesce(rl.note, '') <> ''
                       or exists (select 1 from public.claim_items ci
                                   where ci.rent_ledger_id = rl.id
                                      or rl.id = any(ci.rent_ledger_ids)))
           ) then
            raise exception 'Dieses Mietverhältnis kann nicht gelöscht werden, weil bereits Buchungen vorliegen (Mietzahlungen, Forderungen oder bearbeitete Sollstellungen). Bitte beenden Sie das Mietverhältnis stattdessen – Zahlungshistorie und Mietkonto bleiben dann erhalten.'
                using hint = 'lease_has_bookings';
        end if;
    end if;

    if not exists (select 1 from public.rent_payments rp where rp.lease_id = old.id) then
        delete from public.rent_ledger rl
         where rl.lease_id = old.id
           and coalesce(rl.paid_amount, 0) = 0
           and coalesce(rl.status, 'open') <> 'loss'
           and coalesce(rl.note, '') = ''
           and not exists (select 1 from public.claim_items ci
                            where ci.rent_ledger_id = rl.id
                               or rl.id = any(ci.rent_ledger_ids));
    end if;

    return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lease_notes_set_meta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lease_rent_period_for_month(p_lease_id uuid, p_month date)
 RETURNS public.lease_rent_periods
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_period public.lease_rent_periods;
begin
    select p.* into v_period
    from public.lease_rent_periods p
    where p.lease_id = p_lease_id
      and p.valid_from < (date_trunc('month', p_month) + interval '1 month')::date
    order by p.valid_from desc
    limit 1;

    if v_period.id is null then
        select p.* into v_period
        from public.lease_rent_periods p
        where p.lease_id = p_lease_id
        order by p.valid_from asc
        limit 1;
    end if;

    return v_period;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lease_rent_period_has_earlier(p_lease_id uuid, p_valid_from date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.lease_rent_periods p
    where p.lease_id = p_lease_id
      and p.valid_from < p_valid_from
  )
$function$
;
CREATE OR REPLACE FUNCTION public.lease_rent_periods_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if TG_OP = 'INSERT' then
        if auth.uid() is not null then
            NEW.created_by := auth.uid();
        end if;
        NEW.created_at := now();
    else
        if NEW.lease_id is distinct from OLD.lease_id then
            raise exception 'Ein Mietzeitraum kann keinem anderen Mietvertrag zugeordnet werden.';
        end if;
        if NEW.created_by is not null then
            NEW.created_by := OLD.created_by;
        end if;
        NEW.created_at := OLD.created_at;
    end if;

    NEW.cold_rent := coalesce(NEW.cold_rent, 0);
    NEW.service_charge := coalesce(NEW.service_charge, 0);
    NEW.heating_cost := coalesce(NEW.heating_cost, 0);
    NEW.other_costs := coalesce(NEW.other_costs, 0);
    NEW.payment_due_day := coalesce(NEW.payment_due_day, 3);
    return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.leases_check_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_new_end date := coalesce(new.end_date, 'infinity'::date);
  v_check_old boolean := false;
  v_old_start date;
  v_old_end date;
  v_conflict record;
begin
  if new.unit_id is null or new.start_date is null then
    return new;
  end if;
  -- beendet ohne Enddatum (Altdaten): belegt die Einheit nicht
  if new.status is distinct from 'active' and new.end_date is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.unit_id is not distinct from old.unit_id
       and new.start_date is not distinct from old.start_date
       and new.end_date is not distinct from old.end_date
       and new.status is not distinct from old.status then
      return new;
    end if;
    v_check_old := old.unit_id = new.unit_id
                   and not (old.status is distinct from 'active' and old.end_date is null)
                   and old.start_date is not null;
    v_old_start := old.start_date;
    v_old_end := coalesce(old.end_date, 'infinity'::date);
  end if;

  -- gleichzeitige Anlage auf derselben Einheit nacheinander prüfen
  perform pg_advisory_xact_lock(hashtextextended('public.leases.unit:' || new.unit_id::text, 0));

  select l.id, l.start_date, l.end_date
    into v_conflict
    from public.leases l
   where l.unit_id = new.unit_id
     and l.id <> new.id
     and not (l.status is distinct from 'active' and l.end_date is null)
     and l.start_date <= v_new_end
     and new.start_date <= coalesce(l.end_date, 'infinity'::date)
     and not (v_check_old
              and l.start_date <= v_old_end
              and v_old_start <= coalesce(l.end_date, 'infinity'::date))
   order by l.start_date
   limit 1;

  if found then
    raise exception 'Für diese Einheit besteht im gewählten Zeitraum bereits ein Mietvertrag (% – %). Bitte beenden Sie zuerst den bestehenden Vertrag oder wählen Sie einen Mietbeginn nach dessen Ende.',
      to_char(v_conflict.start_date, 'DD.MM.YYYY'),
      coalesce(to_char(v_conflict.end_date, 'DD.MM.YYYY'), 'unbefristet')
      using hint = 'lease_overlap';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.leases_sync_tenant_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tenant_owner uuid;
begin
  if new.tenant_id is null or v_uid is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.tenant_id is not distinct from old.tenant_id
     and new.unit_id is not distinct from old.unit_id then
    return null;
  end if;

  select po.user_id into v_owner
    from public.units u
    join public.properties pr on pr.id = u.property_id
    join public.portfolios po on po.id = pr.portfolio_id
   where u.id = new.unit_id;

  select t.user_id into v_tenant_owner from public.tenants t where t.id = new.tenant_id;

  if v_owner is null or v_tenant_owner is null or v_tenant_owner = v_owner or v_tenant_owner <> v_uid then
    return null;
  end if;

  if exists (select 1
               from public.leases l
               join public.units u on u.id = l.unit_id
               join public.properties pr on pr.id = u.property_id
               join public.portfolios po on po.id = pr.portfolio_id
              where l.tenant_id = new.tenant_id
                and l.id <> new.id
                and po.user_id <> v_owner) then
    return null;
  end if;

  update public.tenants set user_id = v_owner
   where id = new.tenant_id and user_id = v_tenant_owner;
  update public.contacts set user_id = v_owner
   where tenant_id = new.tenant_id and user_id = v_tenant_owner;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_push(p_table text, p_record jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- BASELINE-FASSUNG, NICHT der Live-Rumpf: Live steht bis zur Schlüssel-Erneuerung (Phase 0) ein
-- Schlüssel-Literal im Rumpf, das nicht ins Repository gehört. Diese Fassung liest URL und Schlüssel
-- aus dem Supabase-Vault (Secrets 'push_function_url' und 'service_role_key'). Fehlt eines, wird
-- nur gewarnt und keine Benachrichtigung verschickt.
DECLARE
    v_url text;
    v_key text;
BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_function_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'Push notification skipped: Vault-Secrets push_function_url/service_role_key fehlen';
        RETURN;
    END IF;
    PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object('type', 'INSERT', 'table', p_table, 'record', p_record),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key)
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Push notification failed: %', SQLERRM;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.on_lease_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_current_month date := date_trunc('month', current_date)::date;
    v_target_month date;
    v_period public.lease_rent_periods;
    v_rent_changed boolean;
begin
    if coalesce(current_setting('app.rent_period_sync', true), '') = 'on' then
        return null;
    end if;

    if TG_OP = 'INSERT' then
        if NEW.start_date is not null
           and not exists (select 1 from public.lease_rent_periods where lease_id = NEW.id) then
            insert into public.lease_rent_periods
                (lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day)
            values (
                NEW.id,
                NEW.start_date,
                coalesce(NEW.cold_rent, 0),
                coalesce(NEW.service_charge, 0),
                coalesce(NEW.heating_cost, 0),
                coalesce(NEW.other_costs, 0),
                least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
            );
            return null;
        end if;
        perform public.recalculate_lease_ledgers(NEW.id);
        return null;
    end if;

    v_rent_changed := (NEW.cold_rent, NEW.service_charge, NEW.heating_cost, NEW.other_costs, NEW.payment_due_day)
                      is distinct from
                      (OLD.cold_rent, OLD.service_charge, OLD.heating_cost, OLD.other_costs, OLD.payment_due_day);

    if v_rent_changed then
        v_target_month := greatest(v_current_month, date_trunc('month', NEW.start_date)::date);

        select p.* into v_period
          from public.lease_rent_periods p
         where p.lease_id = NEW.id
           and date_trunc('month', p.valid_from)::date = v_target_month;

        if v_period.id is not null then
            if (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
               is distinct from
               (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                update public.lease_rent_periods
                   set cold_rent       = coalesce(NEW.cold_rent, 0),
                       service_charge  = coalesce(NEW.service_charge, 0),
                       heating_cost    = coalesce(NEW.heating_cost, 0),
                       other_costs     = coalesce(NEW.other_costs, 0),
                       payment_due_day = least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                 where id = v_period.id;
                return null;
            end if;
        else
            v_period := public.lease_rent_period_for_month(NEW.id, v_target_month);
            if v_period.id is not null
               and v_target_month < date_trunc('month', v_period.valid_from)::date then
                if (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
                   is distinct from
                   (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                    coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                    update public.lease_rent_periods
                       set cold_rent       = coalesce(NEW.cold_rent, 0),
                           service_charge  = coalesce(NEW.service_charge, 0),
                           heating_cost    = coalesce(NEW.heating_cost, 0),
                           other_costs     = coalesce(NEW.other_costs, 0),
                           payment_due_day = least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                     where id = v_period.id;
                    return null;
                end if;
            elsif v_period.id is null
               or (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
                  is distinct from
                  (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                   coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                insert into public.lease_rent_periods
                    (lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day)
                values (
                    NEW.id,
                    v_target_month,
                    coalesce(NEW.cold_rent, 0),
                    coalesce(NEW.service_charge, 0),
                    coalesce(NEW.heating_cost, 0),
                    coalesce(NEW.other_costs, 0),
                    least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                );
                return null;
            end if;
        end if;
    end if;

    if v_rent_changed
       or (NEW.start_date, NEW.end_date) is distinct from (OLD.start_date, OLD.end_date) then
        perform public.recalculate_lease_ledgers(NEW.id);
    end if;

    return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.on_lease_rent_period_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_lease_id uuid;
begin
    if TG_OP = 'DELETE' then
        v_lease_id := OLD.lease_id;
    else
        v_lease_id := NEW.lease_id;
    end if;

    if not exists (select 1 from public.leases where id = v_lease_id) then
        return null;
    end if;

    perform public.recalculate_lease_ledgers(v_lease_id);
    perform public.sync_lease_rent_from_periods(v_lease_id);
    return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.on_rent_payment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
        if NEW.lease_id is not null and NEW.period_month is not null then
            perform public.recalculate_rent_ledger_entry(NEW.lease_id, NEW.period_month);
        end if;
        if TG_OP = 'UPDATE' and OLD.lease_id is not null and OLD.period_month is not null
           and (OLD.lease_id != NEW.lease_id or OLD.period_month != NEW.period_month) then
            perform public.recalculate_rent_ledger_entry(OLD.lease_id, OLD.period_month);
        end if;
    elsif TG_OP = 'DELETE' then
        if OLD.lease_id is not null and OLD.period_month is not null then
            perform public.recalculate_rent_ledger_entry(OLD.lease_id, OLD.period_month);
        end if;
    end if;
    return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.portfolio_shares_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    new.shared_with_email := lower(btrim(new.shared_with_email));

    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if tg_op = 'UPDATE' then
        new.portfolio_id      := old.portfolio_id;
        new.created_by        := old.created_by;
        new.shared_with_email := old.shared_with_email;
        if new.status is distinct from old.status and new.status <> 'pending' then
            new.status := old.status;
        end if;
        new.updated_at := now();
    end if;

    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.profiles_protect_stripe_connect()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            new.stripe_connect_id := null;
            new.stripe_connect_enabled := false;
        else
            new.stripe_connect_id := old.stripe_connect_id;
            new.stripe_connect_enabled := old.stripe_connect_enabled;
        end if;
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_claim_item_created_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_claim_item_original_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_posted_count int;
BEGIN
  IF NEW.original_amount != OLD.original_amount THEN
    SELECT COUNT(*) INTO v_posted_count
    FROM claim_payment_allocations cpa
    JOIN claim_payments cp ON cp.id = cpa.claim_payment_id
    WHERE cpa.claim_item_id = OLD.id AND cp.status = 'posted';

    IF v_posted_count > 0 THEN
      RAISE EXCEPTION 'original_amount cannot be changed after payments have been posted to this item. Use reversal or new items.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_claim_payment_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'claim_payments' then
    if tg_op = 'DELETE' and old.status in ('posted', 'cancelled') then
      raise exception 'Gebuchte Zahlungen können nicht gelöscht werden. Bitte die Zahlung in der Forderungsakte stornieren.';
    end if;
  elsif tg_table_name = 'claim_payment_allocations' then
    if tg_op = 'DELETE' and exists (
         select 1 from public.claim_payments cp
          where cp.id = old.claim_payment_id and cp.status in ('posted', 'cancelled')) then
      raise exception 'Zuordnungen gebuchter Zahlungen können nicht gelöscht werden. Bitte die Zahlung in der Forderungsakte stornieren.';
    end if;
  elsif tg_table_name in ('payment_plans', 'payment_plan_installments') then
    -- Erlaubt bleibt die reine Stornierung (Forderung stornieren in Claims.jsx: offene Raten
    -- und aktiven Plan auf 'cancelled'); dabei ändern sich nur Status und Storno-Angaben.
    if tg_op = 'UPDATE' and new.status = 'cancelled' then
      if tg_table_name = 'payment_plans' then
        if old.status = 'active'
           and (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'])
             = (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) then
          return new;
        end if;
      elsif old.status in ('open', 'partial', 'overdue')
            and (to_jsonb(new) - array['status', 'updated_at', 'open_amount'])
              = (to_jsonb(old) - array['status', 'updated_at', 'open_amount']) then
        return new;
      end if;
    end if;
    raise exception 'Ratenpläne können nur über die Forderungsakte angelegt, gebucht oder rückgängig gemacht werden.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_claim_rent_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ref text;
  v_linked boolean := false;
begin
  -- Ausnahme innerhalb von reverse_claim_payment
  if current_setting('app.bypass_rent_payment_protect', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Die Verknüpfung setzt/ändert nur die Forderungsbuchung (record_claim_payment)
  if tg_op in ('INSERT', 'UPDATE')
     and new.claim_payment_id is not null
     and (tg_op = 'INSERT' or new.claim_payment_id is distinct from old.claim_payment_id)
     and coalesce(current_setting('app.claims_rpc_bypass', true), '') <> '1' then
    raise exception 'Die Verknüpfung mit einer Forderungszahlung wird ausschließlich von der Forderungsakte gesetzt.';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.claim_payment_id is not null then
    v_linked := exists (select 1 from public.claim_payments cp
                         where cp.id = old.claim_payment_id and cp.status = 'posted');
  elsif old.note is not null and old.note like '%Verrechnung%Forderungsakte%' then
    v_ref := substring(old.note from '\(Ref: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)');
    if v_ref is not null then
      v_linked := exists (select 1 from public.claim_payments cp where cp.id = v_ref::uuid and cp.status = 'posted');
    end if;
  end if;

  if not v_linked then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Diese Zahlung ist an eine Forderungsakte geknüpft. Bitte löschen Sie die Zahlung direkt in der Timeline der jeweiligen Forderung.';
  end if;

  if new.amount is distinct from old.amount
     or new.note is distinct from old.note
     or new.lease_id is distinct from old.lease_id
     or new.period_month is distinct from old.period_month
     or new.user_id is distinct from old.user_id
     or new.claim_payment_id is distinct from old.claim_payment_id then
    raise exception 'Eine forderungsgebundene Zahlung kann nicht manuell in der Buchhaltung geändert werden. Bitte stornieren Sie die Zahlung in der zugehörigen Forderungsakte.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_issued_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- SECURITY DEFINER nur für die Existenzprüfungen (gelöschte Kontakte/Objekte/Einheiten/Konten,
-- Eigentümer der Portfolios) ohne RLS des Aufrufers. Ändert selbst keine Daten.
declare
    v_uid uuid := auth.uid();
    v_locked constant text := 'Ausgestellte Rechnungen und Gutschriften sind festgeschrieben und können nicht mehr geändert werden. Eine Korrektur ist nur über eine Gutschrift möglich.';
    v_fixed text[] := array['status', 'portfolio_id', 'contact_id', 'property_id', 'unit_id'];
begin
    if tg_op = 'DELETE' then
        if old.status = 'draft' then
            return old;
        end if;
        -- Löschen des Benutzerkontos (auth.users ON DELETE CASCADE): das Konto ist dann schon entfernt
        if not exists (select 1 from auth.users u where u.id = old.user_id) then
            return old;
        end if;
        raise exception 'Ausgestellte Rechnungen und Gutschriften können nicht gelöscht werden (Aufbewahrungspflicht). Eine Korrektur ist nur über eine Gutschrift möglich.'
            using errcode = '42501';
    end if;

    -- UPDATE eines Entwurfs: frei änderbar; als neuer Status nur Entwurf oder ausgestellt
    if old.status = 'draft' then
        if new.status is distinct from 'draft' and new.status is distinct from 'issued' then
            raise exception 'Ein Entwurf kann nur ausgestellt werden. Gutschriften entstehen nur zu ausgestellten Rechnungen.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    -- a) Status: nur issued -> credited
    if new.status is distinct from old.status
       and not (old.status = 'issued' and new.status = 'credited') then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- b) Portfolio: nur zwischen Portfolios desselben Eigentümers (der selbst handelt)
    if new.portfolio_id is distinct from old.portfolio_id
       and not (v_uid is not null
                and exists (select 1 from public.portfolios p where p.id = old.portfolio_id and p.user_id = v_uid)
                and exists (select 1 from public.portfolios p where p.id = new.portfolio_id and p.user_id = v_uid)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- c) Verweise: nur auf NULL, wenn der verwiesene Datensatz nicht mehr existiert (ON DELETE SET NULL)
    if new.contact_id is distinct from old.contact_id
       and not (new.contact_id is null
                and not exists (select 1 from public.contacts c where c.id = old.contact_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;
    if new.property_id is distinct from old.property_id
       and not (new.property_id is null
                and not exists (select 1 from public.properties p where p.id = old.property_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;
    if new.unit_id is distinct from old.unit_id
       and not (new.unit_id is null
                and not exists (select 1 from public.units u where u.id = old.unit_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- Alle übrigen Spalten (auch künftige) bleiben unverändert
    if (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.push_subscriptions_release_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if new.fcm_token is not null then
        delete from public.push_subscriptions
         where fcm_token = new.fcm_token
           and user_id is distinct from new.user_id
           and id is distinct from new.id;
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.recalculate_lease_ledgers(p_lease_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_lease record;
    v_iter_date date;
    v_start_month date;
    v_end_date date;
    v_row record;
begin
    select id, start_date, end_date, user_id
      into v_lease
      from public.leases
     where id = p_lease_id;

    if v_lease.id is null or v_lease.start_date is null then
        return;
    end if;

    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietkonto.' using errcode = '42501';
    end if;

    v_start_month := date_trunc('month', v_lease.start_date)::date;
    v_iter_date := v_start_month;

    if v_lease.end_date is not null and v_lease.end_date < current_date then
        v_end_date := date_trunc('month', v_lease.end_date)::date;
    else
        v_end_date := date_trunc('month', current_date)::date;
    end if;

    while v_iter_date <= v_end_date loop
        perform public.recalculate_rent_ledger_entry(p_lease_id, v_iter_date);
        v_iter_date := (v_iter_date + interval '1 month')::date;
    end loop;

    for v_row in
        select rl.period_month
          from public.rent_ledger rl
         where rl.lease_id = p_lease_id
           and (rl.period_month < v_start_month or rl.period_month > v_end_date)
    loop
        perform public.recalculate_rent_ledger_entry(p_lease_id, v_row.period_month);
    end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.recalculate_rent_ledger_entry(p_lease_id uuid, p_period_month date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_month date;
    v_lease record;
    v_period public.lease_rent_periods;
    v_row record;
    v_in_range boolean;
    v_expected_rent numeric;
    v_payment_due_day integer;
    v_due_date date;
    v_last_day date;
    v_paid numeric;
begin
    if p_lease_id is null or p_period_month is null then
        return;
    end if;
    v_month := date_trunc('month', p_period_month)::date;

    select id, user_id, start_date, end_date,
           cold_rent, service_charge, heating_cost, other_costs, payment_due_day
      into v_lease
      from public.leases
     where id = p_lease_id;

    if v_lease.id is null or v_lease.user_id is null then
        return;
    end if;

    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietkonto.' using errcode = '42501';
    end if;

    v_in_range := v_lease.start_date is not null
                  and v_month >= date_trunc('month', v_lease.start_date)::date
                  and (v_lease.end_date is null or v_month <= date_trunc('month', v_lease.end_date)::date);

    select coalesce(sum(amount), 0) into v_paid
      from public.rent_payments
     where lease_id = p_lease_id
       and date_trunc('month', period_month)::date = v_month;

    select id, status, note into v_row
      from public.rent_ledger
     where lease_id = p_lease_id
       and period_month = v_month;

    if not v_in_range then
        if v_row.id is not null
           and v_paid = 0
           and coalesce(v_row.status, 'open') <> 'loss'
           and coalesce(v_row.note, '') = ''
           and not exists (
               select 1 from public.claim_items ci
                where ci.rent_ledger_id = v_row.id
                   or v_row.id = any(ci.rent_ledger_ids)
           ) then
            delete from public.rent_ledger where id = v_row.id;
            return;
        end if;
        if v_row.id is null and v_paid = 0 then
            return;
        end if;
    end if;

    if v_row.status = 'loss' and v_paid = 0 then
        return;
    end if;

    v_period := public.lease_rent_period_for_month(p_lease_id, v_month);
    if v_period.id is not null then
        v_expected_rent := coalesce(v_period.cold_rent, 0) + coalesce(v_period.service_charge, 0)
                         + coalesce(v_period.heating_cost, 0) + coalesce(v_period.other_costs, 0);
        v_payment_due_day := coalesce(v_period.payment_due_day, 3);
    else
        v_expected_rent := coalesce(v_lease.cold_rent, 0) + coalesce(v_lease.service_charge, 0)
                         + coalesce(v_lease.heating_cost, 0) + coalesce(v_lease.other_costs, 0);
        v_payment_due_day := coalesce(v_lease.payment_due_day, 3);
    end if;

    v_payment_due_day := greatest(v_payment_due_day, 1);
    v_last_day := (v_month + interval '1 month' - interval '1 day')::date;
    v_due_date := least(v_month + (v_payment_due_day - 1), v_last_day);

    insert into public.rent_ledger (user_id, lease_id, period_month, due_date, expected_rent, paid_amount, status)
    values (
        v_lease.user_id,
        p_lease_id,
        v_month,
        v_due_date,
        v_expected_rent,
        v_paid,
        case when v_paid >= (v_expected_rent - 1) then 'paid' else 'open' end
    )
    on conflict (lease_id, period_month) do update
    set expected_rent = excluded.expected_rent,
        paid_amount   = excluded.paid_amount,
        due_date      = excluded.due_date,
        status        = case when excluded.paid_amount >= (excluded.expected_rent - 1) then 'paid' else 'open' end,
        updated_at    = now();
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_claim_payment(p_claim_id uuid, p_payment_date date, p_amount numeric, p_note text, p_installment_id uuid DEFAULT NULL::uuid, p_target_type text DEFAULT 'auto'::text, p_target_claim_item_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_amount numeric;
  v_target text := coalesce(nullif(p_target_type, ''), 'auto');
  v_installment_id uuid := p_installment_id;
  v_is_installment boolean := false;
  v_plan_id uuid;
  v_plan_created_at timestamptz;
  v_plan_status text;
  v_plan_booked boolean := false;
  v_plan_remaining numeric := 0;
  v_fees_open numeric := 0;
  v_principal_open numeric := 0;
  v_new_interest numeric := 0;
  v_interest_open numeric := 0;
  v_total_due numeric := 0;
  v_limit numeric;
  v_remaining numeric;
  v_x numeric;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_pools_done boolean;
  v_allocs jsonb := '[]'::jsonb;
  v_alloc jsonb;
  v_n integer;
  v_payment_id uuid;
  v_item record;
  v_item_alloc numeric;
  v_target_desc text;
  v_target_open numeric := 0;
  v_target_fee numeric := 0;
  v_target_interest numeric := 0;
  v_item_fee_paid numeric := 0;
  v_item_interest_paid numeric := 0;
  v_item_fee_open numeric := 0;
  v_item_interest_open numeric := 0;
  v_target_fee_alloc numeric := 0;
  v_target_interest_alloc numeric := 0;
  v_target_principal_alloc numeric := 0;
  v_inst_budget numeric := 0;
  v_open_inst record;
  v_inst_alloc numeric;
  v_inst_new_paid numeric;
  v_inst_new_status text;
  v_modified_installments jsonb := '[]'::jsonb;
  v_plan_completed boolean := false;
  v_event_metadata jsonb;
  v_rent_remaining numeric;
  v_rent_unbooked numeric := 0;
  v_rl_ids uuid[];
  v_rl record;
  v_rl_alloc numeric;
begin
  -- 1. Anmeldung: angemeldeter Nutzer oder Server-Rolle (Stripe-Webhook)
  if v_caller is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Betrag muss größer als 0 sein.';
  end if;
  v_amount := round(p_amount, 2);
  if p_payment_date is null then
    raise exception 'Bitte ein Zahlungsdatum angeben.';
  end if;
  if p_payment_date > current_date + 1 then
    raise exception 'Das Zahlungsdatum darf nicht in der Zukunft liegen.';
  end if;

  if v_target = 'installment' then
    v_target := 'auto';
  end if;
  if v_target not in ('auto', 'claim_items', 'specific_item') then
    raise exception 'Unbekannte Zahlungsart: %', v_target;
  end if;
  if v_target = 'specific_item' and p_target_claim_item_id is null then
    raise exception 'Bitte die Position auswählen, auf die gezahlt wird.';
  end if;
  if v_target <> 'auto' then
    v_installment_id := null;
  end if;

  -- 2. Forderung sperren, Berechtigung prüfen
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;
  if v_caller is not null
     and v_claim.user_id <> v_caller
     and not public.has_claim_access(p_claim_id, 'finanzen', 'write') then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;
  v_owner := v_claim.user_id;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung können keine Zahlungen mehr gebucht werden (Status: %).', v_claim.status;
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- 3. Ratenplan (deterministisch: jüngster aktiver Plan) und Rate
  select pp.id, pp.created_at, pp.status into v_plan_id, v_plan_created_at, v_plan_status
    from public.payment_plans pp
   where pp.claim_id = p_claim_id and pp.status = 'active'
   order by pp.created_at desc
   limit 1;

  if v_installment_id is not null then
    select pp.id, pp.created_at, pp.status into v_plan_id, v_plan_created_at, v_plan_status
      from public.payment_plan_installments ppi
      join public.payment_plans pp on pp.id = ppi.payment_plan_id
     where ppi.id = v_installment_id and pp.claim_id = p_claim_id;
    if not found then
      raise exception 'Rate nicht gefunden.';
    end if;
    if v_plan_status <> 'active' then
      raise exception 'Der Ratenplan dieser Rate ist nicht mehr aktiv.';
    end if;
  elsif v_plan_id is not null and v_target = 'auto' then
    select ppi.id into v_installment_id
      from public.payment_plan_installments ppi
     where ppi.payment_plan_id = v_plan_id and ppi.status not in ('paid', 'cancelled')
     order by ppi.due_date, ppi.created_at
     limit 1;
  end if;
  v_is_installment := v_installment_id is not null;

  if v_plan_id is not null then
    select coalesce(sum(greatest(0::numeric, ppi.amount - ppi.paid_amount)), 0) into v_plan_remaining
      from public.payment_plan_installments ppi
     where ppi.payment_plan_id = v_plan_id and ppi.status <> 'cancelled';
    v_plan_booked := exists (
      select 1 from public.claim_events e
       where e.claim_id = p_claim_id
         and e.event_type = 'payment_plan_accepted'
         and e.event_metadata->>'payment_plan_id' = v_plan_id::text
         and e.event_metadata->>'surcharge_booked_as_fee' = 'true');
  end if;

  -- 4. Offene Beträge zum Zahlungsdatum (Zinsformel nur in claim_live_interest)
  select coalesce(t.total_fees_open, 0), coalesce(t.current_principal_open, 0)
    into v_fees_open, v_principal_open
    from public.claim_totals_view t where t.claim_id = p_claim_id;
  v_new_interest := coalesce(public.claim_live_interest(p_claim_id, p_payment_date), 0);
  v_interest_open := round(greatest(0, coalesce(v_claim.accumulated_unpaid_interest, 0) + v_new_interest), 2);
  v_total_due := round(coalesce(v_fees_open, 0) + v_interest_open + coalesce(v_principal_open, 0), 2);

  if v_amount > v_total_due + 0.005 then
    raise exception 'Der Zahlungsbetrag (% EUR) übersteigt die offene Gesamtforderung (% EUR).',
      public.claim_format_eur(v_amount), public.claim_format_eur(v_total_due);
  end if;

  -- Ratenplan-Invariante: Zahlungen außerhalb der Raten dürfen den offenen Planbetrag
  -- nicht aufzehren (sonst wäre die letzte Rate nicht mehr buchbar).
  if v_plan_id is not null and not v_is_installment and v_plan_booked then
    v_limit := round(v_total_due - v_plan_remaining, 2);
    if v_amount > v_limit + 0.005 then
      raise exception 'Der Betrag übersteigt den offenen Betrag außerhalb des Ratenplans (% EUR). Zahlungen auf den Ratenplan bitte als Ratenzahlung buchen.',
        public.claim_format_eur(greatest(v_limit, 0));
    end if;
  end if;

  -- 5. Zielposition (nur Positionen DIESER Forderung)
  if v_target = 'specific_item' then
    select ci.description, coalesce(ctv.open_amount, 0), coalesce(ci.fee_amount, 0), coalesce(ci.interest_amount, 0)
      into v_target_desc, v_target_open, v_target_fee, v_target_interest
      from public.claim_items ci
      left join public.claim_item_totals_view ctv on ctv.claim_item_id = ci.id
     where ci.id = p_target_claim_item_id and ci.claim_id = p_claim_id;
    if not found then
      raise exception 'Die gewählte Position gehört nicht zu dieser Forderung.';
    end if;

    -- Bereits für DIESE Position gezahlte Gebühren/Zinsen (D1b-11, H4-09)
    select coalesce(sum(coalesce(nullif(e.event_metadata->>'target_item_fee_allocated', '')::numeric, pa.fees)), 0),
           coalesce(sum(coalesce(nullif(e.event_metadata->>'target_item_interest_allocated', '')::numeric, pa.interest)), 0)
      into v_item_fee_paid, v_item_interest_paid
      from public.claim_payments cp
      join public.claim_events e
        on e.claim_id = cp.claim_id
       and e.event_type = 'payment_received'
       and e.event_metadata->>'payment_id' = cp.id::text
      cross join lateral (
        select coalesce(sum(a.amount) filter (where a.allocation_bucket = 'fees'), 0) as fees,
               coalesce(sum(a.amount) filter (where a.allocation_bucket = 'interest'), 0) as interest
          from public.claim_payment_allocations a
         where a.claim_payment_id = cp.id
      ) pa
     where cp.claim_id = p_claim_id
       and cp.status = 'posted'
       and e.event_metadata->>'target_item_id' = p_target_claim_item_id::text;

    -- nie mehr als forderungsweit noch offen
    v_item_fee_open := least(greatest(0, v_target_fee - v_item_fee_paid), v_fees_open);
    v_item_interest_open := least(greatest(0, v_target_interest - v_item_interest_paid), v_interest_open);
  end if;

  -- 6. Verteilung: Gebühren -> Zinsen -> Hauptforderung (Zielbereich), Rest auf weitere Posten
  v_remaining := v_amount;
  if v_target = 'specific_item' then
    v_target_fee_alloc := least(v_remaining, v_item_fee_open);
    v_remaining := v_remaining - v_target_fee_alloc;
    v_target_interest_alloc := least(v_remaining, v_item_interest_open);
    v_remaining := v_remaining - v_target_interest_alloc;
    v_alloc_fees := v_target_fee_alloc;
    v_alloc_interest := v_target_interest_alloc;
    v_pools_done := false;
  else
    v_x := least(v_remaining, v_fees_open);
    v_alloc_fees := v_x;
    v_remaining := v_remaining - v_x;
    v_x := least(v_remaining, v_interest_open);
    v_alloc_interest := v_x;
    v_remaining := v_remaining - v_x;
    v_pools_done := true;
  end if;

  -- Reihenfolge der Posten: Zielposition, dann Zielbereich (Rate: Planposten; sonst
  -- Posten außerhalb des Plans), dann übrige Posten; je nach Monat/Anlage.
  for v_item in
    select ci.id, ci.item_type, ci.period_month, ci.rent_ledger_id, ci.rent_ledger_ids, ctv.open_amount,
           case
             when v_target = 'specific_item' and ci.id = p_target_claim_item_id then 0
             when v_plan_created_at is null then 1
             when v_is_installment then
               case when coalesce(ci.created_at, '-infinity'::timestamptz) <= v_plan_created_at then 1 else 2 end
             else
               case when coalesce(ci.created_at, '-infinity'::timestamptz) > v_plan_created_at then 1 else 2 end
           end as prio,
           ci.created_at
      from public.claim_items ci
      join public.claim_item_totals_view ctv on ctv.claim_item_id = ci.id
     where ci.claim_id = p_claim_id
       and ctv.open_amount > 0
     order by prio, ci.period_month asc nulls first, ci.created_at asc nulls first, ci.id
  loop
    exit when v_remaining <= 0;

    if not v_pools_done and v_item.prio > 0 then
      -- Überzahlung der Zielposition: zuerst übrige Gebühren und Zinsen
      v_x := least(v_remaining, greatest(0, v_fees_open - v_alloc_fees));
      v_alloc_fees := v_alloc_fees + v_x;
      v_remaining := v_remaining - v_x;
      v_x := least(v_remaining, greatest(0, v_interest_open - v_alloc_interest));
      v_alloc_interest := v_alloc_interest + v_x;
      v_remaining := v_remaining - v_x;
      v_pools_done := true;
      exit when v_remaining <= 0;
    end if;

    v_item_alloc := least(v_remaining, v_item.open_amount);
    if v_item_alloc > 0 then
      v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id, 'amount', v_item_alloc, 'item_type', v_item.item_type,
        'period_month', v_item.period_month,
        'rent_ledger_ids', to_jsonb(array(
           select distinct x
             from unnest(array_append(coalesce(v_item.rent_ledger_ids, '{}'::uuid[]), v_item.rent_ledger_id)) as t(x)
            where x is not null))));
      v_alloc_principal := v_alloc_principal + v_item_alloc;
      v_remaining := v_remaining - v_item_alloc;
      if v_item.prio = 0 then
        v_target_principal_alloc := v_item_alloc;
      end if;
    end if;
  end loop;

  if not v_pools_done and v_remaining > 0 then
    v_x := least(v_remaining, greatest(0, v_fees_open - v_alloc_fees));
    v_alloc_fees := v_alloc_fees + v_x;
    v_remaining := v_remaining - v_x;
    v_x := least(v_remaining, greatest(0, v_interest_open - v_alloc_interest));
    v_alloc_interest := v_alloc_interest + v_x;
    v_remaining := v_remaining - v_x;
  end if;

  -- Rundungsreste unter einem Cent dem letzten Posten zuschlagen; alles andere ablehnen
  if v_remaining > 0 then
    if v_remaining < 0.01 then
      v_n := jsonb_array_length(v_allocs);
      if v_n > 0 then
        v_allocs := jsonb_set(v_allocs, array[(v_n - 1)::text, 'amount'],
                              to_jsonb((v_allocs->(v_n - 1)->>'amount')::numeric + v_remaining));
        v_alloc_principal := v_alloc_principal + v_remaining;
      elsif v_alloc_interest > 0 then
        v_alloc_interest := v_alloc_interest + v_remaining;
      else
        v_alloc_fees := v_alloc_fees + v_remaining;
      end if;
      v_remaining := 0;
    else
      raise exception 'Der Betrag (% EUR) konnte nicht vollständig auf offene Posten verteilt werden.',
        public.claim_format_eur(v_amount);
    end if;
  end if;

  -- 7. Buchen
  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_owner, p_claim_id, p_payment_date, v_amount, 'automatic', 'posted', p_note)
  returning id into v_payment_id;

  if v_alloc_fees > 0 then
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    values (v_payment_id, v_owner, p_claim_id, 'fees', v_alloc_fees);
  end if;
  if v_alloc_interest > 0 then
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    values (v_payment_id, v_owner, p_claim_id, 'interest', v_alloc_interest);
  end if;

  for v_alloc in select value from jsonb_array_elements(v_allocs)
  loop
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
    values (v_payment_id, v_owner, p_claim_id, 'principal', (v_alloc->>'item_id')::uuid, (v_alloc->>'amount')::numeric);

    -- Mietkonto spiegeln (D1b-18, H1-10, H4-16): nur Mietpositionen, nur Mietzeilen des
    -- Eigentümers und dieses Vertrags; Bindung über rent_payments.claim_payment_id (die Notiz
    -- bleibt reiner Anzeigetext). Je Monat höchstens bis zur Sollmiete – ein Rest wird bewusst
    -- NICHT ins Mietkonto gebucht (die Miete wäre sonst überzahlt), sondern im Ereignis als
    -- rent_mirror_unbooked ausgewiesen. Altpositionen ohne Mietzeilen-Bezug: Monat aus period_month.
    if v_claim.lease_id is not null and coalesce(v_alloc->>'item_type', '') = 'rent' then
      v_rent_remaining := (v_alloc->>'amount')::numeric;
      v_rl_ids := case when jsonb_typeof(v_alloc->'rent_ledger_ids') = 'array'
                       then array(select t.v::uuid from jsonb_array_elements_text(v_alloc->'rent_ledger_ids') as t(v))
                       else '{}'::uuid[] end;
      for v_rl in
        select rl.id, rl.period_month, rl.expected_rent, coalesce(rl.paid_amount, 0) as paid_amount
          from public.rent_ledger rl
         where rl.user_id = v_owner
           and rl.lease_id = v_claim.lease_id
           and (rl.id = any(v_rl_ids)
                or (cardinality(v_rl_ids) = 0
                    and v_alloc->>'period_month' is not null
                    and rl.period_month = date_trunc('month', (v_alloc->>'period_month')::date)::date))
         order by rl.period_month asc
      loop
        exit when v_rent_remaining <= 0;
        v_rl_alloc := least(v_rent_remaining, v_rl.expected_rent - v_rl.paid_amount);
        if v_rl_alloc > 0 then
          insert into public.rent_payments (user_id, lease_id, payment_date, period_month, amount, note, claim_payment_id)
          values (v_owner, v_claim.lease_id, p_payment_date, v_rl.period_month, v_rl_alloc,
                  'Verrechnung Forderungsakte (Ref: ' || v_payment_id || ')', v_payment_id);
          v_rent_remaining := v_rent_remaining - v_rl_alloc;
        end if;
      end loop;
      if v_rent_remaining > 0 then
        v_rent_unbooked := v_rent_unbooked + v_rent_remaining;
      end if;
    end if;
  end loop;

  -- 8. Raten fortschreiben (höchstens bis zum offenen Planbetrag)
  if v_is_installment then
    v_inst_budget := least(v_amount, v_plan_remaining);
    for v_open_inst in
      select id, due_date, amount, paid_amount, status
        from public.payment_plan_installments
       where payment_plan_id = v_plan_id and status not in ('paid', 'cancelled')
       order by due_date, created_at
         for update
    loop
      exit when v_inst_budget <= 0;
      v_inst_alloc := least(v_inst_budget, v_open_inst.amount - v_open_inst.paid_amount);
      continue when v_inst_alloc <= 0;
      v_inst_new_paid := v_open_inst.paid_amount + v_inst_alloc;
      v_inst_new_status := case when v_inst_new_paid >= (v_open_inst.amount - 0.01) then 'paid' else 'partial' end;
      v_modified_installments := v_modified_installments || jsonb_build_array(jsonb_build_object(
        'id', v_open_inst.id,
        'due_date', v_open_inst.due_date,
        'old_paid_amount', v_open_inst.paid_amount,
        'old_status', v_open_inst.status,
        'new_status', v_inst_new_status,
        'allocated_amount', v_inst_alloc));
      update public.payment_plan_installments
         set paid_amount = v_inst_new_paid, status = v_inst_new_status, updated_at = now()
       where id = v_open_inst.id;
      v_inst_budget := v_inst_budget - v_inst_alloc;
    end loop;

    select coalesce(bool_and(status = 'paid'), false) into v_plan_completed
      from public.payment_plan_installments
     where payment_plan_id = v_plan_id and status <> 'cancelled';
    if v_plan_completed then
      update public.payment_plans set status = 'completed', updated_at = now() where id = v_plan_id;
    end if;
  end if;

  -- 9. Forderung: Zinsen netto fortschreiben, Zinsbeginn nie zurück (NULL bleibt NULL)
  update public.claims set
    accumulated_unpaid_interest = round(greatest(0, v_interest_open - v_alloc_interest), 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, p_payment_date) end,
    status = case
               when v_amount >= (v_total_due - 0.01) then 'settled'
               when v_plan_completed and status = 'payment_plan_active' then 'open'
               else status
             end,
    updated_at = now()
  where id = p_claim_id;

  -- 10. Ereignis (Felder wie bisher + Angaben für das Storno)
  v_event_metadata := jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_date', p_payment_date,
    'amount', v_amount,
    'allocated_to_fees', v_alloc_fees,
    'allocated_to_interest', v_alloc_interest,
    'allocated_to_principal', v_alloc_principal,
    'remaining_total_due', greatest(0, round(v_total_due - v_amount, 2)),
    'capitalized_interest', v_new_interest,
    'old_interest_start_date', v_claim.interest_start_date,
    'old_accumulated_unpaid_interest', v_claim.accumulated_unpaid_interest,
    'old_claim_status', v_claim.status);

  if v_rent_unbooked > 0 then
    v_event_metadata := v_event_metadata || jsonb_build_object('rent_mirror_unbooked', round(v_rent_unbooked, 2));
  end if;

  if v_target = 'specific_item' then
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'target_type', 'specific_item',
      'target_item_id', p_target_claim_item_id,
      'target_item_description', v_target_desc,
      'target_item_open_before', round(v_target_open + v_item_fee_open + v_item_interest_open, 2),
      'target_item_open_after', greatest(0, round(v_target_open + v_item_fee_open + v_item_interest_open
                                        - v_target_fee_alloc - v_target_interest_alloc - v_target_principal_alloc, 2)),
      'target_item_fee_allocated', v_target_fee_alloc,
      'target_item_interest_allocated', v_target_interest_alloc);
  elsif v_target = 'claim_items' then
    v_event_metadata := v_event_metadata || jsonb_build_object('target_type', 'claim_items');
  end if;

  if v_is_installment then
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'payment_plan_id', v_plan_id,
      'installment_id', v_installment_id,
      'old_plan_status', 'active',
      'plan_completed', v_plan_completed,
      'modified_installments', v_modified_installments);
  end if;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (coalesce(v_caller, v_owner), p_claim_id, 'payment_received', 'Zahlung erfasst', v_event_metadata);

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.register_trial_rate_check(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_claims       jsonb;
    v_email        text := lower(btrim(coalesce(p_email, '')));
    v_domain       text;
    v_global       integer;
    v_domain_count integer;
begin
    begin
        v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    exception when others then
        v_claims := null;
    end;

    if coalesce(v_claims ->> 'role', '') <> 'service_role' then
        raise exception 'register_trial_rate_check: nur für Server-Funktionen'
            using errcode = '42501';
    end if;

    v_domain := split_part(v_email, '@', 2);
    if position('@' in v_email) = 0 or v_domain = '' then
        return 'invalid';
    end if;

    select count(*) into v_global
      from public.subscriptions s
     where s.created_at > now() - interval '1 hour'
       and s.stripe_customer_id is null;

    if v_global >= 30 then
        return 'global_limit';
    end if;

    select count(*) into v_domain_count
      from public.subscriptions s
      join auth.users u on u.id = s.user_id
     where s.created_at > now() - interval '1 hour'
       and s.stripe_customer_id is null
       and lower(split_part(u.email, '@', 2)) = v_domain;

    if v_domain_count >= 10 then
        return 'domain_limit';
    end if;

    return 'ok';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.renovation_calculations_owner_follows_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer. ON DELETE SET NULL beim Löschen eines
    -- Objekts (läuft als Tabelleneigentümer), RPCs (SECURITY DEFINER) und Server-Zugriffe
    -- lassen user_id unverändert.
    if current_user <> 'authenticated' or v_uid is null then
        return new;
    end if;

    if new.property_id is null then
        -- Objekt entfernt: Eine Kalkulation ohne Objekt sieht nur ihr user_id-Konto. Sie geht
        -- an den Bearbeiter, sonst wäre sie für ihn unsichtbar und das Speichern scheitert.
        new.user_id := v_uid;
    elsif not public.rls_user_ok(new.user_id, 'property', new.property_id) then
        -- Objekt gewechselt: user_id muss wie beim Anlegen zum Objekt passen (eigenes Konto
        -- oder Portfolio-Eigentümer), sonst liest der bisherige Eigentümer weiter mit.
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = new.property_id;
        if v_owner is not null then
            new.user_id := v_owner;
        end if;
    end if;

    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.renovation_projects_same_owner_on_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_old_owner uuid;
    v_new_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer; RPCs (SECURITY DEFINER), Server und Admin
    -- bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    select po.user_id into v_old_owner
      from public.properties pr
      join public.portfolios po on po.id = pr.portfolio_id
     where pr.id = old.property_id;
    select po.user_id into v_new_owner
      from public.properties pr
      join public.portfolios po on po.id = pr.portfolio_id
     where pr.id = new.property_id;

    -- Wie bei Objekten/Einheiten/Mietverträgen (set_owner_user_id): nur innerhalb desselben
    -- Eigentümers. Sonst bliebe die alte user_id stehen und der bisherige Eigentümer behielte
    -- über has_renovation_project_access Zugriff auf Projekt und Unterdaten.
    if v_old_owner is null or v_new_owner is null or v_old_owner <> v_new_owner then
        raise exception 'Sanierungsprojekte können nur zu Objekten desselben Eigentümers verschoben werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.renovation_set_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    -- Angemeldete Konten: immer das eigene Konto; Dienste ohne Anmeldung behalten ihren Wert
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    -- Ersteller ist unveränderlich. Erlaubt sind nur das Leeren (ON DELETE SET NULL) und das
    -- Nachtragen eines fehlenden Werts ohne Anmeldung (Migration / Dienst).
    if new.created_by is distinct from old.created_by then
      if new.created_by is null then
        null;
      elsif old.created_by is null and auth.uid() is null then
        null;
      else
        new.created_by := old.created_by;
      end if;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.renovation_user_id_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_kind text;
    v_ref uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer; RPCs (SECURITY DEFINER), Server und Admin
    -- bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    -- Übergeordneter Datensatz wie in der jeweiligen Insert-Policy
    case tg_table_name
        when 'renovation_project_trades', 'renovation_project_subtrades',
             'renovation_invoices', 'renovation_tasks' then
            v_kind := 'renovation_project';
            v_ref := new.project_id;
        when 'renovation_milestones' then
            v_kind := 'renovation_project';
            select t.project_id into v_ref
              from public.renovation_project_trades t
             where t.id = new.project_trade_id;
        when 'renovation_calc_trades' then
            v_kind := 'renovation_calculation';
            v_ref := new.calculation_id;
        when 'renovation_calc_subtrades' then
            v_kind := 'renovation_calculation';
            select t.calculation_id into v_ref
              from public.renovation_calc_trades t
             where t.id = new.calc_trade_id;
        else
            raise exception 'renovation_user_id_guard: Tabelle % ist nicht vorgesehen', tg_table_name;
    end case;

    -- Neue user_id: eigenes Konto, Eigentümer oder user_id des Projekts/der Kalkulation
    -- (wie beim Anlegen). Ein beliebiges fremdes Konto nicht.
    if not public.rls_user_ok(new.user_id, v_kind, v_ref) then
        raise exception 'user_id kann nur auf das eigene Konto oder den Eigentümer der Daten geändert werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.rent_ledger_block_claimed_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if exists (select 1
                 from public.claim_items ci
                where ci.rent_ledger_id = old.id
                   or ci.rent_ledger_ids @> array[old.id]) then
        raise exception 'Die Sollstellung für % ist Teil einer Forderung und kann nicht gelöscht werden.',
                        coalesce(to_char(old.period_month, 'MM/YYYY'), 'diesen Monat')
            using errcode = '23503',
                  hint = 'Sollstellungen, die in einer Forderung verwendet werden (auch in stornierten), bleiben erhalten.';
    end if;
    return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reverse_appended_claim(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_ev public.claim_events%rowtype;
  v_claim public.claims%rowtype;
  v_item jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_fee numeric;
  v_interest numeric;
  v_fees_paid numeric := 0;
  v_new_fees numeric;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_ev
    from public.claim_events
   where id = p_event_id and event_type = 'note_added' and event_metadata->>'source' = 'append_advanced'
     for update;
  if not found then
    raise exception 'Das Ereignis wurde nicht gefunden oder ist keine Erweiterung der Akte.';
  end if;

  select * into v_claim from public.claims where id = v_ev.claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_claim.id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  -- Der Nachtrags-Eintrag bleibt erhalten; nur einmal rückgängig machen
  if exists (select 1 from public.claim_events r
              where r.claim_id = v_claim.id
                and r.event_type = 'note_added'
                and r.event_metadata->>'source' = 'append_reversed'
                and r.event_metadata->>'reversed_event_id' = p_event_id::text) then
    raise exception 'Dieser Nachtrag wurde bereits rückgängig gemacht.';
  end if;

  -- Positionen des Nachtrags: in derselben Transaktion angelegt (created_at = Ereignis)
  if jsonb_typeof(v_ev.event_metadata->'items') = 'array' then
    for v_item in select value from jsonb_array_elements(v_ev.event_metadata->'items')
    loop
      if coalesce(v_item->>'rent_ledger_id', '') ~ v_uuid_re then
        v_ids := v_ids || array(
          select ci.id from public.claim_items ci
           where ci.claim_id = v_claim.id
             and ci.created_at is not distinct from v_ev.created_at
             and (ci.rent_ledger_id = (v_item->>'rent_ledger_id')::uuid
                  or (v_item->>'rent_ledger_id')::uuid = any(ci.rent_ledger_ids)));
      else
        v_ids := v_ids || array(
          select ci.id from public.claim_items ci
           where ci.claim_id = v_claim.id
             and ci.created_at is not distinct from v_ev.created_at
             and ci.rent_ledger_id is null and ci.rent_ledger_ids is null
             and ci.description is not distinct from (v_item->>'description')
             and ci.original_amount = coalesce(nullif(v_item->>'amount', '')::numeric, -1)
             and not (ci.id = any(v_ids))
           order by ci.id
           limit 1);
      end if;
    end loop;

    -- Ältere Daten ohne übereinstimmenden Zeitstempel: bisherige Zuordnung
    if cardinality(v_ids) = 0 then
      for v_item in select value from jsonb_array_elements(v_ev.event_metadata->'items')
      loop
        if coalesce(v_item->>'rent_ledger_id', '') ~ v_uuid_re then
          v_ids := v_ids || array(
            select ci.id from public.claim_items ci
             where ci.claim_id = v_claim.id
               and (ci.rent_ledger_id = (v_item->>'rent_ledger_id')::uuid
                    or (v_item->>'rent_ledger_id')::uuid = any(ci.rent_ledger_ids))
             order by ci.created_at desc nulls last
             limit 1);
        else
          v_ids := v_ids || array(
            select ci.id from public.claim_items ci
             where ci.claim_id = v_claim.id
               and ci.rent_ledger_id is null and ci.rent_ledger_ids is null
               and ci.description is not distinct from (v_item->>'description')
               and ci.original_amount = coalesce(nullif(v_item->>'amount', '')::numeric, -1)
               and not (ci.id = any(v_ids))
             order by ci.created_at desc nulls last
             limit 1);
        end if;
      end loop;
    end if;
  end if;
  v_ids := array(select distinct x from unnest(v_ids) as t(x) where x is not null);

  if exists (select 1 from public.claim_payment_allocations where claim_item_id = any(v_ids)) then
    raise exception 'Für mindestens eine nachgetragene Position wurden bereits Zahlungen gebucht. Bitte zuerst diese Zahlungen stornieren.';
  end if;
  if exists (
    select 1 from public.payment_plans pp
     where pp.claim_id = v_claim.id and pp.status = 'active'
       and exists (select 1 from public.claim_items ci
                    where ci.id = any(v_ids)
                      and coalesce(ci.created_at, '-infinity'::timestamptz) <= pp.created_at)) then
    raise exception 'Die nachgetragenen Positionen sind Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- Gebühr und übergebene Zinsen des Nachtrags ausbuchen (bezahlte Gebühren bleiben)
  v_fee := greatest(0, coalesce(nullif(v_ev.event_metadata->>'fee_amount', '')::numeric, 0));
  v_interest := greatest(0, coalesce(nullif(v_ev.event_metadata->>'accumulated_interest', '')::numeric, 0));
  select coalesce(sum(a.amount), 0) into v_fees_paid
    from public.claim_payment_allocations a
    join public.claim_payments cp on cp.id = a.claim_payment_id
   where cp.claim_id = v_claim.id and cp.status = 'posted' and a.allocation_bucket = 'fees';
  v_new_fees := greatest(coalesce(v_claim.accumulated_unpaid_fees, 0) - v_fee,
                         least(coalesce(v_claim.accumulated_unpaid_fees, 0), v_fees_paid));

  update public.claims set
    accumulated_unpaid_fees = v_new_fees,
    accumulated_unpaid_interest = round(greatest(0, coalesce(accumulated_unpaid_interest, 0) - v_interest), 2),
    updated_at = now()
  where id = v_claim.id;

  delete from public.claim_items where id = any(v_ids);

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim.id, 'note_added', 'Nachtrag rückgängig gemacht',
      jsonb_build_object('source', 'append_reversed', 'reversed_event_id', p_event_id,
                         'deleted_item_ids', to_jsonb(v_ids), 'fee_removed', coalesce(v_claim.accumulated_unpaid_fees, 0) - v_new_fees,
                         'interest_removed', v_interest, 'items', v_ev.event_metadata->'items'));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reverse_claim_payment(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_pay public.claim_payments%rowtype;
  v_claim public.claims%rowtype;
  v_event jsonb;
  v_inst jsonb;
  v_row record;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_principal_bearing numeric := 0;
  v_correction numeric := 0;
  v_reversed_allocs jsonb;
  v_active_plan_created_at timestamptz;
  v_new_paid numeric;
  v_has_active_plan boolean;
  v_old_status text;
  v_new_status text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- Angemeldeter Nutzer oder Server-Rolle (Stripe-Webhook: Erstattung/Rückbuchung)
  if v_caller is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select * into v_pay from public.claim_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Zahlung nicht gefunden oder keine Berechtigung.';
  end if;

  -- Berechtigung auf die FORDERUNG (nicht nur auf die Zahlungszeile)
  select * into v_claim from public.claims where id = v_pay.claim_id for update;
  if not found
     or (v_caller is not null
         and v_claim.user_id <> v_caller
         and not public.has_claim_access(v_claim.id, 'finanzen', 'write')) then
    raise exception 'Zahlung nicht gefunden oder keine Berechtigung.';
  end if;

  if v_pay.status = 'cancelled' then
    return;  -- bereits storniert
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  if v_pay.status <> 'posted' then
    -- Entwurf ohne Buchungswirkung
    update public.claim_payments set status = 'cancelled' where id = p_payment_id;
    perform set_config('app.claims_rpc_bypass', '', true);
    return;
  end if;

  -- Ereignis der Zahlung (nur dieser Forderung)
  select e.event_metadata into v_event
    from public.claim_events e
   where e.claim_id = v_claim.id
     and e.event_type = 'payment_received'
     and e.event_metadata->>'payment_id' = p_payment_id::text
   order by e.created_at, e.id
   limit 1;

  -- Zuordnungen der Zahlung (Quelle: Tabelle, nicht Metadaten)
  select coalesce(sum(amount) filter (where allocation_bucket = 'fees'), 0),
         coalesce(sum(amount) filter (where allocation_bucket = 'interest'), 0),
         coalesce(sum(amount) filter (where allocation_bucket = 'principal'), 0),
         coalesce(jsonb_agg(jsonb_build_object('bucket', allocation_bucket, 'claim_item_id', claim_item_id, 'amount', amount)), '[]'::jsonb)
    into v_alloc_fees, v_alloc_interest, v_alloc_principal, v_reversed_allocs
    from public.claim_payment_allocations
   where claim_payment_id = p_payment_id;

  -- Zinskorrektur: die zurückgebuchte Hauptforderung war seit dem Zahlungstag zinspflichtig.
  -- Nicht bei Ratenzahlungen (Planpositionen zinsfrei) und nicht, wenn seither ein
  -- Ratenplan angelegt wurde (dann zugunsten des Mieters keine Nachberechnung).
  if v_claim.interest_start_date is not null
     and v_pay.payment_date < v_claim.interest_start_date
     and coalesce(v_event->>'payment_plan_id', '') = ''
     and not exists (select 1 from public.payment_plans pp
                      where pp.claim_id = v_claim.id and pp.created_at > v_pay.created_at) then
    select max(pp.created_at) into v_active_plan_created_at
      from public.payment_plans pp where pp.claim_id = v_claim.id and pp.status = 'active';
    select coalesce(sum(a.amount), 0) into v_principal_bearing
      from public.claim_payment_allocations a
      join public.claim_items ci on ci.id = a.claim_item_id
     where a.claim_payment_id = p_payment_id
       and a.allocation_bucket = 'principal'
       and (v_active_plan_created_at is null
            or coalesce(ci.created_at, '-infinity'::timestamptz) > v_active_plan_created_at);
    v_correction := public.claim_interest_amount(v_principal_bearing, v_claim.interest_rate,
                                                 v_pay.payment_date, v_claim.interest_start_date);
  end if;

  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_alloc_interest + v_correction, 2),
    updated_at = now()
  where id = v_claim.id;

  -- Raten zurückrechnen (nur Raten von Plänen dieser Forderung)
  if v_event is not null and jsonb_typeof(v_event->'modified_installments') = 'array' then
    for v_inst in select value from jsonb_array_elements(v_event->'modified_installments')
    loop
      continue when coalesce(v_inst->>'id', '') !~ v_uuid_re;
      select ppi.id, ppi.amount, ppi.paid_amount, ppi.status, pp.status as plan_status into v_row
        from public.payment_plan_installments ppi
        join public.payment_plans pp on pp.id = ppi.payment_plan_id
       where ppi.id = (v_inst->>'id')::uuid and pp.claim_id = v_claim.id
         for update of ppi;
      continue when not found;
      if nullif(v_inst->>'allocated_amount', '') is not null then
        v_new_paid := v_row.paid_amount - (v_inst->>'allocated_amount')::numeric;
      else
        v_new_paid := coalesce(nullif(v_inst->>'old_paid_amount', '')::numeric, 0);
      end if;
      v_new_paid := greatest(0, least(v_row.amount, v_new_paid));
      update public.payment_plan_installments set
        paid_amount = v_new_paid,
        status = case
                   when v_row.status = 'cancelled' or v_row.plan_status = 'cancelled' then 'cancelled'
                   when v_new_paid <= 0.005 then 'open'
                   when v_new_paid < v_row.amount - 0.01 then 'partial'
                   else 'paid'
                 end,
        updated_at = now()
      where id = v_row.id;
    end loop;
  elsif v_event is not null and coalesce(v_event->>'installment_id', '') ~ v_uuid_re then
    -- ältere Ereignisse ohne Kaskade
    select ppi.id, ppi.amount, ppi.paid_amount, ppi.status, pp.status as plan_status into v_row
      from public.payment_plan_installments ppi
      join public.payment_plans pp on pp.id = ppi.payment_plan_id
     where ppi.id = (v_event->>'installment_id')::uuid and pp.claim_id = v_claim.id
       for update of ppi;
    if found then
      v_new_paid := greatest(0, least(v_row.amount, coalesce(nullif(v_event->>'old_installment_paid_amount', '')::numeric, 0)));
      update public.payment_plan_installments set
        paid_amount = v_new_paid,
        status = case
                   when v_row.status = 'cancelled' or v_row.plan_status = 'cancelled' then 'cancelled'
                   when v_new_paid <= 0.005 then 'open'
                   when v_new_paid < v_row.amount - 0.01 then 'partial'
                   else 'paid'
                 end,
        updated_at = now()
      where id = v_row.id;
    end if;
  end if;

  -- Durch diese Zahlung abgeschlossener Plan wird wieder aktiv (nur wenn kein anderer aktiv ist)
  update public.payment_plans pp set status = 'active', updated_at = now()
   where pp.claim_id = v_claim.id
     and pp.status = 'completed'
     and exists (select 1 from public.payment_plan_installments i
                  where i.payment_plan_id = pp.id and i.status not in ('paid', 'cancelled'))
     and not exists (select 1 from public.payment_plans o
                      where o.claim_id = v_claim.id and o.status = 'active' and o.id <> pp.id);

  -- Status der Forderung
  select exists (select 1 from public.payment_plans where claim_id = v_claim.id and status = 'active')
    into v_has_active_plan;
  v_old_status := nullif(v_event->>'old_claim_status', '');
  v_new_status := case
    when v_claim.status = 'settled' then
      case
        when v_has_active_plan then 'payment_plan_active'
        when v_old_status is not null
             and v_old_status not in ('settled', 'cancelled', 'archived', 'payment_plan_active') then v_old_status
        else 'open'
      end
    when v_claim.status = 'open' and v_has_active_plan then 'payment_plan_active'
    else v_claim.status
  end;
  update public.claims set status = v_new_status, updated_at = now() where id = v_claim.id;

  -- Gespiegelte Mietzahlungen entfernen (Mietkonto zeigt den Rückstand wieder).
  -- Verknüpfung über claim_payment_id; Altzeilen ohne Verknüpfung über den Notiztext.
  perform set_config('app.bypass_rent_payment_protect', '1', true);
  delete from public.rent_payments
   where user_id = v_claim.user_id
     and (claim_payment_id = p_payment_id
          or (claim_payment_id is null
              and note like '%(Ref: ' || p_payment_id::text || ')%'));
  perform set_config('app.bypass_rent_payment_protect', '', true);

  -- Zahlung bleibt als storniert erhalten; Zuordnungen werden entfernt (sie stehen im
  -- Storno-Ereignis), damit Positionen später gelöscht werden können.
  delete from public.claim_payment_allocations where claim_payment_id = p_payment_id;
  update public.claim_payments set status = 'cancelled' where id = p_payment_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (coalesce(v_caller, v_claim.user_id), v_claim.id, 'payment_reversed', 'Zahlung storniert',
      jsonb_build_object(
          'payment_id', p_payment_id,
          'amount', v_pay.amount,
          'original_payment_date', v_pay.payment_date,
          'reversal_date', current_date,
          'reason', case when v_caller is null
                         then 'Automatisch storniert (Erstattung/Rückbuchung beim Zahlungsdienstleister)'
                         else 'Manuell storniert' end,
          'reversed_by', v_caller,
          'waiver', v_pay.allocation_type = 'waiver',
          'reversed_fees', v_alloc_fees,
          'reversed_interest', v_alloc_interest,
          'reversed_principal', v_alloc_principal,
          'reversed_allocations', v_reversed_allocs,
          'interest_correction', v_correction,
          'old_claim_status', v_claim.status,
          'new_claim_status', v_new_status));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reverse_payment_plan(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_plan public.payment_plans%rowtype;
  v_paid numeric := 0;
  v_cap numeric := 0;
  v_booked boolean := false;
  v_adj numeric := 0;
  v_fees_paid numeric := 0;
  v_new_fees numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(p_claim_id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  select * into v_plan
    from public.payment_plans
   where claim_id = p_claim_id and status = 'active'
   order by created_at desc
   limit 1
     for update;
  if not found then
    raise exception 'Kein aktiver Ratenplan für diese Forderung gefunden.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- Zinsen bis heute (Planpositionen waren zinsfrei) festschreiben
  v_cap := coalesce(public.claim_live_interest(p_claim_id, public.claim_today()), 0);

  -- Aufschlag nur ausbuchen, wenn ihn create_payment_plan als Gebühr gebucht hat
  v_booked := exists (
    select 1 from public.claim_events e
     where e.claim_id = p_claim_id
       and e.event_type = 'payment_plan_accepted'
       and e.event_metadata->>'payment_plan_id' = v_plan.id::text
       and e.event_metadata->>'surcharge_booked_as_fee' = 'true');
  if v_booked then
    v_adj := greatest(0, coalesce(v_plan.interest_or_fee_adjustment, 0));
  end if;
  select coalesce(sum(a.amount), 0) into v_fees_paid
    from public.claim_payment_allocations a
    join public.claim_payments cp on cp.id = a.claim_payment_id
   where cp.claim_id = p_claim_id and cp.status = 'posted' and a.allocation_bucket = 'fees';
  v_new_fees := greatest(coalesce(v_claim.accumulated_unpaid_fees, 0) - v_adj,
                         least(coalesce(v_claim.accumulated_unpaid_fees, 0), v_fees_paid));

  select coalesce(sum(paid_amount), 0) into v_paid
    from public.payment_plan_installments where payment_plan_id = v_plan.id;

  if v_paid > 0 then
    -- Bereits (teil)bezahlt: Plan als storniert behalten (Nachweis der Vereinbarung)
    update public.payment_plan_installments
       set status = 'cancelled', updated_at = now()
     where payment_plan_id = v_plan.id and status <> 'paid';
    update public.payment_plans
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_caller,
           cancellation_reason = 'Ratenplan rückgängig gemacht', updated_at = now()
     where id = v_plan.id;
  else
    delete from public.payment_plan_installments where payment_plan_id = v_plan.id;
    delete from public.payment_plans where id = v_plan.id;
  end if;

  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap, 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, public.claim_today()) end,
    accumulated_unpaid_fees = v_new_fees,
    status = case when status = 'payment_plan_active' then 'open' else status end,
    next_action_at = null,
    updated_at = now()
  where id = p_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, p_claim_id, 'note_added', 'Ratenzahlungsvereinbarung rückgängig gemacht',
      jsonb_build_object(
          'source', 'payment_plan_reversed',
          'payment_plan_id', v_plan.id,
          'paid_in_plan', v_paid,
          'plan_kept_as_cancelled', v_paid > 0,
          'surcharge_removed', coalesce(v_claim.accumulated_unpaid_fees, 0) - v_new_fees,
          'capitalized_interest', v_cap));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_contact_user_id_unchanged(p_contact_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select not exists (select 1 from public.contacts c
                      where c.id = p_contact_id
                        and c.user_id is distinct from p_user_id)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_is_my_landlord(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and exists (select 1 from public.user_roles ur
                join public.properties pr on pr.id = ur.property_id
                join public.portfolios po on po.id = pr.portfolio_id
                where ur.user_id = auth.uid()
                  and ur.role = 'tenant'
                  and po.user_id = p_user_id),
    false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_is_portfolio_owner(p_portfolio_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and exists (select 1 from public.portfolios po
                where po.id = p_portfolio_id and po.user_id = auth.uid()),
    false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_is_unit_tenant(p_user_id uuid, p_unit_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and p_unit_id is not null
    and exists (select 1 from public.user_roles ur
                where ur.user_id = p_user_id
                  and ur.role = 'tenant'
                  and ur.unit_id = p_unit_id),
    false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_message_allowed(p_receiver uuid, p_ticket_id uuid, p_is_system boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_receiver is not null
    and p_receiver <> auth.uid()
    and (
      exists (select 1 from public.user_roles ur
              where ur.user_id = p_receiver
                and ur.role = 'tenant'
                and ur.property_id is not null
                and public.has_property_access(ur.property_id, 'mieterportal', 'write'))
      or (
        coalesce(p_is_system, false) = false
        and (
          exists (select 1 from public.user_roles me
                  join public.properties pr on pr.id = me.property_id
                  join public.portfolios po on po.id = pr.portfolio_id
                  where me.user_id = auth.uid()
                    and me.role = 'tenant'
                    and (po.user_id = p_receiver
                         or exists (select 1 from public.portfolio_shares s
                                    join auth.users au on lower(au.email) = lower(s.shared_with_email)
                                    where s.portfolio_id = po.id
                                      and s.status = 'accepted'
                                      and au.id = p_receiver
                                      and public.share_permits(s.permissions, 'mieterportal', 'read'))))
          or exists (select 1 from public.messages m
                     where m.sender_id = p_receiver and m.receiver_id = auth.uid())
        )
      )
    )
    and (
      p_ticket_id is null
      or exists (select 1 from public.tickets t
                 where t.id = p_ticket_id
                   and (t.tenant_user_id = auth.uid()
                        or public.has_property_access(t.property_id, 'mieterportal', 'write')))
    ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_ok_event_core_unchanged(p_id uuid, p_user_id uuid, p_property_id uuid, p_event_type text, p_title text, p_color text, p_event_date date, p_recurring boolean, p_recurrence_rule text, p_recurring_end_date date, p_assigned_unit_id uuid, p_assigned_unit_name text, p_waste_type text, p_push_enabled boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.objektkalender_events e
    where e.id = p_id
      and e.user_id is not distinct from p_user_id
      and e.property_id is not distinct from p_property_id
      and e.event_type is not distinct from p_event_type
      and e.title is not distinct from p_title
      and e.color is not distinct from p_color
      and e.event_date is not distinct from p_event_date
      and e.recurring is not distinct from p_recurring
      and e.recurrence_rule is not distinct from p_recurrence_rule
      and e.recurring_end_date is not distinct from p_recurring_end_date
      and e.assigned_unit_id is not distinct from p_assigned_unit_id
      and e.assigned_unit_name is not distinct from p_assigned_unit_name
      and e.waste_type is not distinct from p_waste_type
      and e.push_enabled is not distinct from p_push_enabled)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_owner_shares(p_owner uuid, p_category text, p_access text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_owner is not null
    and (
      p_owner = auth.uid()
      or exists (select 1 from public.portfolios po
                 where po.user_id = p_owner
                   and public.has_portfolio_access(po.id, p_category, p_access))
    ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_tenant_link_unchanged(p_table text, p_id uuid, p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and case p_table
      when 'leases' then exists (select 1 from public.leases x
                                 where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'claims' then exists (select 1 from public.claims x
                                 where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'contacts' then exists (select 1 from public.contacts x
                                   where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'documents' then exists (select 1 from public.documents x
                                    where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      else false
    end, false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_tenant_ok(p_tenant_id uuid, p_kind text, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_tenant_id is null
      or exists (select 1 from public.tenants t
                 where t.id = p_tenant_id
                   and case when p_kind = 'user' then t.user_id = p_id
                            else public.rls_user_ok(t.user_id, p_kind, p_id) end)
      or (p_kind = 'property'
          and exists (select 1 from public.leases l
                      join public.units u on u.id = l.unit_id
                      where l.tenant_id = p_tenant_id and u.property_id = p_id))
      or (p_kind = 'unit'
          and exists (select 1 from public.leases l
                      where l.tenant_id = p_tenant_id and l.unit_id = p_id))
      or (p_kind = 'lease'
          and exists (select 1 from public.leases l
                      where l.id = p_id and l.tenant_id = p_tenant_id))
$function$
;
CREATE OR REPLACE FUNCTION public.rls_tenant_unleased_shared(p_tenant_id uuid, p_owner uuid, p_category text, p_access text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    p_tenant_id is not null
    and not exists (select 1 from public.leases l where l.tenant_id = p_tenant_id)
    and public.rls_owner_shares(p_owner, p_category, p_access),
    false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_tenant_user_id_unchanged(p_tenant_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select not exists (select 1 from public.tenants t
                     where t.id = p_tenant_id
                       and t.user_id is distinct from p_user_id)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_ticket_message_visible(p_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_ticket_id is not null
    and exists (select 1 from public.tickets t
                 where t.id = p_ticket_id
                   and public.has_property_access(t.property_id, 'mieterportal', 'read')),
    false)
$function$
;
CREATE OR REPLACE FUNCTION public.rls_user_ok(p_user_id uuid, p_kind text, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and (
      p_user_id = auth.uid()
      or p_user_id = case p_kind
        when 'portfolio' then
          (select po.user_id from public.portfolios po where po.id = p_id)
        when 'property' then
          (select po.user_id from public.properties pr
             join public.portfolios po on po.id = pr.portfolio_id
            where pr.id = p_id)
        when 'unit' then
          (select po.user_id from public.units u
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where u.id = p_id)
        when 'lease' then
          (select po.user_id from public.leases l
             join public.units u on u.id = l.unit_id
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where l.id = p_id)
        when 'claim' then
          (select po.user_id from public.claims c
             join public.leases l on l.id = c.lease_id
             join public.units u on u.id = l.unit_id
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where c.id = p_id)
        when 'invoice' then
          (select po.user_id from public.invoices i
             join public.portfolios po on po.id = i.portfolio_id
            where i.id = p_id)
        when 'economic_unit' then
          (select e.user_id from public.economic_units e where e.id = p_id)
        when 'renovation_project' then
          (select po.user_id from public.renovation_projects rp
             join public.properties pr on pr.id = rp.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where rp.id = p_id)
        when 'renovation_calculation' then
          (select po.user_id from public.renovation_calculations rc
             join public.properties pr on pr.id = rc.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where rc.id = p_id)
        else null
      end
      or (p_kind = 'claim'
          and p_user_id = (select c.user_id from public.claims c where c.id = p_id))
      or (p_kind = 'renovation_project'
          and p_user_id = (select rp.user_id from public.renovation_projects rp where rp.id = p_id))
      or (p_kind = 'renovation_calculation'
          and p_user_id = (select rc.user_id from public.renovation_calculations rc where rc.id = p_id))
    ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.save_property_economic_unit(p_property_id uuid, p_portfolio_id uuid, p_property jsonb, p_we_id uuid DEFAULT NULL::uuid, p_join_ids uuid[] DEFAULT '{}'::uuid[], p_remove_ids uuid[] DEFAULT '{}'::uuid[], p_add_member_values boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_prop_id uuid := p_property_id;
    v_join uuid[];
    v_remove uuid[];
    v_joining uuid[] := '{}'::uuid[];
    v_street text;
    v_house text;
    v_investment numeric;
    v_equity numeric;
    v_join_investment numeric := 0;
    v_join_equity numeric := 0;
    v_other_portfolio int := 0;
    v_other_we int := 0;
    v_rows int;
begin
    if v_uid is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_portfolio_id is null then
        raise exception 'Bitte wählen Sie ein Portfolio aus.';
    end if;
    if p_property is null or jsonb_typeof(p_property) <> 'object' then
        raise exception 'Die Angaben zur Immobilie fehlen.';
    end if;

    v_join := coalesce((select array_agg(distinct x) from unnest(coalesce(p_join_ids, '{}'::uuid[])) as t(x) where x is not null), '{}'::uuid[]);
    v_remove := coalesce((select array_agg(distinct x) from unnest(coalesce(p_remove_ids, '{}'::uuid[])) as t(x) where x is not null), '{}'::uuid[]);

    v_street := btrim(coalesce(p_property ->> 'street', ''));
    v_house := btrim(coalesce(p_property ->> 'house_number', ''));
    if v_street = '' or v_house = '' then
        raise exception 'Bitte geben Sie Straße und Hausnummer an.';
    end if;

    v_investment := coalesce(nullif(p_property ->> 'total_investment_cost', '')::numeric, 0);
    v_equity := coalesce(nullif(p_property ->> 'equity_invested', '')::numeric, 0);
    if v_investment < 0 or v_equity < 0 then
        raise exception 'Gesamtinvestition und Eigenkapital dürfen nicht negativ sein.';
    end if;

    if p_we_id is null and (cardinality(v_join) > 0 or cardinality(v_remove) > 0) then
        raise exception 'Ohne Wirtschaftseinheit können keine Objekte zugeordnet oder gelöst werden.';
    end if;
    if (v_join && v_remove) or (v_prop_id is not null and (v_prop_id = any(v_join) or v_prop_id = any(v_remove))) then
        raise exception 'Die Auswahl der Wirtschaftseinheit ist widersprüchlich. Bitte laden Sie die Seite neu.';
    end if;

    -- Eigentümer des Portfolios (neue Wirtschaftseinheiten gehören ihm); nur sichtbare Portfolios
    select po.user_id into v_owner from public.portfolios po where po.id = p_portfolio_id;
    if v_owner is null then
        raise exception 'Das Portfolio wurde nicht gefunden oder Sie haben keinen Zugriff darauf.';
    end if;

    -- 1. Mitglieder sperren. FOR UPDATE liefert nur Zeilen, die der Nutzer auch ändern darf.
    if cardinality(v_join) > 0 then
        select count(*) into v_rows
          from (select pr.id from public.properties pr where pr.id = any(v_join) for update) s;
        if v_rows <> cardinality(v_join) then
            raise exception 'Mindestens ein ausgewähltes Objekt der Wirtschaftseinheit ist nicht mehr verfügbar oder Sie haben keine Schreibberechtigung dafür. Es wurde nichts geändert.';
        end if;

        select count(*) filter (where pr.portfolio_id <> p_portfolio_id),
               count(*) filter (where pr.economic_unit_id is not null and pr.economic_unit_id <> p_we_id),
               coalesce(array_agg(pr.id) filter (where pr.economic_unit_id is distinct from p_we_id), '{}'::uuid[]),
               coalesce(sum(coalesce(pr.total_investment_cost, 0)) filter (where pr.economic_unit_id is distinct from p_we_id), 0),
               coalesce(sum(coalesce(pr.equity_invested, 0)) filter (where pr.economic_unit_id is distinct from p_we_id), 0)
          into v_other_portfolio, v_other_we, v_joining, v_join_investment, v_join_equity
          from public.properties pr
         where pr.id = any(v_join);

        if v_other_portfolio > 0 then
            raise exception 'Eine Wirtschaftseinheit kann nur Objekte desselben Portfolios enthalten. Es wurde nichts geändert.';
        end if;
        if v_other_we > 0 then
            raise exception 'Mindestens ein ausgewähltes Objekt gehört bereits zu einer anderen Wirtschaftseinheit. Bitte lösen Sie es zuerst dort heraus. Es wurde nichts geändert.';
        end if;
    end if;

    if cardinality(v_remove) > 0 then
        select count(*) into v_rows
          from (select pr.id from public.properties pr
                 where pr.id = any(v_remove) and pr.economic_unit_id = p_we_id
                 for update) s;
        if v_rows <> cardinality(v_remove) then
            raise exception 'Mindestens ein zu lösendes Objekt gehört nicht mehr zu dieser Wirtschaftseinheit oder Sie haben keine Schreibberechtigung dafür. Bitte laden Sie die Seite neu. Es wurde nichts geändert.';
        end if;
    end if;

    -- 2. Wirtschaftseinheit: Gesamtwerte (user_id nur beim Anlegen)
    if p_we_id is not null then
        update public.economic_units e
           set total_investment_cost = v_investment + case when p_add_member_values then v_join_investment else 0 end,
               equity_invested = v_equity + case when p_add_member_values then v_join_equity else 0 end,
               updated_at = now()
         where e.id = p_we_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
            begin
                insert into public.economic_units (id, user_id, total_investment_cost, equity_invested, updated_at)
                values (p_we_id, v_owner,
                        v_investment + case when p_add_member_values then v_join_investment else 0 end,
                        v_equity + case when p_add_member_values then v_join_equity else 0 end,
                        now());
            exception when unique_violation then
                -- existiert, ist für den Nutzer aber nicht änderbar
                raise exception 'Die Gesamtwerte der Wirtschaftseinheit konnten nicht gespeichert werden (keine Berechtigung). Es wurde nichts geändert.';
            end;
        end if;
    end if;

    -- 3. Objekt (Eigentümer und Portfolio bleiben beim Bearbeiten unverändert)
    if v_prop_id is null then
        insert into public.properties (
            user_id, portfolio_id, street, house_number, zip, city, construction_year, property_type,
            total_investment_cost, equity_invested, economic_unit_id, thumbnail_image)
        values (
            v_owner, p_portfolio_id, v_street, v_house,
            btrim(coalesce(p_property ->> 'zip', '')),
            btrim(coalesce(p_property ->> 'city', '')),
            nullif(p_property ->> 'construction_year', '')::integer,
            coalesce(nullif(p_property ->> 'property_type', ''), 'residential'),
            case when p_we_id is null then v_investment else 0 end,
            case when p_we_id is null then v_equity else 0 end,
            p_we_id,
            nullif(p_property ->> 'thumbnail_image', ''))
        returning id into v_prop_id;
    else
        update public.properties pr
           set street = v_street,
               house_number = v_house,
               zip = btrim(coalesce(p_property ->> 'zip', '')),
               city = btrim(coalesce(p_property ->> 'city', '')),
               construction_year = nullif(p_property ->> 'construction_year', '')::integer,
               property_type = case when p_property ? 'property_type'
                                    then coalesce(nullif(p_property ->> 'property_type', ''), pr.property_type)
                                    else pr.property_type end,
               total_investment_cost = case when p_we_id is null then v_investment else 0 end,
               equity_invested = case when p_we_id is null then v_equity else 0 end,
               economic_unit_id = p_we_id,
               thumbnail_image = case when p_property ? 'thumbnail_image'
                                      then nullif(p_property ->> 'thumbnail_image', '')
                                      else pr.thumbnail_image end
         where pr.id = v_prop_id
           and pr.portfolio_id = p_portfolio_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
            raise exception 'Die Immobilie konnte nicht gespeichert werden (keine Berechtigung oder nicht mehr vorhanden). Es wurde nichts geändert.';
        end if;
    end if;

    -- 4. Neue Mitglieder zuordnen; ihre Einzelwerte stecken (optional) in den WE-Gesamtwerten
    if cardinality(v_joining) > 0 then
        update public.properties pr
           set economic_unit_id = p_we_id,
               total_investment_cost = 0,
               equity_invested = 0
         where pr.id = any(v_joining);
        get diagnostics v_rows = row_count;
        if v_rows <> cardinality(v_joining) then
            raise exception 'Mindestens ein Objekt konnte der Wirtschaftseinheit nicht zugeordnet werden (keine Berechtigung). Es wurde nichts geändert.';
        end if;
    end if;

    -- 5. Mitglieder lösen (ihre Einzelwerte trägt der Nutzer danach selbst ein)
    if cardinality(v_remove) > 0 then
        update public.properties pr
           set economic_unit_id = null
         where pr.id = any(v_remove)
           and pr.economic_unit_id = p_we_id;
        get diagnostics v_rows = row_count;
        if v_rows <> cardinality(v_remove) then
            raise exception 'Mindestens ein Objekt konnte nicht aus der Wirtschaftseinheit gelöst werden (keine Berechtigung). Es wurde nichts geändert.';
        end if;
    end if;

    return v_prop_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_forderungsmanagement_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_owner_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_owner uuid;
    v_moved boolean := false;
begin
    if tg_table_name = 'properties' then
        select po.user_id into v_owner
          from public.portfolios po
         where po.id = new.portfolio_id;
        if tg_op = 'UPDATE' then
            v_moved := new.portfolio_id is distinct from old.portfolio_id;
        end if;
    elsif tg_table_name = 'units' then
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = new.property_id;
        if tg_op = 'UPDATE' then
            v_moved := new.property_id is distinct from old.property_id;
        end if;
    elsif tg_table_name = 'leases' then
        select po.user_id into v_owner
          from public.units u
          join public.properties pr on pr.id = u.property_id
          join public.portfolios po on po.id = pr.portfolio_id
         where u.id = new.unit_id;
        if tg_op = 'UPDATE' then
            v_moved := new.unit_id is distinct from old.unit_id;
        end if;
    end if;

    if tg_op = 'INSERT' then
        if v_owner is not null then
            new.user_id := v_owner;
        end if;
        return new;
    end if;

    new.user_id := old.user_id;
    if v_moved and v_owner is not null and v_owner <> old.user_id then
        raise exception 'Datensätze können nur innerhalb der Portfolios desselben Eigentümers verschoben werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.settle_claim_item(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_claim_id uuid;
  v_item_created timestamptz;
  v_desc text;
  v_open numeric;
  v_payment_id uuid;
  v_cap numeric := 0;
  v_plan_id uuid;
  v_plan_created timestamptz;
  v_plan_remaining numeric := 0;
  v_total_due numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select ci.claim_id, ci.created_at, ci.description
    into v_claim_id, v_item_created, v_desc
    from public.claim_items ci where ci.id = p_item_id;
  if not found then
    raise exception 'Position nicht gefunden oder keine Berechtigung.';
  end if;
  select * into v_claim from public.claims where id = v_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_claim_id, 'finanzen', 'write')) then
    raise exception 'Position nicht gefunden oder keine Berechtigung.';
  end if;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung können keine Positionen mehr als erledigt markiert werden (Status: %).', v_claim.status;
  end if;

  select coalesce(open_amount, 0) into v_open from public.claim_item_totals_view where claim_item_id = p_item_id;
  if coalesce(v_open, 0) <= 0 then
    raise exception 'Position ist bereits vollständig erledigt.';
  end if;

  select id, created_at into v_plan_id, v_plan_created
    from public.payment_plans where claim_id = v_claim_id and status = 'active'
   order by created_at desc limit 1;
  if v_plan_id is not null then
    if coalesce(v_item_created, '-infinity'::timestamptz) <= v_plan_created then
      raise exception 'Diese Position ist Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
    end if;
    -- Invariante wie in record_claim_payment (nur für Pläne mit gebuchtem Aufschlag)
    if exists (select 1 from public.claim_events e
                where e.claim_id = v_claim_id
                  and e.event_type = 'payment_plan_accepted'
                  and e.event_metadata->>'payment_plan_id' = v_plan_id::text
                  and e.event_metadata->>'surcharge_booked_as_fee' = 'true') then
      select coalesce(sum(greatest(0::numeric, amount - paid_amount)), 0) into v_plan_remaining
        from public.payment_plan_installments where payment_plan_id = v_plan_id and status <> 'cancelled';
      select round(coalesce(total_due, 0), 2) into v_total_due from public.claim_totals_view where claim_id = v_claim_id;
      if v_open > round(coalesce(v_total_due, 0) - v_plan_remaining, 2) + 0.005 then
        raise exception 'Die Position kann nicht ausgebucht werden, solange der Ratenplan offen ist.';
      end if;
    end if;
  end if;

  -- Zinsen bis heute festschreiben, dann die Hauptforderung der Position ausbuchen
  v_cap := coalesce(public.claim_live_interest(v_claim_id, public.claim_today()), 0);
  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap, 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, public.claim_today()) end,
    updated_at = now()
  where id = v_claim_id;

  -- Erlass/Ausbuchung: eigene Zuordnungsart 'waiver' (kein Geldeingang)
  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_claim.user_id, v_claim_id, public.claim_today(), v_open, 'waiver', 'posted', 'Als erledigt markiert (Erlass/Ausbuchung)')
  returning id into v_payment_id;

  insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
  values (v_payment_id, v_claim.user_id, v_claim_id, 'principal', p_item_id, v_open);

  select round(coalesce(total_due, 0), 2) into v_total_due from public.claim_totals_view where claim_id = v_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim_id, 'payment_received', 'Position manuell als erledigt markiert (Erlass/Ausbuchung, kein Geldeingang)',
      jsonb_build_object(
          'payment_id', v_payment_id,
          'payment_date', public.claim_today(),
          'amount', v_open,
          'allocated_to_fees', 0,
          'allocated_to_interest', 0,
          'allocated_to_principal', v_open,
          'waiver', true,
          'allocation_type', 'waiver',
          'target_type', 'specific_item',
          'target_item_id', p_item_id,
          'target_item_description', v_desc,
          'target_item_open_after', 0,
          'remaining_total_due', greatest(0, coalesce(v_total_due, 0)),
          'capitalized_interest', v_cap,
          'old_claim_status', v_claim.status,
          'note', 'Als erledigt markiert'));

  if coalesce(v_total_due, 0) <= 0.01 then
    update public.claims set status = 'settled', updated_at = now() where id = v_claim_id;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.share_permits(p_permissions jsonb, p_category text, p_access text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then false
    when p_category = '*' then exists (
      select 1 from jsonb_each_text(p_permissions) e
      where (p_access = 'read'  and e.value in ('read', 'write'))
         or (p_access = 'write' and e.value = 'write'))
    when p_access = 'read'  then coalesce(p_permissions ->> p_category, '') in ('read', 'write')
    when p_access = 'write' then coalesce(p_permissions ->> p_category, '') = 'write'
    else false
  end
$function$
;
CREATE OR REPLACE FUNCTION public.storage_segment_uuid(p_segment text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_segment::uuid
  end
$function$
;
CREATE OR REPLACE FUNCTION public.stripe_webhook_event_begin(p_event_id text, p_event_type text, p_livemode boolean DEFAULT NULL::boolean, p_account text DEFAULT NULL::text, p_created bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text;
  v_started timestamptz;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]{1,255}$' then
    raise exception 'Ungültige Stripe-Ereignis-ID.' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, livemode, connect_account, stripe_created_at)
  values (
    p_event_id,
    left(coalesce(nullif(btrim(p_event_type), ''), 'unknown'), 100),
    p_livemode,
    case when p_account ~ '^acct_[A-Za-z0-9]{1,255}$' then p_account end,
    case when p_created > 0 and p_created < 32503680000 then to_timestamp(p_created) end)
  on conflict (event_id) do nothing;
  if found then
    return 'process';
  end if;

  -- Ereignis ist bekannt: Zeile sperren, damit nur EINE Zustellung es übernimmt
  select e.status, e.started_at into v_status, v_started
    from public.stripe_webhook_events e
   where e.event_id = p_event_id
   for update;

  if v_status = 'processed' then
    return 'duplicate';
  end if;
  if v_status = 'processing' and v_started > clock_timestamp() - interval '10 minutes' then
    return 'in_progress';
  end if;

  -- fehlgeschlagen oder abgebrochen → erneut verarbeiten
  update public.stripe_webhook_events
     set status = 'processing',
         attempts = attempts + 1,
         started_at = clock_timestamp()
   where event_id = p_event_id;
  return 'process';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.stripe_webhook_event_finish(p_event_id text, p_success boolean, p_outcome text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.stripe_webhook_events
     set status = case when coalesce(p_success, false) then 'processed' else 'failed' end,
         processed_at = case when coalesce(p_success, false) then clock_timestamp() end,
         outcome = case when p_outcome ~ '^[a-z_]{1,100}$' then p_outcome end,
         last_error = case
                        when coalesce(p_success, false) then null
                        else left(coalesce(nullif(btrim(p_error), ''), 'Unbekannter Fehler'), 500)
                      end
   where event_id = p_event_id;

  -- Aufbewahrung: erledigte Einträge nach 180 Tagen löschen (höchstens 200 je Aufruf)
  begin
    delete from public.stripe_webhook_events
     where ctid = any (array(
             select e.ctid
               from public.stripe_webhook_events e
              where e.status = 'processed'
                and e.received_at < now() - interval '180 days'
              order by e.received_at
              limit 200
                for update skip locked));
  exception when others then
    raise warning 'stripe_webhook_events: Aufräumen übersprungen (%)', sqlerrm;
  end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_public_payment_plan_request(p_token text, p_pin text, p_requested_months integer, p_requested_rate numeric, p_requested_total numeric, p_adjustment_amount numeric, p_tenant_message text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_access jsonb;
  v_claim public.claims%rowtype;
  v_reason text;
  v_options jsonb;
  v_surcharge numeric;
  v_base numeric;
  v_adjustment numeric;
  v_total numeric;
  v_rate numeric;
  v_message text;
  c_max_message constant integer := 2000;
begin
  v_access := public.claim_portal_check_access(p_token, p_pin);

  if not coalesce((v_access ->> 'ok')::boolean, false) then
    if v_access ->> 'code' in ('invalid_pin', 'link_locked') then
      return json_build_object(
        'success', false,
        'error', v_access ->> 'error',
        'code', v_access ->> 'code',
        'attempts_left', v_access -> 'attempts_left');
    end if;
    raise exception using message = v_access ->> 'error', hint = v_access ->> 'code';
  end if;

  select * into v_claim from public.claims c where c.id = (v_access ->> 'claim_id')::uuid for update;
  if not found then
    raise exception using message = 'Diese Forderung ist bereits abgeschlossen oder storniert.', hint = 'claim_closed';
  end if;

  v_reason := public.claim_portal_plan_request_block_reason(v_claim.id);
  if v_reason is not null then
    raise exception using message = v_reason, hint = 'request_not_allowed';
  end if;

  if p_requested_months is null then
    raise exception using message = 'Bitte wählen Sie eine der angebotenen Laufzeiten.', hint = 'invalid_option';
  end if;

  select public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_options
    from public.profiles p
   where p.id = v_claim.user_id;
  if not found then
    v_options := public.claim_portal_installment_options(null);
  end if;

  select (o ->> 'surcharge_percent')::numeric
    into v_surcharge
    from jsonb_array_elements(v_options) o
   where (o ->> 'months')::integer = p_requested_months
   limit 1;
  if not found then
    raise exception using message = 'Die gewählte Laufzeit wird nicht angeboten. Bitte wählen Sie eine der angebotenen Laufzeiten.',
                          hint = 'invalid_option';
  end if;

  v_message := nullif(btrim(coalesce(p_tenant_message, '')), '');
  if length(v_message) > c_max_message then
    raise exception using message = 'Die Nachricht darf höchstens 2000 Zeichen lang sein.', hint = 'message_too_long';
  end if;

  select round(coalesce(t.total_due, 0), 2) into v_base
    from public.claim_totals_view t
   where t.claim_id = v_claim.id;

  v_adjustment := round(v_base * v_surcharge / 100, 2);
  v_total := v_base + v_adjustment;
  v_rate := round(v_total / p_requested_months, 2);

  insert into public.payment_plan_requests (
      claim_id, access_link_id, requested_months, requested_rate, requested_total, adjustment_amount, tenant_message
  ) values (
      v_claim.id, (v_access ->> 'link_id')::uuid, p_requested_months, v_rate, v_total, v_adjustment, v_message
  );

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (
      v_claim.user_id,
      v_claim.id,
      'payment_plan_requested',
      'Mieter hat eine Ratenzahlung angefragt',
      jsonb_build_object(
          'requested_months', p_requested_months,
          'requested_rate', v_rate,
          'requested_total', v_total,
          'adjustment_amount', v_adjustment,
          'base_amount', v_base,
          'surcharge_percent', v_surcharge,
          'tenant_message', v_message,
          'previous_status', v_claim.status,
          'access_link_id', v_access ->> 'link_id'
      )
  );

  update public.claims set status = 'payment_plan_requested' where id = v_claim.id;

  return json_build_object(
      'success', true,
      'requested_months', p_requested_months,
      'requested_rate', v_rate,
      'requested_total', v_total,
      'adjustment_amount', v_adjustment);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_rental_application(p_token text, p_application jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_process public.rental_processes%rowtype;
    v_app jsonb := coalesce(p_application, '{}'::jsonb);
    v_first text;
    v_last text;
    v_email text;
    v_has_co boolean;
    v_income numeric;
    v_co_income numeric;
    v_count integer;
    v_id uuid;
begin
    if jsonb_typeof(v_app) <> 'object' then
        raise exception 'Ungültige Bewerbungsdaten.';
    end if;

    select * into v_process
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if not found then
        raise exception 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.';
    end if;

    v_first := left(nullif(btrim(v_app->>'first_name'), ''), 100);
    v_last := left(nullif(btrim(v_app->>'last_name'), ''), 100);
    v_email := lower(btrim(coalesce(v_app->>'email', '')));

    if v_first is null or v_last is null then
        raise exception 'Bitte geben Sie Vor- und Nachnamen an.';
    end if;
    if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
    end if;

    select count(*) into v_count
    from public.rental_applicants
    where process_id = v_process.id
      and created_at > now() - interval '10 minutes';
    if v_count >= 30 then
        raise exception 'Zu viele Bewerbungen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut.';
    end if;

    select count(*) into v_count
    from public.rental_applicants
    where process_id = v_process.id
      and lower(email) = v_email
      and created_at > now() - interval '24 hours';
    if v_count >= 3 then
        raise exception 'Zu viele Bewerbungen in kurzer Zeit. Bitte versuchen Sie es später erneut.';
    end if;

    v_has_co := coalesce((v_app->>'has_co_applicant')::boolean, false);
    v_income := nullif(btrim(v_app->>'monthly_income'), '')::numeric;
    v_co_income := nullif(btrim(v_app->>'co_monthly_income'), '')::numeric;

    insert into public.rental_applicants (
        process_id, user_id, status,
        earliest_move_in, salutation, first_name, last_name, birth_date, marital_status,
        phone, email, introduction,
        has_co_applicant, co_salutation, co_first_name, co_last_name, co_birth_date,
        co_relationship, co_email, co_phone,
        additional_persons_count, is_employed, monthly_income, co_is_employed, co_monthly_income,
        street, house_number, postal_code, city,
        has_rent_arrears, has_eviction_lawsuits, has_insolvency_proceedings,
        receives_social_benefits, has_pets
    ) values (
        v_process.id, v_process.user_id, 'applied',
        nullif(btrim(v_app->>'earliest_move_in'), '')::date,
        left(nullif(btrim(v_app->>'salutation'), ''), 30),
        v_first,
        v_last,
        nullif(btrim(v_app->>'birth_date'), '')::date,
        left(nullif(btrim(v_app->>'marital_status'), ''), 30),
        left(nullif(btrim(v_app->>'phone'), ''), 50),
        v_email,
        left(nullif(btrim(v_app->>'introduction'), ''), 4000),
        v_has_co,
        case when v_has_co then left(nullif(btrim(v_app->>'co_salutation'), ''), 30) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_first_name'), ''), 100) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_last_name'), ''), 100) end,
        case when v_has_co then nullif(btrim(v_app->>'co_birth_date'), '')::date end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_relationship'), ''), 100) end,
        case when v_has_co then left(lower(nullif(btrim(v_app->>'co_email'), '')), 254) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_phone'), ''), 50) end,
        least(greatest(coalesce(nullif(btrim(v_app->>'additional_persons_count'), '')::integer, 0), 0), 20),
        coalesce((v_app->>'is_employed')::boolean, false),
        case when v_income is null then null else least(greatest(v_income, 0), 99999999) end,
        case when v_has_co then coalesce((v_app->>'co_is_employed')::boolean, false) else false end,
        case when v_has_co and v_co_income is not null then least(greatest(v_co_income, 0), 99999999) end,
        left(nullif(btrim(v_app->>'street'), ''), 150),
        left(nullif(btrim(v_app->>'house_number'), ''), 20),
        left(nullif(btrim(v_app->>'postal_code'), ''), 10),
        left(nullif(btrim(v_app->>'city'), ''), 100),
        coalesce((v_app->>'has_rent_arrears')::boolean, false),
        coalesce((v_app->>'has_eviction_lawsuits')::boolean, false),
        coalesce((v_app->>'has_insolvency_proceedings')::boolean, false),
        coalesce((v_app->>'receives_social_benefits')::boolean, false),
        coalesce((v_app->>'has_pets')::boolean, false)
    )
    returning id into v_id;

    return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_all_rent_ledgers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_user_id uuid;
    v_email text;
    v_lease record;
    v_current_month date;
    v_shared uuid[];
    v_lease_ids uuid[];
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        return;
    end if;

    v_current_month := date_trunc('month', current_date)::date;
    v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Freigegebene Portfolios (angenommene Freigaben an die E-Mail des Aufrufers)
    v_shared := array(
        select distinct s.portfolio_id
          from public.portfolio_shares s
         where v_email <> ''
           and s.status = 'accepted'
           and lower(s.shared_with_email) = v_email);

    -- Eigene Verträge + Verträge freigegebener Portfolios mit Schreibrecht auf das Mietkonto
    v_lease_ids := array(
        select l.id
          from public.leases l
         where l.user_id = v_user_id
        union
        select l.id
          from public.leases l
          join public.units u on u.id = l.unit_id
          join public.properties pr on pr.id = u.property_id
         where cardinality(v_shared) > 0
           and pr.portfolio_id = any(v_shared)
           and l.user_id <> v_user_id
           and public.can_write_rent_ledger(l.id));

    if cardinality(v_lease_ids) = 0 then
        return;
    end if;

    update public.leases
       set status = 'ended'
     where id = any(v_lease_ids)
       and status = 'active'
       and end_date is not null
       and end_date < current_date;

    for v_lease in
        select id
          from public.leases
         where id = any(v_lease_ids)
           and start_date <= current_date
           and (end_date is null or end_date >= v_current_month)
    loop
        perform public.sync_lease_rent_from_periods(v_lease.id);

        if not exists (
            select 1 from public.rent_ledger
             where lease_id = v_lease.id and period_month = v_current_month
        ) then
            perform public.recalculate_rent_ledger_entry(v_lease.id, v_current_month);
        end if;
    end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_contact_to_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_first text;
  v_last text;
  v_name text;
  v_tenant_first text;
  v_tenant_last text;
  v_street text;
  v_house text;
  v_matches text[];
  v_name_changed boolean;
  v_street_changed boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.contact_type is distinct from 'tenant' or new.tenant_id is null then
    return new;
  end if;

  select * into v_tenant from public.tenants t where t.id = new.tenant_id and t.user_id = new.user_id;
  if not found then
    return new;
  end if;

  v_name_changed := new.name is distinct from old.name;
  v_street_changed := new.street is distinct from old.street;

  if not (v_name_changed
          or v_street_changed
          or new.email is distinct from old.email
          or new.phone is distinct from old.phone
          or new.zip is distinct from old.zip
          or new.city is distinct from old.city) then
    return new;
  end if;

  v_first := v_tenant.first_name;
  v_last := v_tenant.last_name;
  if v_name_changed then
    v_name := btrim(coalesce(new.name, ''));
    v_tenant_first := btrim(coalesce(v_tenant.first_name, ''));
    v_tenant_last := btrim(coalesce(v_tenant.last_name, ''));

    if v_name = '' or v_name = btrim(v_tenant_first || ' ' || v_tenant_last) then
      null;
    elsif v_tenant_first = '' then
      v_last := v_name;
    elsif left(v_name, length(v_tenant_first) + 1) = v_tenant_first || ' ' then
      v_first := v_tenant_first;
      v_last := btrim(substr(v_name, length(v_tenant_first) + 2));
    elsif v_tenant_last <> '' and length(v_name) > length(v_tenant_last) + 1
          and right(v_name, length(v_tenant_last) + 1) = ' ' || v_tenant_last then
      v_last := v_tenant_last;
      v_first := btrim(left(v_name, length(v_name) - length(v_tenant_last) - 1));
    elsif position(' ' in v_name) > 0 then
      v_first := substr(v_name, 1, position(' ' in v_name) - 1);
      v_last := btrim(substr(v_name, position(' ' in v_name) + 1));
    else
      v_first := '';
      v_last := v_name;
    end if;
  end if;

  v_street := v_tenant.street;
  v_house := v_tenant.house_number;
  if v_street_changed then
    if coalesce(btrim(new.street), '') = '' then
      v_street := '';
      v_house := '';
    else
      v_matches := regexp_match(btrim(new.street),
                                '^(.*?\S)\s+(\d+\s?[A-Za-z]?(?:\s\d+/\d+)?(?:\s?[A-Za-z](?![A-Za-z]))?(?:\s?[-/]\s?\d*\s?[A-Za-z]?)*)$');
      if v_matches is not null then
        v_street := btrim(v_matches[1]);
        v_house := btrim(v_matches[2]);
      else
        v_street := btrim(new.street);
        v_house := '';
      end if;
    end if;
  end if;

  update public.tenants t
     set first_name   = v_first,
         last_name    = v_last,
         email        = case when new.email is distinct from old.email then new.email else t.email end,
         phone        = case when new.phone is distinct from old.phone then new.phone else t.phone end,
         street       = v_street,
         house_number = v_house,
         postal_code  = case when new.zip is distinct from old.zip then new.zip else t.postal_code end,
         city         = case when new.city is distinct from old.city then new.city else t.city end
   where t.id = v_tenant.id
     and t.user_id = new.user_id;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_lease_rent_from_periods(p_lease_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_period public.lease_rent_periods;
begin
    if p_lease_id is null then
        return;
    end if;

    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietverhältnis.' using errcode = '42501';
    end if;

    v_period := public.lease_rent_period_for_month(p_lease_id, current_date);
    if v_period.id is null then
        return;
    end if;

    perform set_config('app.rent_period_sync', 'on', true);

    update public.leases l
       set cold_rent       = v_period.cold_rent,
           service_charge  = v_period.service_charge,
           heating_cost    = v_period.heating_cost,
           other_costs     = v_period.other_costs,
           payment_due_day = v_period.payment_due_day
     where l.id = p_lease_id
       and (l.cold_rent, l.service_charge, l.heating_cost, l.other_costs, l.payment_due_day)
           is distinct from
           (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day);

    perform set_config('app.rent_period_sync', 'off', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_lease_to_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant_owner uuid;
  v_tenant_street text;
  v_portfolio_owner uuid;
  v_street text;
  v_zip text;
  v_city text;
  v_unit_name text;
begin
  if new.status is distinct from 'active' or new.tenant_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.unit_id is not distinct from old.unit_id
     and new.status is not distinct from old.status
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  select t.user_id, t.street into v_tenant_owner, v_tenant_street
    from public.tenants t where t.id = new.tenant_id;
  if not found then
    return new;
  end if;

  select btrim(coalesce(p.street, '') || ' ' || coalesce(p.house_number, '')),
         p.zip,
         p.city,
         u.unit_name,
         po.user_id
    into v_street, v_zip, v_city, v_unit_name, v_portfolio_owner
    from public.units u
    join public.properties p on p.id = u.property_id
    join public.portfolios po on po.id = p.portfolio_id
   where u.id = new.unit_id;

  if not found or v_portfolio_owner is distinct from v_tenant_owner then
    return new;
  end if;

  if coalesce(btrim(v_tenant_street), '') = '' then
    update public.contacts c
       set street = v_street,
           zip = v_zip,
           city = v_city,
           unit_name = v_unit_name
     where c.tenant_id = new.tenant_id
       and c.user_id = v_tenant_owner;
  else
    update public.contacts c
       set unit_name = v_unit_name
     where c.tenant_id = new.tenant_id
       and c.user_id = v_tenant_owner;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_tenant_to_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text;
  v_street text;
  v_zip text;
  v_city text;
  v_unit_name text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_name := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');

  if new.street is not null and new.street <> '' then
    v_street := btrim(coalesce(new.street, '') || ' ' || coalesce(new.house_number, ''));
    v_zip := new.postal_code;
    v_city := new.city;
  else
    select btrim(coalesce(p.street, '') || ' ' || coalesce(p.house_number, '')),
           p.zip,
           p.city,
           u.unit_name
      into v_street, v_zip, v_city, v_unit_name
      from public.leases l
      join public.units u on u.id = l.unit_id
      join public.properties p on p.id = u.property_id
      join public.portfolios po on po.id = p.portfolio_id
     where l.tenant_id = new.id
       and l.status = 'active'
       and po.user_id = new.user_id
     order by l.start_date desc
     limit 1;
  end if;

  if exists (select 1 from public.contacts c where c.tenant_id = new.id and c.user_id = new.user_id) then
    update public.contacts c
       set name      = coalesce(v_name, c.name),
           email     = new.email,
           phone     = new.phone,
           street    = coalesce(v_street, c.street),
           zip       = coalesce(v_zip, c.zip),
           city      = coalesce(v_city, c.city),
           unit_name = coalesce(v_unit_name, c.unit_name)
     where c.tenant_id = new.id
       and c.user_id = new.user_id;
  elsif v_name is not null then
    insert into public.contacts (user_id, name, contact_type, email, phone, street, zip, city, unit_name, tenant_id)
    values (new.user_id, v_name, 'tenant', new.email, new.phone, v_street, v_zip, v_city, v_unit_name, new.id);
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tenant_invitations_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_email_changed boolean;
begin
  new.email := lower(trim(new.email));
  if new.email is null or new.email = '' then
    raise exception 'Bitte geben Sie eine E-Mail-Adresse an.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    v_email_changed := true;
  else
    v_email_changed := new.email is distinct from lower(trim(old.email));
  end if;

  if auth.uid() is not null and v_email_changed
     and public.has_tenant_access(new.tenant_id, 'mietverhaeltnisse', 'write') then
    if exists (select 1 from auth.users u
               where u.id = auth.uid() and lower(trim(u.email)) = new.email) then
      raise exception 'Sie können sich nicht selbst als Mieter einladen.' using errcode = '42501';
    end if;
    if exists (select 1 from auth.users u
               join public.portfolios p on p.user_id = u.id
               where lower(trim(u.email)) = new.email) then
      raise exception 'Diese E-Mail-Adresse gehört zu einem bestehenden Vermieter-Konto und kann nicht als Mieter eingeladen werden.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tenant_link_token_hash(p_token text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_token is null or btrim(p_token) = '' then null
    else encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex')
  end
$function$
;
CREATE OR REPLACE FUNCTION public.tenant_verification_links_hash_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
  elsif auth.uid() is not null
        and new.created_by is not null
        and new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;

  if new.token is not null and new.token not like 'hashed:%' then
    new.token_hash := public.tenant_link_token_hash(new.token);
    new.token := 'hashed:' || new.id::text;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tenants_log_portal_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Der Mieterdaten-Link protokolliert selbst (update_tenant_by_token)
  if v_uid is null
     or coalesce(current_setting('immo.tenant_update_source', true), '') = 'token_link' then
    return null;
  end if;

  if (old.first_name, old.last_name, old.street, old.house_number, old.postal_code, old.city, old.phone, old.email)
     is not distinct from
     (new.first_name, new.last_name, new.street, new.house_number, new.postal_code, new.city, new.phone, new.email) then
    return null;
  end if;

  -- nur Selbständerungen des Mieters (Portal-Konto dieses Mieters)
  if not exists (select 1 from public.user_roles ur
                  where ur.user_id = v_uid
                    and ur.role = 'tenant'
                    and ur.tenant_id = new.id) then
    return null;
  end if;

  -- Konto mit Vermieter-/Team-Rechten auf diesen Mieter (z. B. Vermieter mit eigener Mieterrolle zum
  -- Testen): wie trg_tenants_protect_columns eine Vermieter-Änderung, keine Portal-Änderung
  if old.user_id = v_uid or public.has_tenant_access(old.id, 'mietverhaeltnisse', 'write') then
    return null;
  end if;

  insert into public.tenant_change_log (tenant_id, link_id, source, old_values, new_values)
  values (
    new.id,
    null,
    'tenant_portal',
    jsonb_build_object(
      'first_name', old.first_name, 'last_name', old.last_name,
      'street', old.street, 'house_number', old.house_number,
      'postal_code', old.postal_code, 'city', old.city,
      'phone', old.phone, 'email', old.email),
    jsonb_build_object(
      'first_name', new.first_name, 'last_name', new.last_name,
      'street', new.street, 'house_number', new.house_number,
      'postal_code', new.postal_code, 'city', new.city,
      'phone', new.phone, 'email', new.email)
  );
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tenants_protect_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_source text := coalesce(current_setting('immo.tenant_update_source', true), '');
  v_row public.tenants%rowtype;
begin
  if v_source = 'token_link' then
    v_row := old;
    v_row.first_name := new.first_name;
    v_row.last_name := new.last_name;
    v_row.street := new.street;
    v_row.house_number := new.house_number;
    v_row.postal_code := new.postal_code;
    v_row.city := new.city;
    v_row.phone := new.phone;
    v_row.email := new.email;
    return v_row;
  end if;

  if v_uid is null then
    return new;
  end if;

  if old.user_id = v_uid
     or public.has_tenant_access(old.id, 'mietverhaeltnisse', 'write')
     or (not exists (select 1 from public.leases l where l.tenant_id = old.id)
         and exists (select 1 from public.portfolios po
                     where po.user_id = old.user_id
                       and public.has_portfolio_access(po.id, 'mietverhaeltnisse', 'write'))) then
    return new;
  end if;

  v_row := old;
  if exists (select 1 from public.user_roles ur
             where ur.user_id = v_uid and ur.role = 'tenant' and ur.tenant_id = old.id) then
    v_row.first_name := new.first_name;
    v_row.last_name := new.last_name;
    v_row.phone := new.phone;
    v_row.street := new.street;
    v_row.house_number := new.house_number;
    v_row.postal_code := new.postal_code;
    v_row.city := new.city;
  end if;
  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_push_on_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM notify_push('announcements', to_jsonb(NEW));
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_push_on_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM notify_push('documents', to_jsonb(NEW));
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_push_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.receiver_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM NEW.receiver_id THEN
        PERFORM notify_push('messages', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_push_on_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.role = 'tenant' THEN
        PERFORM notify_push('user_roles', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_push_on_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM notify_push('tickets', to_jsonb(NEW));
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_document_templates_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_meter_last_reading()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_meter public.meters%rowtype;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_value numeric;
  v_date date;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select * into v_meter from public.meters m where m.id = new.meter_id;
    if found
       and v_uid is not null
       and v_meter.user_id is distinct from v_uid
       and not public.has_portfolio_access(v_meter.portfolio_id, 'zaehler', 'write') then
      raise exception 'Keine Berechtigung, für diesen Zähler einen Zählerstand zu erfassen.' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_ids := array_append(v_ids, old.meter_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.meter_id is distinct from old.meter_id) then
    v_ids := array_append(v_ids, new.meter_id);
  end if;

  foreach v_id in array v_ids loop
    v_value := null;
    v_date := null;
    select r.reading_value, r.reading_date
      into v_value, v_date
      from public.meter_readings r
     where r.meter_id = v_id
     order by r.reading_date desc, r.created_at desc nulls last, r.id desc
     limit 1;

    update public.meters m
       set last_reading_value = v_value,
           last_reading_date = v_date,
           updated_at = now()
     where m.id = v_id
       and (m.last_reading_value is distinct from v_value or m.last_reading_date is distinct from v_date);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_overdue_claims_status()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  claim_record record;
  current_user_id uuid;
  updated_count integer := 0;
  v_old_status text;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- skip locked: läuft dieselbe Prüfung parallel (z. B. Eigentümer und Mitnutzer), wird jede
  -- Forderung nur einmal umgestellt und protokolliert.
  for claim_record in
    select c.id, c.status, c.user_id
      from public.claims c
     where c.status in ('sent', 'open')
       and c.deadline < current_date
       and (c.user_id = current_user_id
            or public.has_claim_access(c.id, 'finanzen', 'write'))
       for update of c skip locked
  loop
    v_old_status := claim_record.status;
    update public.claims set status = 'action_required' where id = claim_record.id;

    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (
      claim_record.user_id,
      claim_record.id,
      'deadline_expired',
      'Die gesetzte Frist ist abgelaufen. Status wurde automatisch auf Aktion erforderlich gesetzt.',
      jsonb_build_object('old_status', v_old_status, 'new_status', 'action_required',
                         'triggered_by', current_user_id)
    );
    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_tenant_by_token(p_token text, p_first_name text, p_last_name text, p_street text, p_house_number text, p_postal_code text, p_city text, p_phone text, p_email text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hash text := public.tenant_link_token_hash(p_token);
  v_link public.tenant_verification_links%rowtype;
  v_old public.tenants%rowtype;
  v_new public.tenants%rowtype;
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_house text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_zip text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if v_hash is null then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  select * into v_link
  from public.tenant_verification_links
  where token_hash = v_hash and expires_at > now()
  limit 1
  for update;

  if not found then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  if v_link.is_updated then
    return json_build_object(
      'error', 'Dieser Link wurde bereits verwendet. Wenn Sie weitere Änderungen mitteilen möchten, wenden Sie sich bitte an Ihren Vermieter.',
      'used', true);
  end if;

  select * into v_old from public.tenants where id = v_link.tenant_id for update;
  if not found then
    return json_build_object('error', 'Mieter nicht gefunden.');
  end if;

  if coalesce(v_first, v_old.first_name) is null and coalesce(v_last, v_old.last_name) is null then
    return json_build_object('error', 'Bitte geben Sie Ihren Vor- und Nachnamen an.');
  end if;
  if length(coalesce(v_first, '')) > 100 or length(coalesce(v_last, '')) > 100
     or length(coalesce(v_street, '')) > 200 or length(coalesce(v_house, '')) > 20
     or length(coalesce(v_zip, '')) > 20 or length(coalesce(v_city, '')) > 100
     or length(coalesce(v_phone, '')) > 50 or length(coalesce(v_email, '')) > 254 then
    return json_build_object('error', 'Eine Eingabe ist zu lang. Bitte kürzen Sie die Angaben.');
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('error', 'Bitte geben Sie eine gültige E-Mail-Adresse an.');
  end if;

  perform set_config('immo.tenant_update_source', 'token_link', true);

  update public.tenants
     set first_name = coalesce(v_first, v_old.first_name, ''),
         last_name = coalesce(v_last, v_old.last_name, ''),
         street = v_street,
         house_number = v_house,
         postal_code = v_zip,
         city = v_city,
         phone = v_phone,
         email = coalesce(v_email, v_old.email)
   where id = v_old.id
  returning * into v_new;

  perform set_config('immo.tenant_update_source', '', true);

  -- G17b-07/G19-10: alte und neue Werte sichern (der Vermieter sieht den Vergleich im Verlauf)
  insert into public.tenant_change_log (tenant_id, link_id, source, old_values, new_values)
  values (
    v_old.id,
    v_link.id,
    'token_link',
    jsonb_build_object(
      'first_name', v_old.first_name, 'last_name', v_old.last_name,
      'street', v_old.street, 'house_number', v_old.house_number,
      'postal_code', v_old.postal_code, 'city', v_old.city,
      'phone', v_old.phone, 'email', v_old.email),
    jsonb_build_object(
      'first_name', v_new.first_name, 'last_name', v_new.last_name,
      'street', v_new.street, 'house_number', v_new.house_number,
      'postal_code', v_new.postal_code, 'city', v_new.city,
      'phone', v_new.phone, 'email', v_new.email)
  );

  update public.tenant_verification_links
     set is_updated = true,
         updated_at = now()
   where id = v_link.id;

  return json_build_object('success', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.user_roles_mark_invitation_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.role = 'tenant' and new.tenant_id is not null then
    update public.tenant_invitations i
       set status = 'accepted'
      from auth.users u
     where u.id = new.user_id
       and i.tenant_id = new.tenant_id
       and i.status = 'pending'
       and lower(trim(i.email)) = lower(trim(u.email));
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.user_roles_protect_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null then
    new.id := old.id;
    new.user_id := old.user_id;
    new.role := old.role;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.user_smtp_settings_drop_secret()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Nur über den Namen löschen (nie über einen fremden Verweis)
  delete from vault.secrets s where s.name = 'smtp_pass:' || old.user_id::text;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.user_smtp_settings_secure_pass()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_secret_id uuid;
  v_new_pass text := nullif(new.smtp_pass, '');
  v_has_stored boolean := false;
begin
  -- Angemeldete Nutzer nur für die eigene Zeile (vor dem Vault-Zugriff; RLS prüft erst danach)
  if v_uid is not null and new.user_id is distinct from v_uid then
    raise exception 'Keine Berechtigung für diese E-Mail-Einstellungen.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Die Zuordnung der E-Mail-Einstellungen kann nicht geändert werden.' using errcode = '42501';
    end if;
    -- Der Vault-Verweis wird nur hier im Trigger gesetzt, nie vom Aufrufer
    new.smtp_pass_secret_id := old.smtp_pass_secret_id;
    v_has_stored := old.smtp_pass_secret_id is not null or nullif(old.smtp_pass, '') is not null;

    if v_new_pass is null and v_has_stored and (
         lower(btrim(coalesce(new.smtp_host, ''))) is distinct from lower(btrim(coalesce(old.smtp_host, '')))
         or btrim(coalesce(new.smtp_user, '')) is distinct from btrim(coalesce(old.smtp_user, ''))
       ) then
      raise exception 'Bei geändertem SMTP-Server oder Benutzernamen geben Sie bitte das Passwort erneut ein.'
        using errcode = '22023';
    end if;
  else
    new.smtp_pass_secret_id := null;
  end if;

  if v_new_pass is not null then
    v_name := 'smtp_pass:' || new.user_id::text;
    select s.id into v_secret_id from vault.secrets s where s.name = v_name;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(v_new_pass, v_name, 'SMTP-Passwort (user_smtp_settings)');
    else
      perform vault.update_secret(v_secret_id, v_new_pass);
    end if;
    new.smtp_pass_secret_id := v_secret_id;
  end if;

  new.smtp_pass := null;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.verify_payment_allocations_sum()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment_amount numeric;
  v_allocations_sum numeric;
  v_check_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'claim_payments' THEN
    IF TG_OP = 'DELETE' THEN
      v_check_id := OLD.id;
    ELSE
      v_check_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_check_id := OLD.claim_payment_id;
    ELSE
      v_check_id := NEW.claim_payment_id;
    END IF;
  END IF;

  SELECT amount INTO v_payment_amount FROM claim_payments WHERE id = v_check_id AND status = 'posted';

  IF v_payment_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_allocations_sum FROM claim_payment_allocations WHERE claim_payment_id = v_check_id;
    IF v_allocations_sum != v_payment_amount THEN
      RAISE EXCEPTION 'Sum of allocations (%) does not match claim_payment amount (%) for posted payment ID %.', v_allocations_sum, v_payment_amount, v_check_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$
;

-- -----------------------------------------------------------------------------
-- 6 · Sichten
-- -----------------------------------------------------------------------------
create view public.claim_item_totals_view with (security_invoker=true) as
 WITH posted_allocations AS (
         SELECT cpa.claim_item_id,
            sum(cpa.amount) AS paid_principal,
            sum(cpa.amount) FILTER (WHERE cp.allocation_type = 'waiver'::text) AS waived_principal
           FROM public.claim_payment_allocations cpa
             JOIN public.claim_payments cp ON cp.id = cpa.claim_payment_id
          WHERE cp.status = 'posted'::text AND cpa.allocation_bucket = 'principal'::text
          GROUP BY cpa.claim_item_id
        )
 SELECT ci.id AS claim_item_id,
    ci.claim_id,
    ci.user_id,
    ci.original_amount,
    COALESCE(pa.paid_principal, 0::numeric) AS paid_principal,
    GREATEST(0::numeric, ci.original_amount - COALESCE(pa.paid_principal, 0::numeric)) AS open_amount,
    COALESCE(pa.waived_principal, 0::numeric) AS waived_principal
   FROM public.claim_items ci
     LEFT JOIN posted_allocations pa ON pa.claim_item_id = ci.id;
create view public.claim_totals_view with (security_invoker=true) as
 WITH allocation_sums AS (
         SELECT cp.claim_id,
            sum(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'principal'::text) AS principal_paid,
            sum(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'fees'::text) AS fees_paid,
            sum(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'interest'::text) AS interest_paid,
            sum(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'principal'::text AND cp.allocation_type = 'waiver'::text) AS principal_waived
           FROM public.claim_payments cp
             JOIN public.claim_payment_allocations cpa ON cp.id = cpa.claim_payment_id
          WHERE cp.status = 'posted'::text
          GROUP BY cp.claim_id
        ), item_sums AS (
         SELECT claim_items.claim_id,
            sum(claim_items.original_amount) AS original_principal
           FROM public.claim_items
          GROUP BY claim_items.claim_id
        )
 SELECT c.id AS claim_id,
    c.user_id,
    COALESCE(i.original_principal, 0::numeric) AS current_principal_original,
    COALESCE(a.principal_paid, 0::numeric) AS principal_paid,
    GREATEST(0::numeric, COALESCE(i.original_principal, 0::numeric) - COALESCE(a.principal_paid, 0::numeric)) AS current_principal_open,
    c.accumulated_unpaid_fees,
    COALESCE(a.fees_paid, 0::numeric) AS fees_paid,
    GREATEST(0::numeric, c.accumulated_unpaid_fees - COALESCE(a.fees_paid, 0::numeric)) AS total_fees_open,
    c.accumulated_unpaid_interest,
    COALESCE(a.interest_paid, 0::numeric) AS interest_paid,
    li.live_interest AS live_interest_since_start,
    GREATEST(0::numeric, c.accumulated_unpaid_interest + li.live_interest) AS total_interest_open,
    GREATEST(0::numeric, COALESCE(i.original_principal, 0::numeric) - COALESCE(a.principal_paid, 0::numeric)) + GREATEST(0::numeric, c.accumulated_unpaid_fees - COALESCE(a.fees_paid, 0::numeric)) + GREATEST(0::numeric, c.accumulated_unpaid_interest + li.live_interest) AS total_due,
    COALESCE(a.principal_waived, 0::numeric) AS principal_waived
   FROM public.claims c
     LEFT JOIN item_sums i ON c.id = i.claim_id
     LEFT JOIN allocation_sums a ON c.id = a.claim_id
     CROSS JOIN LATERAL ( SELECT COALESCE(public.claim_live_interest(c.id, public.claim_today()), 0::numeric) AS live_interest) li;
create view public.tenant_auth_info with (security_invoker=true) as
 SELECT tenant_user_id,
    tenant_id,
    registered_email::character varying(255) AS registered_email,
    last_sign_in_at
   FROM public.get_tenant_auth_info() f(tenant_user_id, tenant_id, registered_email, last_sign_in_at);

-- -----------------------------------------------------------------------------
-- 7 · Indizes
-- -----------------------------------------------------------------------------
CREATE INDEX idx_announcements_property ON public.announcements USING btree (property_id);
CREATE INDEX idx_fk_announcements_created_by ON public.announcements USING btree (created_by);
CREATE INDEX idx_fk_bank_connections_user_id ON public.bank_connections USING btree (user_id);
CREATE INDEX idx_bank_matching_rules_user_id ON public.bank_matching_rules USING btree (user_id);
CREATE INDEX idx_fk_bank_matching_rules_property_id ON public.bank_matching_rules USING btree (property_id);
CREATE INDEX idx_fk_bank_matching_rules_unit_id ON public.bank_matching_rules USING btree (unit_id);
CREATE INDEX idx_bank_transactions_matched_target_id ON public.bank_transactions USING btree (matched_target_id) WHERE (matched_target_id IS NOT NULL);
CREATE INDEX idx_bank_transactions_status ON public.bank_transactions USING btree (status);
CREATE INDEX idx_bank_transactions_user_id ON public.bank_transactions USING btree (user_id);
CREATE INDEX idx_claim_access_links_claim_id ON public.claim_access_links USING btree (claim_id);
CREATE INDEX idx_claim_access_links_token ON public.claim_access_links USING btree (token_hash);
CREATE INDEX idx_fk_claim_access_links_created_by ON public.claim_access_links USING btree (created_by);
CREATE INDEX idx_claim_events_claim_id ON public.claim_events USING btree (claim_id);
CREATE INDEX idx_claim_events_date ON public.claim_events USING btree (event_date);
CREATE INDEX idx_claim_events_type ON public.claim_events USING btree (event_type);
CREATE INDEX idx_claim_events_user_id ON public.claim_events USING btree (user_id);
CREATE INDEX idx_fk_claim_events_document_id ON public.claim_events USING btree (document_id);
CREATE INDEX idx_claim_items_claim_id ON public.claim_items USING btree (claim_id);
CREATE INDEX idx_claim_items_rent_ledger_id ON public.claim_items USING btree (rent_ledger_id);
CREATE INDEX idx_claim_items_rent_ledger_ids_gin ON public.claim_items USING gin (rent_ledger_ids);
CREATE INDEX idx_claim_items_user_id ON public.claim_items USING btree (user_id);
CREATE INDEX idx_claim_allocations_claim_id ON public.claim_payment_allocations USING btree (claim_id);
CREATE INDEX idx_claim_allocations_item_id ON public.claim_payment_allocations USING btree (claim_item_id);
CREATE INDEX idx_claim_allocations_payment_id ON public.claim_payment_allocations USING btree (claim_payment_id);
CREATE INDEX idx_claim_allocations_user_id ON public.claim_payment_allocations USING btree (user_id);
CREATE INDEX idx_claim_payments_claim_id ON public.claim_payments USING btree (claim_id);
CREATE INDEX idx_claim_payments_rent_payment_id ON public.claim_payments USING btree (rent_payment_id);
CREATE INDEX idx_claim_payments_reversal_ref ON public.claim_payments USING btree (reversal_reference_id);
CREATE INDEX idx_claim_payments_status ON public.claim_payments USING btree (status);
CREATE INDEX idx_claim_payments_user_id ON public.claim_payments USING btree (user_id);
CREATE INDEX idx_claims_deadline ON public.claims USING btree (deadline);
CREATE INDEX idx_claims_lease_id ON public.claims USING btree (lease_id);
CREATE INDEX idx_claims_status ON public.claims USING btree (status);
CREATE INDEX idx_claims_tenant_id ON public.claims USING btree (tenant_id);
CREATE INDEX idx_claims_user_deadline ON public.claims USING btree (user_id, deadline);
CREATE INDEX idx_claims_user_id ON public.claims USING btree (user_id);
CREATE INDEX idx_claims_user_status ON public.claims USING btree (user_id, status);
CREATE INDEX idx_fk_claims_cancelled_by ON public.claims USING btree (cancelled_by);
CREATE UNIQUE INDEX cloud_connections_user_provider_email_key ON public.cloud_connections USING btree (user_id, provider, account_email);
CREATE INDEX idx_fk_cloud_connections_user_id ON public.cloud_connections USING btree (user_id);
CREATE INDEX contact_requests_client_hash_idx ON public.contact_requests USING btree (client_hash, created_at DESC) WHERE (client_hash IS NOT NULL);
CREATE INDEX contact_requests_created_at_idx ON public.contact_requests USING btree (created_at DESC);
CREATE INDEX contact_requests_email_idx ON public.contact_requests USING btree (email, created_at DESC);
CREATE INDEX idx_contacts_name ON public.contacts USING btree (name);
CREATE INDEX idx_contacts_user_id ON public.contacts USING btree (user_id);
CREATE INDEX idx_fk_contacts_tenant_id ON public.contacts USING btree (tenant_id);
CREATE INDEX idx_deals_portfolio ON public.deals USING btree (portfolio_id);
CREATE INDEX idx_deals_type ON public.deals USING btree (deal_type);
CREATE INDEX idx_deals_user ON public.deals USING btree (user_id);
CREATE UNIQUE INDEX distribution_keys_global_name_key ON public.distribution_keys USING btree (name) WHERE (user_id IS NULL);
CREATE UNIQUE INDEX distribution_keys_user_name_key ON public.distribution_keys USING btree (user_id, name) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_fk_distribution_keys_user_id ON public.distribution_keys USING btree (user_id);
CREATE INDEX idx_fk_document_templates_portfolio_id ON public.document_templates USING btree (portfolio_id);
CREATE INDEX idx_fk_document_templates_user_id ON public.document_templates USING btree (user_id);
CREATE UNIQUE INDEX unique_portfolio_type_template ON public.document_templates USING btree (portfolio_id, type) WHERE (portfolio_id IS NOT NULL);
CREATE UNIQUE INDEX unique_user_type_template ON public.document_templates USING btree (user_id, type) WHERE (portfolio_id IS NULL);
CREATE INDEX idx_documents_file_name ON public.documents USING btree (file_name);
CREATE INDEX idx_documents_user_id ON public.documents USING btree (user_id);
CREATE INDEX idx_fk_documents_property_id ON public.documents USING btree (property_id);
CREATE INDEX idx_fk_documents_tenant_id ON public.documents USING btree (tenant_id);
CREATE INDEX idx_fk_documents_unit_id ON public.documents USING btree (unit_id);
CREATE INDEX idx_fk_economic_units_user_id ON public.economic_units USING btree (user_id);
CREATE INDEX idx_expense_categories_user_id ON public.expense_categories USING btree (user_id);
CREATE INDEX idx_fk_expense_categories_distribution_key_id ON public.expense_categories USING btree (distribution_key_id);
CREATE INDEX idx_expenses_property_id ON public.expenses USING btree (property_id);
CREATE INDEX idx_expenses_unit_id ON public.expenses USING btree (unit_id);
CREATE INDEX idx_expenses_user_id ON public.expenses USING btree (user_id);
CREATE INDEX idx_fk_expenses_category_id ON public.expenses USING btree (category_id);
CREATE INDEX idx_fk_floor_plans_unit_id ON public.floor_plans USING btree (unit_id);
CREATE INDEX idx_floor_plans_property_id ON public.floor_plans USING btree (property_id);
CREATE INDEX idx_floor_plans_user_id ON public.floor_plans USING btree (user_id);
CREATE INDEX idx_fk_invoice_counters_user_id ON public.invoice_counters USING btree (user_id);
CREATE INDEX idx_fk_invoices_contact_id ON public.invoices USING btree (contact_id);
CREATE INDEX idx_fk_invoices_property_id ON public.invoices USING btree (property_id);
CREATE INDEX idx_fk_invoices_unit_id ON public.invoices USING btree (unit_id);
CREATE INDEX idx_invoices_portfolio_id ON public.invoices USING btree (portfolio_id);
CREATE INDEX idx_invoices_portfolio_unit ON public.invoices USING btree (portfolio_id, unit_id);
CREATE INDEX idx_invoices_user_id ON public.invoices USING btree (user_id);
CREATE UNIQUE INDEX invoices_portfolio_id_invoice_number_key ON public.invoices USING btree (portfolio_id, invoice_number);
CREATE INDEX idx_fk_lease_cloud_folders_cloud_connection_id ON public.lease_cloud_folders USING btree (cloud_connection_id);
CREATE INDEX idx_lease_cloud_folders_user_id ON public.lease_cloud_folders USING btree (user_id);
CREATE INDEX idx_fk_lease_notes_updated_by ON public.lease_notes USING btree (updated_by);
CREATE INDEX idx_fk_lease_rent_periods_created_by ON public.lease_rent_periods USING btree (created_by);
CREATE UNIQUE INDEX lease_rent_periods_lease_month_uidx ON public.lease_rent_periods USING btree (lease_id, date_trunc('month'::text, (valid_from)::timestamp without time zone));
CREATE INDEX lease_rent_periods_lease_valid_idx ON public.lease_rent_periods USING btree (lease_id, valid_from);
CREATE INDEX idx_fk_leases_tenant_id ON public.leases USING btree (tenant_id);
CREATE INDEX idx_leases_unit_id ON public.leases USING btree (unit_id);
CREATE INDEX idx_leases_user_id ON public.leases USING btree (user_id);
CREATE INDEX idx_fk_loans_economic_unit_id ON public.loans USING btree (economic_unit_id);
CREATE INDEX idx_loans_portfolio_id ON public.loans USING btree (portfolio_id);
CREATE INDEX idx_loans_property_id ON public.loans USING btree (property_id);
CREATE INDEX idx_loans_user_id ON public.loans USING btree (user_id);
CREATE INDEX idx_messages_created ON public.messages USING btree (created_at);
CREATE INDEX idx_messages_receiver ON public.messages USING btree (receiver_id);
CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_id);
CREATE INDEX idx_messages_ticket ON public.messages USING btree (ticket_id);
CREATE INDEX idx_fk_meter_readings_meter_id ON public.meter_readings USING btree (meter_id);
CREATE INDEX idx_fk_meter_readings_portfolio_id ON public.meter_readings USING btree (portfolio_id);
CREATE INDEX idx_fk_meter_readings_user_id ON public.meter_readings USING btree (user_id);
CREATE INDEX idx_fk_meters_portfolio_id ON public.meters USING btree (portfolio_id);
CREATE INDEX idx_fk_meters_property_id ON public.meters USING btree (property_id);
CREATE INDEX idx_fk_meters_unit_id ON public.meters USING btree (unit_id);
CREATE INDEX idx_fk_meters_user_id ON public.meters USING btree (user_id);
CREATE INDEX idx_fk_objektkalender_events_assigned_unit_id ON public.objektkalender_events USING btree (assigned_unit_id);
CREATE INDEX idx_fk_objektkalender_events_completed_by ON public.objektkalender_events USING btree (completed_by);
CREATE INDEX idx_fk_objektkalender_events_property_id ON public.objektkalender_events USING btree (property_id);
CREATE INDEX idx_ok_events_date ON public.objektkalender_events USING btree (event_date);
CREATE INDEX idx_ok_events_type ON public.objektkalender_events USING btree (event_type);
CREATE INDEX idx_ok_events_user_property ON public.objektkalender_events USING btree (user_id, property_id);
CREATE INDEX idx_fk_objektkalender_history_event_id ON public.objektkalender_history USING btree (event_id);
CREATE INDEX idx_fk_objektkalender_history_property_id ON public.objektkalender_history USING btree (property_id);
CREATE INDEX idx_ok_history_user_property ON public.objektkalender_history USING btree (user_id, property_id);
CREATE INDEX idx_ok_settings_user ON public.objektkalender_settings USING btree (user_id);
CREATE UNIQUE INDEX objektkalender_settings_property_id_key ON public.objektkalender_settings USING btree (property_id);
CREATE INDEX idx_payment_installments_due_date ON public.payment_plan_installments USING btree (due_date);
CREATE INDEX idx_payment_installments_plan_id ON public.payment_plan_installments USING btree (payment_plan_id);
CREATE INDEX idx_payment_installments_status ON public.payment_plan_installments USING btree (status);
CREATE INDEX idx_payment_installments_user_id ON public.payment_plan_installments USING btree (user_id);
CREATE INDEX idx_fk_payment_plan_requests_access_link_id ON public.payment_plan_requests USING btree (access_link_id);
CREATE INDEX idx_fk_payment_plan_requests_decided_by ON public.payment_plan_requests USING btree (decided_by);
CREATE INDEX idx_payment_plan_requests_claim_id ON public.payment_plan_requests USING btree (claim_id);
CREATE INDEX idx_fk_payment_plans_cancelled_by ON public.payment_plans USING btree (cancelled_by);
CREATE INDEX idx_payment_plans_claim_id ON public.payment_plans USING btree (claim_id);
CREATE INDEX idx_payment_plans_status ON public.payment_plans USING btree (status);
CREATE INDEX idx_payment_plans_user_id ON public.payment_plans USING btree (user_id);
CREATE INDEX idx_fk_pdf_templates_updated_by ON public.pdf_templates USING btree (updated_by);
CREATE INDEX idx_fk_pdf_templates_user_id ON public.pdf_templates USING btree (user_id);
CREATE INDEX idx_pdf_templates_portfolio ON public.pdf_templates USING btree (portfolio_id);
CREATE INDEX idx_fk_portfolio_cloud_links_cloud_connection_id ON public.portfolio_cloud_links USING btree (cloud_connection_id);
CREATE INDEX idx_fk_portfolio_cloud_links_portfolio_id ON public.portfolio_cloud_links USING btree (portfolio_id);
CREATE INDEX idx_fk_portfolio_shares_created_by ON public.portfolio_shares USING btree (created_by);
CREATE INDEX idx_portfolio_shares_email_status ON public.portfolio_shares USING btree (lower(shared_with_email), status);
CREATE INDEX idx_portfolios_user_id ON public.portfolios USING btree (user_id);
CREATE INDEX idx_properties_economic_unit_id ON public.properties USING btree (economic_unit_id);
CREATE INDEX idx_properties_portfolio_id ON public.properties USING btree (portfolio_id);
CREATE INDEX idx_properties_user_id ON public.properties USING btree (user_id);
CREATE UNIQUE INDEX push_subscriptions_fcm_token_key ON public.push_subscriptions USING btree (fcm_token);
CREATE INDEX idx_fk_renovation_calc_subtrades_user_id ON public.renovation_calc_subtrades USING btree (user_id);
CREATE INDEX idx_rcs_trade ON public.renovation_calc_subtrades USING btree (calc_trade_id);
CREATE INDEX idx_fk_renovation_calc_trades_user_id ON public.renovation_calc_trades USING btree (user_id);
CREATE INDEX idx_rct_calc ON public.renovation_calc_trades USING btree (calculation_id);
CREATE INDEX idx_fk_renovation_calculations_property_id ON public.renovation_calculations USING btree (property_id);
CREATE INDEX idx_fk_renovation_calculations_unit_id ON public.renovation_calculations USING btree (unit_id);
CREATE INDEX idx_rc_user ON public.renovation_calculations USING btree (user_id);
CREATE INDEX idx_fk_renovation_invoices_created_by ON public.renovation_invoices USING btree (created_by);
CREATE INDEX idx_fk_renovation_invoices_user_id ON public.renovation_invoices USING btree (user_id);
CREATE INDEX idx_ri_project ON public.renovation_invoices USING btree (project_id);
CREATE INDEX idx_ri_subtrade ON public.renovation_invoices USING btree (project_subtrade_id);
CREATE INDEX idx_fk_renovation_milestone_templates_user_id ON public.renovation_milestone_templates USING btree (user_id);
CREATE INDEX idx_fk_renovation_milestones_project_trade_id ON public.renovation_milestones USING btree (project_trade_id);
CREATE INDEX idx_fk_renovation_milestones_user_id ON public.renovation_milestones USING btree (user_id);
CREATE INDEX idx_fk_renovation_project_subtrades_project_id ON public.renovation_project_subtrades USING btree (project_id);
CREATE INDEX idx_fk_renovation_project_subtrades_responsible_contact_id ON public.renovation_project_subtrades USING btree (responsible_contact_id);
CREATE INDEX idx_fk_renovation_project_subtrades_user_id ON public.renovation_project_subtrades USING btree (user_id);
CREATE INDEX idx_rps_trade ON public.renovation_project_subtrades USING btree (project_trade_id);
CREATE INDEX idx_fk_renovation_project_trades_depends_on ON public.renovation_project_trades USING btree (depends_on);
CREATE INDEX idx_fk_renovation_project_trades_user_id ON public.renovation_project_trades USING btree (user_id);
CREATE INDEX idx_rpt_project ON public.renovation_project_trades USING btree (project_id);
CREATE INDEX idx_fk_renovation_projects_created_by ON public.renovation_projects USING btree (created_by);
CREATE INDEX idx_fk_renovation_projects_unit_id ON public.renovation_projects USING btree (unit_id);
CREATE INDEX idx_renovation_projects_property ON public.renovation_projects USING btree (property_id);
CREATE INDEX idx_renovation_projects_user ON public.renovation_projects USING btree (user_id);
CREATE INDEX idx_fk_renovation_subtrades_trade_id ON public.renovation_subtrades USING btree (trade_id);
CREATE INDEX idx_fk_renovation_subtrades_user_id ON public.renovation_subtrades USING btree (user_id);
CREATE INDEX idx_fk_renovation_tasks_created_by ON public.renovation_tasks USING btree (created_by);
CREATE INDEX idx_fk_renovation_tasks_project_trade_id ON public.renovation_tasks USING btree (project_trade_id);
CREATE INDEX idx_fk_renovation_tasks_property_id ON public.renovation_tasks USING btree (property_id);
CREATE INDEX idx_fk_renovation_tasks_user_id ON public.renovation_tasks USING btree (user_id);
CREATE INDEX idx_rt_project ON public.renovation_tasks USING btree (project_id);
CREATE INDEX idx_fk_renovation_trades_user_id ON public.renovation_trades USING btree (user_id);
CREATE INDEX idx_rent_charges_lease_id ON public.rent_charges USING btree (lease_id);
CREATE INDEX idx_rent_charges_user_id ON public.rent_charges USING btree (user_id);
CREATE INDEX idx_fk_rent_ledger_user_id ON public.rent_ledger USING btree (user_id);
CREATE INDEX idx_rent_ledger_lease_id ON public.rent_ledger USING btree (lease_id);
CREATE INDEX idx_rent_ledger_period_month ON public.rent_ledger USING btree (period_month);
CREATE INDEX idx_rent_ledger_status ON public.rent_ledger USING btree (status);
CREATE INDEX idx_rent_payments_claim_payment_id ON public.rent_payments USING btree (claim_payment_id) WHERE (claim_payment_id IS NOT NULL);
CREATE INDEX idx_rent_payments_lease_id ON public.rent_payments USING btree (lease_id);
CREATE INDEX idx_rent_payments_user_id ON public.rent_payments USING btree (user_id);
CREATE INDEX idx_fk_rental_applicants_process_id ON public.rental_applicants USING btree (process_id);
CREATE INDEX idx_fk_rental_applicants_user_id ON public.rental_applicants USING btree (user_id);
CREATE INDEX idx_fk_rental_processes_unit_id ON public.rental_processes USING btree (unit_id);
CREATE INDEX idx_fk_rental_processes_user_id ON public.rental_processes USING btree (user_id);
CREATE UNIQUE INDEX rental_processes_one_running_per_unit ON public.rental_processes USING btree (unit_id) WHERE (status = 'in_vermietung'::text);
CREATE INDEX idx_fk_rental_viewing_bookings_applicant_id ON public.rental_viewing_bookings USING btree (applicant_id);
CREATE INDEX idx_fk_rental_viewing_bookings_viewing_id ON public.rental_viewing_bookings USING btree (viewing_id);
CREATE UNIQUE INDEX unique_active_viewing_booking_slot ON public.rental_viewing_bookings USING btree (viewing_id, start_time) WHERE (status = 'booked'::text);
CREATE INDEX idx_fk_rental_viewings_process_id ON public.rental_viewings USING btree (process_id);
CREATE INDEX idx_fk_rental_viewings_user_id ON public.rental_viewings USING btree (user_id);
CREATE INDEX stripe_webhook_events_status_received_idx ON public.stripe_webhook_events USING btree (status, received_at DESC);
CREATE INDEX idx_tenant_change_log_link ON public.tenant_change_log USING btree (link_id);
CREATE INDEX idx_tenant_change_log_tenant ON public.tenant_change_log USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_fk_tenant_invitations_invited_by ON public.tenant_invitations USING btree (invited_by);
CREATE INDEX idx_fk_tenant_invitations_property_id ON public.tenant_invitations USING btree (property_id);
CREATE INDEX idx_fk_tenant_invitations_tenant_id ON public.tenant_invitations USING btree (tenant_id);
CREATE INDEX idx_fk_tenant_invitations_unit_id ON public.tenant_invitations USING btree (unit_id);
CREATE INDEX idx_tenant_invitations_email ON public.tenant_invitations USING btree (email);
CREATE INDEX idx_fk_tenant_verification_links_created_by ON public.tenant_verification_links USING btree (created_by);
CREATE INDEX idx_fk_tenant_verification_links_tenant_id ON public.tenant_verification_links USING btree (tenant_id);
CREATE UNIQUE INDEX tenant_verification_links_token_hash_key ON public.tenant_verification_links USING btree (token_hash) WHERE (token_hash IS NOT NULL);
CREATE INDEX idx_tenants_user_id ON public.tenants USING btree (user_id);
CREATE INDEX idx_tickets_property ON public.tickets USING btree (property_id);
CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);
CREATE INDEX idx_tickets_tenant ON public.tickets USING btree (tenant_user_id);
CREATE INDEX idx_tickets_unit ON public.tickets USING btree (unit_id);
CREATE INDEX idx_units_property_id ON public.units USING btree (property_id);
CREATE INDEX idx_units_user_id ON public.units USING btree (user_id);
CREATE INDEX idx_units_vacation ON public.units USING btree (is_vacation_rental);
CREATE INDEX idx_fk_user_roles_property_id ON public.user_roles USING btree (property_id);
CREATE INDEX idx_fk_user_roles_tenant_id ON public.user_roles USING btree (tenant_id);
CREATE INDEX idx_fk_user_roles_unit_id ON public.user_roles USING btree (unit_id);
CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role);
CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);
CREATE INDEX idx_fk_utility_settlements_economic_unit_id ON public.utility_settlements USING btree (economic_unit_id);
CREATE INDEX idx_fk_utility_settlements_property_id ON public.utility_settlements USING btree (property_id);
CREATE INDEX idx_fk_utility_settlements_user_id ON public.utility_settlements USING btree (user_id);

-- -----------------------------------------------------------------------------
-- 8 · Trigger
-- -----------------------------------------------------------------------------
CREATE TRIGGER push_on_announcement AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_announcement();
CREATE TRIGGER trigger_check_claim_event_document BEFORE INSERT OR UPDATE ON public.claim_events FOR EACH ROW EXECUTE FUNCTION public.check_claim_event_document_owner();
CREATE TRIGGER trigger_protect_claim_events BEFORE DELETE OR UPDATE ON public.claim_events FOR EACH ROW EXECUTE FUNCTION public.block_claim_events_modification();
CREATE TRIGGER handle_claim_items_updated_at BEFORE UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION public.set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_check_claim_item_rent_ledger BEFORE INSERT OR UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION public.check_claim_item_rent_ledger_owner();
CREATE TRIGGER trigger_check_duplicate_active_claim_item BEFORE INSERT OR UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION public.check_duplicate_active_claim_item();
CREATE TRIGGER trigger_protect_claim_item_created_at BEFORE INSERT OR UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION public.protect_claim_item_created_at();
CREATE TRIGGER trigger_protect_claim_item_original_amount BEFORE UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION public.protect_claim_item_original_amount();
CREATE CONSTRAINT TRIGGER check_payment_allocations_after_allocation AFTER INSERT OR DELETE OR UPDATE ON public.claim_payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_payment_allocations_sum();
CREATE TRIGGER trigger_block_posted_allocation_update BEFORE UPDATE ON public.claim_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.block_posted_allocation_update();
CREATE TRIGGER trigger_check_claim_allocation_integrity BEFORE INSERT OR UPDATE ON public.claim_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.check_claim_allocation_integrity();
CREATE TRIGGER trigger_protect_claim_allocations_delete BEFORE DELETE ON public.claim_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.protect_claim_payment_records();
CREATE CONSTRAINT TRIGGER check_payment_allocations_after_payment AFTER INSERT OR UPDATE ON public.claim_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_payment_allocations_sum();
CREATE TRIGGER trigger_block_posted_payment_update BEFORE UPDATE ON public.claim_payments FOR EACH ROW EXECUTE FUNCTION public.block_posted_payment_update();
CREATE TRIGGER trigger_check_claim_payment_rent_payment BEFORE INSERT OR UPDATE ON public.claim_payments FOR EACH ROW EXECUTE FUNCTION public.check_claim_payment_rent_payment_owner();
CREATE TRIGGER trigger_protect_claim_payments_delete BEFORE DELETE ON public.claim_payments FOR EACH ROW EXECUTE FUNCTION public.protect_claim_payment_records();
CREATE TRIGGER block_claims_delete BEFORE DELETE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();
CREATE TRIGGER handle_claims_updated_at BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_check_claim_reactivation BEFORE UPDATE OF status ON public.claims FOR EACH ROW EXECUTE FUNCTION public.check_claim_reactivation_duplicates();
CREATE TRIGGER cloud_connections_delete_secrets AFTER DELETE ON public.cloud_connections FOR EACH ROW EXECUTE FUNCTION public.cloud_connections_delete_secrets();
CREATE TRIGGER trg_sync_contact_to_tenant AFTER UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.sync_contact_to_tenant();
CREATE TRIGGER trigger_update_document_templates_updated_at BEFORE UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION public.update_document_templates_updated_at();
CREATE TRIGGER push_on_document AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_document();
CREATE TRIGGER keep_user_id_on_update BEFORE UPDATE ON public.economic_units FOR EACH ROW EXECUTE FUNCTION public.keep_user_id_on_update();
CREATE TRIGGER trigger_bank_tx_unmatch_on_delete AFTER DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.bank_transactions_unmatch_deleted_target();
CREATE TRIGGER trg_floor_plans_user_id_guard BEFORE UPDATE ON public.floor_plans FOR EACH ROW WHEN (((old.user_id IS DISTINCT FROM new.user_id) OR (old.property_id IS DISTINCT FROM new.property_id) OR (old.unit_id IS DISTINCT FROM new.unit_id))) EXECUTE FUNCTION public.floor_plans_user_id_guard();
CREATE TRIGGER trg_invoices_protect_issued BEFORE DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.protect_issued_invoice();
CREATE TRIGGER trg_lease_notes_set_meta BEFORE INSERT OR UPDATE ON public.lease_notes FOR EACH ROW EXECUTE FUNCTION public.lease_notes_set_meta();
CREATE TRIGGER trigger_lease_rent_periods_before_write BEFORE INSERT OR UPDATE ON public.lease_rent_periods FOR EACH ROW EXECUTE FUNCTION public.lease_rent_periods_before_write();
CREATE TRIGGER trigger_on_lease_rent_period_change AFTER INSERT OR DELETE OR UPDATE ON public.lease_rent_periods FOR EACH ROW EXECUTE FUNCTION public.on_lease_rent_period_change();
CREATE TRIGGER set_owner_user_id BEFORE INSERT OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
CREATE TRIGGER trg_leases_check_overlap BEFORE INSERT OR UPDATE OF unit_id, start_date, end_date, status ON public.leases FOR EACH ROW EXECUTE FUNCTION public.leases_check_overlap();
CREATE TRIGGER trg_leases_owner_sync AFTER INSERT OR UPDATE OF tenant_id, unit_id ON public.leases FOR EACH ROW EXECUTE FUNCTION public.leases_sync_tenant_owner();
CREATE TRIGGER trg_sync_lease_to_contact AFTER INSERT OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.sync_lease_to_contact();
CREATE TRIGGER trigger_lease_before_delete BEFORE DELETE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.lease_before_delete();
CREATE TRIGGER trigger_on_lease_change AFTER INSERT OR UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.on_lease_change();
CREATE TRIGGER push_on_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_message();
CREATE TRIGGER on_reading_change AFTER INSERT OR DELETE OR UPDATE OF meter_id, reading_value, reading_date ON public.meter_readings FOR EACH ROW EXECUTE FUNCTION public.update_meter_last_reading();
CREATE TRIGGER handle_payment_plan_installments_updated_at BEFORE UPDATE ON public.payment_plan_installments FOR EACH ROW EXECUTE FUNCTION public.set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_protect_payment_plan_installments BEFORE INSERT OR DELETE OR UPDATE ON public.payment_plan_installments FOR EACH ROW EXECUTE FUNCTION public.protect_claim_payment_records();
CREATE TRIGGER handle_payment_plans_updated_at BEFORE UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_protect_payment_plans BEFORE INSERT OR DELETE OR UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.protect_claim_payment_records();
CREATE TRIGGER portfolio_shares_guard BEFORE INSERT OR UPDATE ON public.portfolio_shares FOR EACH ROW EXECUTE FUNCTION public.portfolio_shares_guard();
CREATE TRIGGER keep_user_id_on_update BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.keep_user_id_on_update();
CREATE TRIGGER profiles_protect_stripe_connect BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_stripe_connect();
CREATE TRIGGER set_owner_user_id BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
CREATE TRIGGER trigger_push_subscriptions_release_token BEFORE INSERT OR UPDATE OF fcm_token, user_id ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_release_token();
CREATE TRIGGER trg_renovation_calc_subtrades_user_id_guard BEFORE UPDATE ON public.renovation_calc_subtrades FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER trg_renovation_calc_trades_user_id_guard BEFORE UPDATE ON public.renovation_calc_trades FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_calculations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_calculations_owner BEFORE UPDATE ON public.renovation_calculations FOR EACH ROW WHEN ((old.property_id IS DISTINCT FROM new.property_id)) EXECUTE FUNCTION public.renovation_calculations_owner_follows_property();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_invoices_created_by BEFORE INSERT OR UPDATE OF created_by ON public.renovation_invoices FOR EACH ROW EXECUTE FUNCTION public.renovation_set_created_by();
CREATE TRIGGER trg_renovation_invoices_user_id_guard BEFORE UPDATE ON public.renovation_invoices FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER keep_user_id_on_update BEFORE UPDATE ON public.renovation_milestone_templates FOR EACH ROW EXECUTE FUNCTION public.keep_user_id_on_update();
CREATE TRIGGER trg_renovation_milestones_user_id_guard BEFORE UPDATE ON public.renovation_milestones FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_project_subtrades FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_project_subtrades_user_id_guard BEFORE UPDATE ON public.renovation_project_subtrades FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_project_trades FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_project_trades_user_id_guard BEFORE UPDATE ON public.renovation_project_trades FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_projects_created_by BEFORE INSERT OR UPDATE OF created_by ON public.renovation_projects FOR EACH ROW EXECUTE FUNCTION public.renovation_set_created_by();
CREATE TRIGGER trg_renovation_projects_same_owner BEFORE UPDATE ON public.renovation_projects FOR EACH ROW WHEN ((old.property_id IS DISTINCT FROM new.property_id)) EXECUTE FUNCTION public.renovation_projects_same_owner_on_move();
CREATE TRIGGER keep_user_id_on_update BEFORE UPDATE ON public.renovation_subtrades FOR EACH ROW EXECUTE FUNCTION public.keep_user_id_on_update();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.renovation_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_renovation_tasks_created_by BEFORE INSERT OR UPDATE OF created_by ON public.renovation_tasks FOR EACH ROW EXECUTE FUNCTION public.renovation_set_created_by();
CREATE TRIGGER trg_renovation_tasks_user_id_guard BEFORE UPDATE ON public.renovation_tasks FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION public.renovation_user_id_guard();
CREATE TRIGGER keep_user_id_on_update BEFORE UPDATE ON public.renovation_trades FOR EACH ROW EXECUTE FUNCTION public.keep_user_id_on_update();
CREATE TRIGGER trigger_rent_ledger_block_claimed_delete BEFORE DELETE ON public.rent_ledger FOR EACH ROW EXECUTE FUNCTION public.rent_ledger_block_claimed_delete();
CREATE TRIGGER block_claim_rent_payments_modification BEFORE INSERT OR DELETE OR UPDATE ON public.rent_payments FOR EACH ROW EXECUTE FUNCTION public.protect_claim_rent_payments();
CREATE TRIGGER trigger_bank_tx_unmatch_on_delete AFTER DELETE ON public.rent_payments FOR EACH ROW EXECUTE FUNCTION public.bank_transactions_unmatch_deleted_target();
CREATE TRIGGER trigger_on_rent_payment_change AFTER INSERT OR DELETE OR UPDATE ON public.rent_payments FOR EACH ROW EXECUTE FUNCTION public.on_rent_payment_change();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rental_processes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER on_subscription_update BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_tenant_invitations_guard BEFORE INSERT OR UPDATE ON public.tenant_invitations FOR EACH ROW EXECUTE FUNCTION public.tenant_invitations_guard();
CREATE TRIGGER trg_tenant_verification_links_hash_token BEFORE INSERT OR UPDATE ON public.tenant_verification_links FOR EACH ROW EXECUTE FUNCTION public.tenant_verification_links_hash_token();
CREATE TRIGGER trg_sync_tenant_to_contact AFTER INSERT OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_to_contact();
CREATE TRIGGER trg_tenants_portal_change_log AFTER UPDATE ON public.tenants FOR EACH ROW WHEN (((old.first_name IS DISTINCT FROM new.first_name) OR (old.last_name IS DISTINCT FROM new.last_name) OR (old.street IS DISTINCT FROM new.street) OR (old.house_number IS DISTINCT FROM new.house_number) OR (old.postal_code IS DISTINCT FROM new.postal_code) OR (old.city IS DISTINCT FROM new.city) OR (old.phone IS DISTINCT FROM new.phone) OR (old.email IS DISTINCT FROM new.email))) EXECUTE FUNCTION public.tenants_log_portal_change();
CREATE TRIGGER trg_tenants_protect_columns BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenants_protect_columns();
CREATE TRIGGER push_on_ticket AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_ticket();
CREATE TRIGGER set_owner_user_id BEFORE INSERT OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
CREATE TRIGGER push_on_registration AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_registration();
CREATE TRIGGER trg_user_roles_mark_invitation_accepted AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.user_roles_mark_invitation_accepted();
CREATE TRIGGER trg_user_roles_protect_identity BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.user_roles_protect_identity();
CREATE TRIGGER trg_user_smtp_settings_drop_secret AFTER DELETE ON public.user_smtp_settings FOR EACH ROW EXECUTE FUNCTION public.user_smtp_settings_drop_secret();
CREATE TRIGGER trg_user_smtp_settings_secure_pass BEFORE INSERT OR UPDATE ON public.user_smtp_settings FOR EACH ROW EXECUTE FUNCTION public.user_smtp_settings_secure_pass();

-- -----------------------------------------------------------------------------
-- 9 · Zeilenschutz (RLS)
-- -----------------------------------------------------------------------------
alter table public.announcements enable row level security;
alter table public.bank_connections enable row level security;
alter table public.bank_matching_rules enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.claim_access_links enable row level security;
alter table public.claim_events enable row level security;
alter table public.claim_items enable row level security;
alter table public.claim_payment_allocations enable row level security;
alter table public.claim_payments enable row level security;
alter table public.claims enable row level security;
alter table public.cloud_connections enable row level security;
alter table public.contact_requests enable row level security;
alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.distribution_keys enable row level security;
alter table public.document_templates enable row level security;
alter table public.documents enable row level security;
alter table public.economic_units enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.floor_plans enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.lease_cloud_folders enable row level security;
alter table public.lease_notes enable row level security;
alter table public.lease_rent_periods enable row level security;
alter table public.leases enable row level security;
alter table public.loans enable row level security;
alter table public.messages enable row level security;
alter table public.meter_readings enable row level security;
alter table public.meters enable row level security;
alter table public.objektkalender_events enable row level security;
alter table public.objektkalender_history enable row level security;
alter table public.objektkalender_settings enable row level security;
alter table public.payment_plan_installments enable row level security;
alter table public.payment_plan_requests enable row level security;
alter table public.payment_plans enable row level security;
alter table public.pdf_templates enable row level security;
alter table public.portfolio_cloud_links enable row level security;
alter table public.portfolio_shares enable row level security;
alter table public.portfolios enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.renovation_calc_subtrades enable row level security;
alter table public.renovation_calc_trades enable row level security;
alter table public.renovation_calculations enable row level security;
alter table public.renovation_invoices enable row level security;
alter table public.renovation_milestone_templates enable row level security;
alter table public.renovation_milestones enable row level security;
alter table public.renovation_project_subtrades enable row level security;
alter table public.renovation_project_trades enable row level security;
alter table public.renovation_projects enable row level security;
alter table public.renovation_subtrades enable row level security;
alter table public.renovation_tasks enable row level security;
alter table public.renovation_trades enable row level security;
alter table public.rent_charges enable row level security;
alter table public.rent_ledger enable row level security;
alter table public.rent_payments enable row level security;
alter table public.rental_applicants enable row level security;
alter table public.rental_processes enable row level security;
alter table public.rental_viewing_bookings enable row level security;
alter table public.rental_viewings enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenant_change_log enable row level security;
alter table public.tenant_invitations enable row level security;
alter table public.tenant_verification_links enable row level security;
alter table public.tenants enable row level security;
alter table public.tickets enable row level security;
alter table public.units enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_smtp_settings enable row level security;
alter table public.utility_settlements enable row level security;

-- -----------------------------------------------------------------------------
-- 10 · Policies
-- -----------------------------------------------------------------------------
create policy announcements_delete on public.announcements as permissive for delete to authenticated
    using (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text));
create policy announcements_insert on public.announcements as permissive for insert to authenticated
    with check ((public.has_property_access(property_id, 'mieterportal'::text, 'write'::text) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));
create policy announcements_select on public.announcements as permissive for select to authenticated
    using (public.has_property_access(property_id, 'mieterportal'::text, 'read'::text));
create policy announcements_update on public.announcements as permissive for update to authenticated
    using (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text))
    with check (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text));
create policy tenants_read_announcements on public.announcements as permissive for select to authenticated
    using ((property_id IN ( SELECT ur.property_id
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text)))));
create policy bank_connections_delete on public.bank_connections as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_connections_insert on public.bank_connections as permissive for insert to authenticated
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_connections_select on public.bank_connections as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_connections_update on public.bank_connections as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_matching_rules_delete on public.bank_matching_rules as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_matching_rules_insert on public.bank_matching_rules as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text))));
create policy bank_matching_rules_select on public.bank_matching_rules as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_matching_rules_update on public.bank_matching_rules as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text))));
create policy bank_transactions_delete on public.bank_transactions as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_transactions_insert on public.bank_transactions as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.bank_connections c
  WHERE ((c.id = bank_transactions.connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
create policy bank_transactions_select on public.bank_transactions as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy bank_transactions_update on public.bank_transactions as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.bank_connections c
  WHERE ((c.id = bank_transactions.connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
create policy claim_access_links_delete on public.claim_access_links as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_access_links_insert on public.claim_access_links as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));
create policy claim_access_links_select on public.claim_access_links as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy claim_access_links_update on public.claim_access_links as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_events_delete on public.claim_events as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_events_insert on public.claim_events as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'claim'::text, claim_id)));
create policy claim_events_select on public.claim_events as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy claim_events_update on public.claim_events as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_items_delete on public.claim_items as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_items_insert on public.claim_items as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'claim'::text, claim_id)));
create policy claim_items_select on public.claim_items as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy claim_items_update on public.claim_items as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_payment_allocations_delete on public.claim_payment_allocations as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_payment_allocations_insert on public.claim_payment_allocations as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'claim'::text, claim_id)));
create policy claim_payment_allocations_select on public.claim_payment_allocations as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy claim_payment_allocations_update on public.claim_payment_allocations as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_payments_delete on public.claim_payments as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claim_payments_insert on public.claim_payments as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'claim'::text, claim_id)));
create policy claim_payments_select on public.claim_payments as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy claim_payments_update on public.claim_payments as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy claims_insert on public.claims as permissive for insert to authenticated
    with check ((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'lease'::text, lease_id) AND public.rls_tenant_ok(tenant_id, 'lease'::text, lease_id)));
create policy claims_select on public.claims as permissive for select to authenticated
    using (public.has_lease_access(lease_id, 'finanzen'::text, 'read'::text));
create policy claims_update on public.claims as permissive for update to authenticated
    using (public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text))
    with check ((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) AND (public.rls_tenant_ok(tenant_id, 'lease'::text, lease_id) OR public.rls_tenant_link_unchanged('claims'::text, id, tenant_id))));
create policy cloud_connections_delete_own on public.cloud_connections as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy cloud_connections_select_own on public.cloud_connections as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy contacts_delete on public.contacts as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id IS NULL) AND public.rls_owner_shares(user_id, 'kontakte'::text, 'write'::text))));
create policy contacts_insert on public.contacts as permissive for insert to authenticated
    with check ((((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'kontakte'::text, 'write'::text)) AND public.rls_tenant_ok(tenant_id, 'user'::text, user_id)));
create policy contacts_select on public.contacts as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id IS NULL) AND public.rls_owner_shares(user_id, 'kontakte'::text, 'read'::text)) OR ((tenant_id IS NOT NULL) AND
CASE
    WHEN public.rls_tenant_ok(tenant_id, 'user'::text, user_id) THEN public.has_tenant_access(tenant_id, 'kontakte'::text, 'read'::text)
    ELSE public.rls_owner_shares(user_id, 'kontakte'::text, 'read'::text)
END) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE ((i.contact_id = contacts.id) AND public.has_portfolio_access(i.portfolio_id, 'finanzen'::text, 'read'::text)))) OR (EXISTS ( SELECT 1
   FROM public.renovation_project_subtrades s
  WHERE ((s.responsible_contact_id = contacts.id) AND (public.has_renovation_project_access(s.project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(s.project_id, 'investorportal'::text, 'read'::text)))))));
create policy contacts_update on public.contacts as permissive for update to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id IS NULL) AND public.rls_owner_shares(user_id, 'kontakte'::text, 'write'::text))))
    with check ((((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id IS NULL) AND public.rls_owner_shares(user_id, 'kontakte'::text, 'write'::text))) AND (public.rls_tenant_ok(tenant_id, 'user'::text, user_id) OR public.rls_tenant_link_unchanged('contacts'::text, id, tenant_id))));
create policy contacts_user_id_unchanged on public.contacts as restrictive for update to authenticated
    using (true)
    with check (public.rls_contact_user_id_unchanged(id, user_id));
create policy deals_delete on public.deals as permissive for delete to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)
END);
create policy deals_insert on public.deals as permissive for insert to authenticated
    with check (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE (public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id))
END);
create policy deals_select on public.deals as permissive for select to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'read'::text)
END);
create policy deals_update on public.deals as permissive for update to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)
END)
    with check (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)
END);
create policy distribution_keys_delete on public.distribution_keys as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy distribution_keys_insert on public.distribution_keys as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'nebenkosten'::text, 'write'::text)));
create policy distribution_keys_select on public.distribution_keys as permissive for select to authenticated
    using (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, '*'::text, 'read'::text)));
create policy distribution_keys_update on public.distribution_keys as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy document_templates_delete on public.document_templates as permissive for delete to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.rls_is_portfolio_owner(portfolio_id)
END);
create policy document_templates_insert on public.document_templates as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((portfolio_id IS NULL) OR public.rls_is_portfolio_owner(portfolio_id))));
create policy document_templates_select on public.document_templates as permissive for select to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.has_portfolio_access(portfolio_id, '*'::text, 'read'::text)
END);
create policy document_templates_update on public.document_templates as permissive for update to authenticated
    using (
CASE
    WHEN (portfolio_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE public.rls_is_portfolio_owner(portfolio_id)
END)
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((portfolio_id IS NULL) OR public.rls_is_portfolio_owner(portfolio_id))));
create policy documents_delete on public.documents as permissive for delete to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy documents_insert on public.documents as permissive for insert to authenticated
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id))
    WHEN (unit_id IS NOT NULL) THEN ((public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'unit'::text, unit_id))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text)) AND public.rls_tenant_ok(tenant_id,
CASE
    WHEN (property_id IS NOT NULL) THEN 'property'::text
    WHEN (unit_id IS NOT NULL) THEN 'unit'::text
    ELSE 'user'::text
END, COALESCE(property_id, unit_id, user_id))));
create policy documents_select on public.documents as permissive for select to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'read'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'read'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'read'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy documents_update on public.documents as permissive for update to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END)
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text)) AND (public.rls_tenant_ok(tenant_id,
CASE
    WHEN (property_id IS NOT NULL) THEN 'property'::text
    WHEN (unit_id IS NOT NULL) THEN 'unit'::text
    ELSE 'user'::text
END, COALESCE(property_id, unit_id, user_id)) OR public.rls_tenant_link_unchanged('documents'::text, id, tenant_id))));
create policy tenants_read_general_docs on public.documents as permissive for select to authenticated
    using (((tenant_id IS NULL) AND (property_id IN ( SELECT user_roles.property_id
   FROM public.user_roles
  WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'tenant'::text))))));
create policy tenants_read_personal_docs on public.documents as permissive for select to authenticated
    using ((tenant_id IN ( SELECT user_roles.tenant_id
   FROM public.user_roles
  WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'tenant'::text)))));
create policy economic_units_delete on public.economic_units as permissive for delete to authenticated
    using (public.has_economic_unit_access(id, 'immobilien'::text, 'write'::text));
create policy economic_units_insert on public.economic_units as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.portfolios po
  WHERE ((po.user_id = economic_units.user_id) AND public.has_portfolio_access(po.id, 'immobilien'::text, 'write'::text))))));
create policy economic_units_select on public.economic_units as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_economic_unit_access(id, '*'::text, 'read'::text) OR ((NOT public.economic_unit_is_linked(id)) AND (EXISTS ( SELECT 1
   FROM public.portfolios po
  WHERE ((po.user_id = economic_units.user_id) AND public.has_portfolio_access(po.id, 'immobilien'::text, 'write'::text)))))));
create policy economic_units_update on public.economic_units as permissive for update to authenticated
    using (public.has_economic_unit_access(id, 'immobilien'::text, 'write'::text))
    with check (public.has_economic_unit_access(id, 'immobilien'::text, 'write'::text));
create policy expense_categories_delete on public.expense_categories as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy expense_categories_insert on public.expense_categories as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'nebenkosten'::text, 'write'::text)));
create policy expense_categories_select on public.expense_categories as permissive for select to authenticated
    using (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, '*'::text, 'read'::text)));
create policy expense_categories_update on public.expense_categories as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy expenses_delete on public.expenses as permissive for delete to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'finanzen'::text, 'write'::text)
    WHEN (unit_id IS NOT NULL) THEN public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy expenses_insert on public.expenses as permissive for insert to authenticated
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'property'::text, property_id))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'unit'::text, unit_id))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text))));
create policy expenses_select on public.expenses as permissive for select to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'finanzen'::text, 'read'::text) OR public.has_property_access(property_id, 'nebenkosten'::text, 'read'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'finanzen'::text, 'read'::text) OR public.has_unit_access(unit_id, 'nebenkosten'::text, 'read'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy expenses_update on public.expenses as permissive for update to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'finanzen'::text, 'write'::text)
    WHEN (unit_id IS NOT NULL) THEN public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END)
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'finanzen'::text, 'write'::text)
    WHEN (unit_id IS NOT NULL) THEN public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text))));
create policy floor_plans_delete on public.floor_plans as permissive for delete to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy floor_plans_insert on public.floor_plans as permissive for insert to authenticated
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id))
    WHEN (unit_id IS NOT NULL) THEN ((public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'unit'::text, unit_id))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))));
create policy floor_plans_select on public.floor_plans as permissive for select to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'read'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'read'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'read'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy floor_plans_update on public.floor_plans as permissive for update to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END)
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text))
    WHEN (unit_id IS NOT NULL) THEN (public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))));
create policy invoice_counters_delete on public.invoice_counters as permissive for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text));
create policy invoice_counters_insert on public.invoice_counters as permissive for insert to authenticated
    with check ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) AND ((object_unit_id IS NULL) OR public.has_unit_access(object_unit_id, 'finanzen'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id)));
create policy invoice_counters_select on public.invoice_counters as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'read'::text));
create policy invoice_counters_update on public.invoice_counters as permissive for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text))
    with check ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) AND ((object_unit_id IS NULL) OR public.has_unit_access(object_unit_id, 'finanzen'::text, 'write'::text))));
create policy invoices_delete on public.invoices as permissive for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text));
create policy invoices_insert on public.invoices as permissive for insert to authenticated
    with check ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id)));
create policy invoices_select on public.invoices as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'read'::text));
create policy invoices_update on public.invoices as permissive for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text))
    with check ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'finanzen'::text, 'write'::text))));
create policy lease_cloud_folders_delete_own on public.lease_cloud_folders as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy lease_cloud_folders_insert_own on public.lease_cloud_folders as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.cloud_connections c
  WHERE ((c.id = lease_cloud_folders.cloud_connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'read'::text)));
create policy lease_cloud_folders_select_own on public.lease_cloud_folders as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy lease_cloud_folders_update_own on public.lease_cloud_folders as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.cloud_connections c
  WHERE ((c.id = lease_cloud_folders.cloud_connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'read'::text)));
create policy lease_notes_delete on public.lease_notes as permissive for delete to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy lease_notes_insert on public.lease_notes as permissive for insert to authenticated
    with check (public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy lease_notes_select on public.lease_notes as permissive for select to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'read'::text));
create policy lease_notes_update on public.lease_notes as permissive for update to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text))
    with check (public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy lease_rent_periods_delete on public.lease_rent_periods as permissive for delete to authenticated
    using ((public.can_write_lease_rent(lease_id) AND public.lease_rent_period_has_earlier(lease_id, valid_from)));
create policy lease_rent_periods_insert on public.lease_rent_periods as permissive for insert to authenticated
    with check (public.can_write_lease_rent(lease_id));
create policy lease_rent_periods_select on public.lease_rent_periods as permissive for select to authenticated
    using (public.can_read_lease_rent(lease_id));
create policy lease_rent_periods_update on public.lease_rent_periods as permissive for update to authenticated
    using (public.can_write_lease_rent(lease_id))
    with check (public.can_write_lease_rent(lease_id));
create policy leases_delete on public.leases as permissive for delete to authenticated
    using (public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy leases_insert on public.leases as permissive for insert to authenticated
    with check ((public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text) AND public.rls_user_ok(user_id, 'unit'::text, unit_id) AND public.rls_tenant_ok(tenant_id, 'unit'::text, unit_id)));
create policy leases_select on public.leases as permissive for select to authenticated
    using (public.has_unit_access(unit_id, '*'::text, 'read'::text));
create policy leases_update on public.leases as permissive for update to authenticated
    using (public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text))
    with check ((public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text) AND (public.rls_tenant_ok(tenant_id, 'unit'::text, unit_id) OR public.rls_tenant_link_unchanged('leases'::text, id, tenant_id))));
create policy tenants_read_own_leases on public.leases as permissive for select to authenticated
    using ((tenant_id IN ( SELECT user_roles.tenant_id
   FROM public.user_roles
  WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'tenant'::text)))));
create policy loans_delete on public.loans as permissive for delete to authenticated
    using ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) OR public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)));
create policy loans_insert on public.loans as permissive for insert to authenticated
    with check (((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) OR public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'finanzen'::text, 'write'::text) OR public.has_economic_unit_access(economic_unit_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id)));
create policy loans_select on public.loans as permissive for select to authenticated
    using ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'read'::text) OR public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'read'::text)));
create policy loans_update on public.loans as permissive for update to authenticated
    using ((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) OR public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)))
    with check (((public.has_portfolio_access(portfolio_id, 'finanzen'::text, 'write'::text) OR public.has_portfolio_access(portfolio_id, 'investorportal'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'finanzen'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'finanzen'::text, 'write'::text) OR public.has_economic_unit_access(economic_unit_id, 'investorportal'::text, 'write'::text))));
create policy messages_insert on public.messages as permissive for insert to authenticated
    with check (((sender_id = ( SELECT auth.uid() AS uid)) AND public.rls_message_allowed(receiver_id, ticket_id, is_system)));
create policy messages_select on public.messages as permissive for select to authenticated
    using (((sender_id = ( SELECT auth.uid() AS uid)) OR (receiver_id = ( SELECT auth.uid() AS uid)) OR ((ticket_id IS NOT NULL) AND public.rls_ticket_message_visible(ticket_id))));
create policy messages_update on public.messages as permissive for update to authenticated
    using ((receiver_id = ( SELECT auth.uid() AS uid)))
    with check ((receiver_id = ( SELECT auth.uid() AS uid)));
create policy meter_readings_delete on public.meter_readings as permissive for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text));
create policy meter_readings_insert on public.meter_readings as permissive for insert to authenticated
    with check ((public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text) AND (EXISTS ( SELECT 1
   FROM public.meters m
  WHERE ((m.id = meter_readings.meter_id) AND (m.portfolio_id = meter_readings.portfolio_id)))) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id)));
create policy meter_readings_select on public.meter_readings as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'read'::text));
create policy meter_readings_update on public.meter_readings as permissive for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text))
    with check ((public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text) AND (EXISTS ( SELECT 1
   FROM public.meters m
  WHERE ((m.id = meter_readings.meter_id) AND (m.portfolio_id = meter_readings.portfolio_id))))));
create policy meters_delete on public.meters as permissive for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text));
create policy meters_insert on public.meters as permissive for insert to authenticated
    with check ((public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text) AND public.has_property_access(property_id, 'zaehler'::text, 'write'::text) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'zaehler'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'portfolio'::text, portfolio_id)));
create policy meters_select on public.meters as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'read'::text));
create policy meters_update on public.meters as permissive for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text))
    with check ((public.has_portfolio_access(portfolio_id, 'zaehler'::text, 'write'::text) AND public.has_property_access(property_id, 'zaehler'::text, 'write'::text) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'zaehler'::text, 'write'::text))));
create policy objektkalender_events_delete on public.objektkalender_events as permissive for delete to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)));
create policy objektkalender_events_insert on public.objektkalender_events as permissive for insert to authenticated
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)) AND ((assigned_unit_id IS NULL) OR public.has_unit_access(assigned_unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(assigned_unit_id, 'mieterportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id)));
create policy objektkalender_events_select on public.objektkalender_events as permissive for select to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'read'::text)));
create policy objektkalender_events_update on public.objektkalender_events as permissive for update to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)))
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)) AND ((assigned_unit_id IS NULL) OR public.has_unit_access(assigned_unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(assigned_unit_id, 'mieterportal'::text, 'write'::text))));
create policy ok_tenants_read_events on public.objektkalender_events as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = objektkalender_events.property_id)))));
create policy ok_tenants_update_own_events on public.objektkalender_events as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = objektkalender_events.property_id) AND (ur.unit_id = objektkalender_events.assigned_unit_id)))))
    with check (((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = objektkalender_events.property_id) AND (ur.unit_id = objektkalender_events.assigned_unit_id)))) AND (status = ANY (ARRAY['pending'::text, 'done'::text])) AND ((completed_by IS NULL) OR (completed_by = ( SELECT auth.uid() AS uid))) AND public.rls_ok_event_core_unchanged(id, user_id, property_id, event_type, title, color, event_date, recurring, recurrence_rule, recurring_end_date, assigned_unit_id, assigned_unit_name, waste_type, push_enabled)));
create policy objektkalender_history_delete on public.objektkalender_history as permissive for delete to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)));
create policy objektkalender_history_insert on public.objektkalender_history as permissive for insert to authenticated
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id) AND ((event_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.objektkalender_events e
  WHERE ((e.id = objektkalender_history.event_id) AND (e.property_id = objektkalender_history.property_id)))))));
create policy objektkalender_history_select on public.objektkalender_history as permissive for select to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'read'::text)));
create policy objektkalender_history_update on public.objektkalender_history as permissive for update to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)))
    with check ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)));
create policy ok_tenants_insert_history on public.objektkalender_history as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((completed_by IS NULL) OR (completed_by = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.objektkalender_events e
     JOIN public.user_roles ur ON (((ur.property_id = e.property_id) AND (ur.unit_id = e.assigned_unit_id))))
  WHERE ((e.id = objektkalender_history.event_id) AND (e.property_id = objektkalender_history.property_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text))))));
create policy ok_tenants_read_history on public.objektkalender_history as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = objektkalender_history.property_id)))));
create policy objektkalender_settings_delete on public.objektkalender_settings as permissive for delete to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)));
create policy objektkalender_settings_insert on public.objektkalender_settings as permissive for insert to authenticated
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id)));
create policy objektkalender_settings_select on public.objektkalender_settings as permissive for select to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'read'::text)));
create policy objektkalender_settings_update on public.objektkalender_settings as permissive for update to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)))
    with check ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'mieterportal'::text, 'write'::text)));
create policy ok_tenants_read_settings on public.objektkalender_settings as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = objektkalender_settings.property_id)))));
create policy payment_plan_installments_delete on public.payment_plan_installments as permissive for delete to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.payment_plans pp
  WHERE ((pp.id = payment_plan_installments.payment_plan_id) AND public.has_claim_access(pp.claim_id, 'finanzen'::text, 'write'::text)))));
create policy payment_plan_installments_insert on public.payment_plan_installments as permissive for insert to authenticated
    with check ((EXISTS ( SELECT 1
   FROM public.payment_plans pp
  WHERE ((pp.id = payment_plan_installments.payment_plan_id) AND public.has_claim_access(pp.claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(payment_plan_installments.user_id, 'claim'::text, pp.claim_id)))));
create policy payment_plan_installments_select on public.payment_plan_installments as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.payment_plans pp
  WHERE ((pp.id = payment_plan_installments.payment_plan_id) AND public.has_claim_access(pp.claim_id, 'finanzen'::text, 'read'::text)))));
create policy payment_plan_installments_update on public.payment_plan_installments as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.payment_plans pp
  WHERE ((pp.id = payment_plan_installments.payment_plan_id) AND public.has_claim_access(pp.claim_id, 'finanzen'::text, 'write'::text)))))
    with check ((EXISTS ( SELECT 1
   FROM public.payment_plans pp
  WHERE ((pp.id = payment_plan_installments.payment_plan_id) AND public.has_claim_access(pp.claim_id, 'finanzen'::text, 'write'::text)))));
create policy payment_plan_requests_delete on public.payment_plan_requests as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy payment_plan_requests_insert on public.payment_plan_requests as permissive for insert to authenticated
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy payment_plan_requests_select on public.payment_plan_requests as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy payment_plan_requests_update on public.payment_plan_requests as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy payment_plans_delete on public.payment_plans as permissive for delete to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy payment_plans_insert on public.payment_plans as permissive for insert to authenticated
    with check ((public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text) AND public.rls_user_ok(user_id, 'claim'::text, claim_id)));
create policy payment_plans_select on public.payment_plans as permissive for select to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'read'::text));
create policy payment_plans_update on public.payment_plans as permissive for update to authenticated
    using (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text))
    with check (public.has_claim_access(claim_id, 'finanzen'::text, 'write'::text));
create policy pdf_templates_delete on public.pdf_templates as permissive for delete to authenticated
    using (public.rls_is_portfolio_owner(portfolio_id));
create policy pdf_templates_insert on public.pdf_templates as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND public.rls_is_portfolio_owner(portfolio_id)));
create policy pdf_templates_select on public.pdf_templates as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, '*'::text, 'read'::text));
create policy pdf_templates_update on public.pdf_templates as permissive for update to authenticated
    using (public.rls_is_portfolio_owner(portfolio_id))
    with check (public.rls_is_portfolio_owner(portfolio_id));
create policy portfolio_cloud_links_delete_own on public.portfolio_cloud_links as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy portfolio_cloud_links_insert_own on public.portfolio_cloud_links as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.cloud_connections c
  WHERE ((c.id = portfolio_cloud_links.cloud_connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'read'::text)));
create policy portfolio_cloud_links_select_own on public.portfolio_cloud_links as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy portfolio_cloud_links_update_own on public.portfolio_cloud_links as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.cloud_connections c
  WHERE ((c.id = portfolio_cloud_links.cloud_connection_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'read'::text)));
create policy portfolio_shares_delete on public.portfolio_shares as permissive for delete to authenticated
    using (((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_shares.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))) OR (lower(shared_with_email) = lower(COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text)))));
create policy portfolio_shares_insert on public.portfolio_shares as permissive for insert to authenticated
    with check (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_shares.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy portfolio_shares_select on public.portfolio_shares as permissive for select to authenticated
    using (((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_shares.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))) OR (lower(shared_with_email) = lower(COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text)))));
create policy portfolio_shares_update on public.portfolio_shares as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_shares.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))))
    with check ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_shares.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));
create policy portfolios_delete on public.portfolios as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(is_primary, false) = false)));
create policy portfolios_insert on public.portfolios as permissive for insert to authenticated
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy portfolios_select on public.portfolios as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_portfolio_access(id, '*'::text, 'read'::text)));
create policy portfolios_update on public.portfolios as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy profiles_insert on public.profiles as permissive for insert to authenticated
    with check ((id = ( SELECT auth.uid() AS uid)));
create policy profiles_select on public.profiles as permissive for select to authenticated
    using ((id = ( SELECT auth.uid() AS uid)));
create policy profiles_update on public.profiles as permissive for update to authenticated
    using ((id = ( SELECT auth.uid() AS uid)))
    with check ((id = ( SELECT auth.uid() AS uid)));
create policy properties_delete on public.properties as permissive for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'write'::text));
create policy properties_insert on public.properties as permissive for insert to authenticated
    with check ((public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'write'::text) AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'immobilien'::text, 'write'::text))));
create policy properties_select on public.properties as permissive for select to authenticated
    using (public.has_portfolio_access(portfolio_id, '*'::text, 'read'::text));
create policy properties_update on public.properties as permissive for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'write'::text))
    with check ((public.has_portfolio_access(portfolio_id, 'immobilien'::text, 'write'::text) AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'immobilien'::text, 'write'::text))));
create policy push_subscriptions_delete on public.push_subscriptions as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy push_subscriptions_insert on public.push_subscriptions as permissive for insert to authenticated
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy push_subscriptions_select on public.push_subscriptions as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy push_subscriptions_update on public.push_subscriptions as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy renovation_calc_subtrades_delete on public.renovation_calc_subtrades as permissive for delete to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_calc_trades t
  WHERE ((t.id = renovation_calc_subtrades.calc_trade_id) AND (public.has_renovation_calculation_access(t.calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(t.calculation_id, 'investorportal'::text, 'write'::text))))));
create policy renovation_calc_subtrades_insert on public.renovation_calc_subtrades as permissive for insert to authenticated
    with check ((EXISTS ( SELECT 1
   FROM public.renovation_calc_trades t
  WHERE ((t.id = renovation_calc_subtrades.calc_trade_id) AND (public.has_renovation_calculation_access(t.calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(t.calculation_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(renovation_calc_subtrades.user_id, 'renovation_calculation'::text, t.calculation_id)))));
create policy renovation_calc_subtrades_select on public.renovation_calc_subtrades as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_calc_trades t
  WHERE ((t.id = renovation_calc_subtrades.calc_trade_id) AND (public.has_renovation_calculation_access(t.calculation_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_calculation_access(t.calculation_id, 'investorportal'::text, 'read'::text))))));
create policy renovation_calc_subtrades_update on public.renovation_calc_subtrades as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_calc_trades t
  WHERE ((t.id = renovation_calc_subtrades.calc_trade_id) AND (public.has_renovation_calculation_access(t.calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(t.calculation_id, 'investorportal'::text, 'write'::text))))))
    with check ((EXISTS ( SELECT 1
   FROM public.renovation_calc_trades t
  WHERE ((t.id = renovation_calc_subtrades.calc_trade_id) AND (public.has_renovation_calculation_access(t.calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(t.calculation_id, 'investorportal'::text, 'write'::text))))));
create policy renovation_calc_trades_delete on public.renovation_calc_trades as permissive for delete to authenticated
    using ((public.has_renovation_calculation_access(calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(calculation_id, 'investorportal'::text, 'write'::text)));
create policy renovation_calc_trades_insert on public.renovation_calc_trades as permissive for insert to authenticated
    with check (((public.has_renovation_calculation_access(calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(calculation_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'renovation_calculation'::text, calculation_id)));
create policy renovation_calc_trades_select on public.renovation_calc_trades as permissive for select to authenticated
    using ((public.has_renovation_calculation_access(calculation_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_calculation_access(calculation_id, 'investorportal'::text, 'read'::text)));
create policy renovation_calc_trades_update on public.renovation_calc_trades as permissive for update to authenticated
    using ((public.has_renovation_calculation_access(calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(calculation_id, 'investorportal'::text, 'write'::text)))
    with check ((public.has_renovation_calculation_access(calculation_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_calculation_access(calculation_id, 'investorportal'::text, 'write'::text)));
create policy renovation_calculations_delete on public.renovation_calculations as permissive for delete to authenticated
    using (
CASE
    WHEN (property_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text))
END);
create policy renovation_calculations_insert on public.renovation_calculations as permissive for insert to authenticated
    with check ((
CASE
    WHEN (property_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))));
create policy renovation_calculations_select on public.renovation_calculations as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'read'::text)));
create policy renovation_calculations_update on public.renovation_calculations as permissive for update to authenticated
    using (
CASE
    WHEN (property_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE (public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text))
END)
    with check ((
CASE
    WHEN (property_id IS NULL) THEN (user_id = ( SELECT auth.uid() AS uid))
    ELSE ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND (public.rls_user_ok(user_id, 'property'::text, property_id) OR public.rls_user_ok(user_id, 'renovation_calculation'::text, id)))
END AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text))));
create policy renovation_invoices_delete on public.renovation_invoices as permissive for delete to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)));
create policy renovation_invoices_insert on public.renovation_invoices as permissive for insert to authenticated
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_project_subtrades s
  WHERE ((s.id = renovation_invoices.project_subtrade_id) AND (s.project_id = renovation_invoices.project_id)))) AND public.rls_user_ok(user_id, 'renovation_project'::text, project_id)));
create policy renovation_invoices_select on public.renovation_invoices as permissive for select to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'read'::text)));
create policy renovation_invoices_update on public.renovation_invoices as permissive for update to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)))
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_project_subtrades s
  WHERE ((s.id = renovation_invoices.project_subtrade_id) AND (s.project_id = renovation_invoices.project_id))))));
create policy renovation_milestone_templates_delete on public.renovation_milestone_templates as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_milestone_templates_insert on public.renovation_milestone_templates as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_milestone_templates_select on public.renovation_milestone_templates as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'read'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'read'::text)));
create policy renovation_milestone_templates_update on public.renovation_milestone_templates as permissive for update to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_milestones_delete on public.renovation_milestones as permissive for delete to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_milestones.project_trade_id) AND (public.has_renovation_project_access(t.project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(t.project_id, 'investorportal'::text, 'write'::text))))));
create policy renovation_milestones_insert on public.renovation_milestones as permissive for insert to authenticated
    with check ((EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_milestones.project_trade_id) AND (public.has_renovation_project_access(t.project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(t.project_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(renovation_milestones.user_id, 'renovation_project'::text, t.project_id)))));
create policy renovation_milestones_select on public.renovation_milestones as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_milestones.project_trade_id) AND (public.has_renovation_project_access(t.project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(t.project_id, 'investorportal'::text, 'read'::text))))));
create policy renovation_milestones_update on public.renovation_milestones as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_milestones.project_trade_id) AND (public.has_renovation_project_access(t.project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(t.project_id, 'investorportal'::text, 'write'::text))))))
    with check ((EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_milestones.project_trade_id) AND (public.has_renovation_project_access(t.project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(t.project_id, 'investorportal'::text, 'write'::text))))));
create policy renovation_project_subtrades_delete on public.renovation_project_subtrades as permissive for delete to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)));
create policy renovation_project_subtrades_insert on public.renovation_project_subtrades as permissive for insert to authenticated
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_project_subtrades.project_trade_id) AND (t.project_id = renovation_project_subtrades.project_id)))) AND public.rls_user_ok(user_id, 'renovation_project'::text, project_id)));
create policy renovation_project_subtrades_select on public.renovation_project_subtrades as permissive for select to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'read'::text)));
create policy renovation_project_subtrades_update on public.renovation_project_subtrades as permissive for update to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)))
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_project_subtrades.project_trade_id) AND (t.project_id = renovation_project_subtrades.project_id))))));
create policy renovation_project_trades_delete on public.renovation_project_trades as permissive for delete to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)));
create policy renovation_project_trades_insert on public.renovation_project_trades as permissive for insert to authenticated
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'renovation_project'::text, project_id)));
create policy renovation_project_trades_select on public.renovation_project_trades as permissive for select to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'read'::text)));
create policy renovation_project_trades_update on public.renovation_project_trades as permissive for update to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)))
    with check ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)));
create policy renovation_projects_delete on public.renovation_projects as permissive for delete to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)));
create policy renovation_projects_insert on public.renovation_projects as permissive for insert to authenticated
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'property'::text, property_id)));
create policy renovation_projects_select on public.renovation_projects as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_property_access(property_id, 'immobilien'::text, 'read'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'read'::text)));
create policy renovation_projects_update on public.renovation_projects as permissive for update to authenticated
    using ((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)))
    with check (((public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'immobilien'::text, 'write'::text) OR public.has_unit_access(unit_id, 'investorportal'::text, 'write'::text)) AND (public.rls_user_ok(user_id, 'property'::text, property_id) OR public.rls_user_ok(user_id, 'renovation_project'::text, id))));
create policy renovation_subtrades_delete on public.renovation_subtrades as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_subtrades_insert on public.renovation_subtrades as permissive for insert to authenticated
    with check ((((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_trades t
  WHERE ((t.id = renovation_subtrades.trade_id) AND (t.user_id = renovation_subtrades.user_id))))));
create policy renovation_subtrades_select on public.renovation_subtrades as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'read'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'read'::text)));
create policy renovation_subtrades_update on public.renovation_subtrades as permissive for update to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)))
    with check ((((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)) AND (EXISTS ( SELECT 1
   FROM public.renovation_trades t
  WHERE ((t.id = renovation_subtrades.trade_id) AND (t.user_id = renovation_subtrades.user_id))))));
create policy renovation_tasks_delete on public.renovation_tasks as permissive for delete to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)));
create policy renovation_tasks_insert on public.renovation_tasks as permissive for insert to authenticated
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((project_trade_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_tasks.project_trade_id) AND (t.project_id = renovation_tasks.project_id))))) AND public.rls_user_ok(user_id, 'renovation_project'::text, project_id)));
create policy renovation_tasks_select on public.renovation_tasks as permissive for select to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'read'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'read'::text)));
create policy renovation_tasks_update on public.renovation_tasks as permissive for update to authenticated
    using ((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)))
    with check (((public.has_renovation_project_access(project_id, 'immobilien'::text, 'write'::text) OR public.has_renovation_project_access(project_id, 'investorportal'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'immobilien'::text, 'write'::text) OR public.has_property_access(property_id, 'investorportal'::text, 'write'::text)) AND ((project_trade_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.renovation_project_trades t
  WHERE ((t.id = renovation_tasks.project_trade_id) AND (t.project_id = renovation_tasks.project_id)))))));
create policy renovation_trades_delete on public.renovation_trades as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_trades_insert on public.renovation_trades as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy renovation_trades_select on public.renovation_trades as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'read'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'read'::text)));
create policy renovation_trades_update on public.renovation_trades as permissive for update to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) OR public.rls_owner_shares(user_id, 'immobilien'::text, 'write'::text) OR public.rls_owner_shares(user_id, 'investorportal'::text, 'write'::text)));
create policy rent_charges_delete on public.rent_charges as permissive for delete to authenticated
    using (public.can_write_rent_ledger(lease_id));
create policy rent_charges_insert on public.rent_charges as permissive for insert to authenticated
    with check (public.can_write_rent_ledger(lease_id));
create policy rent_charges_select on public.rent_charges as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.can_read_rent_ledger(lease_id)));
create policy rent_charges_update on public.rent_charges as permissive for update to authenticated
    using (public.can_write_rent_ledger(lease_id))
    with check (public.can_write_rent_ledger(lease_id));
create policy rent_ledger_delete on public.rent_ledger as permissive for delete to authenticated
    using (public.can_write_rent_ledger(lease_id));
create policy rent_ledger_insert on public.rent_ledger as permissive for insert to authenticated
    with check (public.can_write_rent_ledger(lease_id));
create policy rent_ledger_select on public.rent_ledger as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) OR public.can_read_rent_ledger(lease_id)));
create policy rent_ledger_update on public.rent_ledger as permissive for update to authenticated
    using (public.can_write_rent_ledger(lease_id))
    with check (public.can_write_rent_ledger(lease_id));
create policy rent_payments_delete on public.rent_payments as permissive for delete to authenticated
    using ((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) OR public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy rent_payments_insert on public.rent_payments as permissive for insert to authenticated
    with check (((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) OR public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text)) AND public.rls_user_ok(user_id, 'lease'::text, lease_id)));
create policy rent_payments_select on public.rent_payments as permissive for select to authenticated
    using ((public.has_lease_access(lease_id, 'finanzen'::text, 'read'::text) OR public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'read'::text)));
create policy rent_payments_update on public.rent_payments as permissive for update to authenticated
    using ((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) OR public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text)))
    with check ((public.has_lease_access(lease_id, 'finanzen'::text, 'write'::text) OR public.has_lease_access(lease_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy rental_applicants_owner_delete on public.rental_applicants as permissive for delete to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_applicants.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy rental_applicants_owner_select on public.rental_applicants as permissive for select to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_applicants.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy rental_applicants_owner_update on public.rental_applicants as permissive for update to authenticated
    using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_applicants.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_applicants.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy rental_processes_owner_delete on public.rental_processes as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy rental_processes_owner_insert on public.rental_processes as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.units u
  WHERE ((u.id = rental_processes.unit_id) AND ((u.user_id = ( SELECT auth.uid() AS uid)) OR public.has_unit_access(u.id, 'mieterportal'::text, 'write'::text)))))));
create policy rental_processes_owner_select on public.rental_processes as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy rental_processes_owner_update on public.rental_processes as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.units u
  WHERE ((u.id = rental_processes.unit_id) AND ((u.user_id = ( SELECT auth.uid() AS uid)) OR public.has_unit_access(u.id, 'mieterportal'::text, 'write'::text)))))));
create policy rental_viewing_bookings_owner_delete on public.rental_viewing_bookings as permissive for delete to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.rental_viewings v
  WHERE ((v.id = rental_viewing_bookings.viewing_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))));
create policy rental_viewing_bookings_owner_select on public.rental_viewing_bookings as permissive for select to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.rental_viewings v
  WHERE ((v.id = rental_viewing_bookings.viewing_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))));
create policy rental_viewing_bookings_owner_update on public.rental_viewing_bookings as permissive for update to authenticated
    using ((EXISTS ( SELECT 1
   FROM public.rental_viewings v
  WHERE ((v.id = rental_viewing_bookings.viewing_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))))
    with check ((EXISTS ( SELECT 1
   FROM public.rental_viewings v
  WHERE ((v.id = rental_viewing_bookings.viewing_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))));
create policy rental_viewings_owner_delete on public.rental_viewings as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy rental_viewings_owner_insert on public.rental_viewings as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_viewings.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy rental_viewings_owner_select on public.rental_viewings as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy rental_viewings_owner_update on public.rental_viewings as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rental_processes p
  WHERE ((p.id = rental_viewings.process_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy subscriptions_select_own on public.subscriptions as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy tenant_change_log_select on public.tenant_change_log as permissive for select to authenticated
    using (public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'read'::text));
create policy tenant_invitations_delete_landlord on public.tenant_invitations as permissive for delete to authenticated
    using (((invited_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy tenant_invitations_insert_landlord on public.tenant_invitations as permissive for insert to authenticated
    with check (((invited_by = ( SELECT auth.uid() AS uid)) AND (tenant_id IS NOT NULL) AND public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'mietverhaeltnisse'::text, 'write'::text))));
create policy tenant_invitations_select_invitee on public.tenant_invitations as permissive for select to authenticated
    using (((COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text) <> ''::text) AND (lower(TRIM(BOTH FROM email)) = lower(TRIM(BOTH FROM (( SELECT auth.jwt() AS jwt) ->> 'email'::text))))));
create policy tenant_invitations_select_landlord on public.tenant_invitations as permissive for select to authenticated
    using (((invited_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'read'::text)));
create policy tenant_invitations_update_landlord on public.tenant_invitations as permissive for update to authenticated
    using (((invited_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)))
    with check (((tenant_id IS NOT NULL) AND public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'mietverhaeltnisse'::text, 'write'::text))));
create policy tenant_verification_links_delete on public.tenant_verification_links as permissive for delete to authenticated
    using (((created_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy tenant_verification_links_insert on public.tenant_verification_links as permissive for insert to authenticated
    with check (((created_by = ( SELECT auth.uid() AS uid)) AND public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy tenant_verification_links_select on public.tenant_verification_links as permissive for select to authenticated
    using (((created_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'read'::text)));
create policy tenant_verification_links_update on public.tenant_verification_links as permissive for update to authenticated
    using (((created_by = ( SELECT auth.uid() AS uid)) OR public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)))
    with check (public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy shared_tenant_delete on public.tenants as permissive for delete to authenticated
    using ((public.has_tenant_access(id, 'mietverhaeltnisse'::text, 'write'::text) OR public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy shared_tenant_insert on public.tenants as permissive for insert to authenticated
    with check (public.rls_owner_shares(user_id, 'mietverhaeltnisse'::text, 'write'::text));
create policy shared_tenant_select on public.tenants as permissive for select to authenticated
    using ((public.has_tenant_access(id, '*'::text, 'read'::text) OR public.rls_tenant_unleased_shared(id, user_id, '*'::text, 'read'::text)));
create policy shared_tenant_update on public.tenants as permissive for update to authenticated
    using ((public.has_tenant_access(id, 'mietverhaeltnisse'::text, 'write'::text) OR public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse'::text, 'write'::text)))
    with check ((public.has_tenant_access(id, 'mietverhaeltnisse'::text, 'write'::text) OR public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse'::text, 'write'::text)));
create policy tenant_user_id_unchanged on public.tenants as restrictive for update to authenticated
    using (true)
    with check (public.rls_tenant_user_id_unchanged(id, user_id));
create policy tenants_owner_all on public.tenants as permissive for all to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy tenants_read_own_tenant on public.tenants as permissive for select to authenticated
    using ((id IN ( SELECT ur.tenant_id
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text)))));
create policy tenants_update_own_tenant on public.tenants as permissive for update to authenticated
    using ((id IN ( SELECT ur.tenant_id
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text)))))
    with check ((id IN ( SELECT ur.tenant_id
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text)))));
create policy tickets_delete on public.tickets as permissive for delete to authenticated
    using (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text));
create policy tickets_insert on public.tickets as permissive for insert to authenticated
    with check ((((tenant_user_id = ( SELECT auth.uid() AS uid)) AND (status = 'received'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'tenant'::text) AND (ur.property_id = tickets.property_id) AND (ur.unit_id = tickets.unit_id))))) OR (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text) AND public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text) AND public.rls_is_unit_tenant(tenant_user_id, unit_id))));
create policy tickets_select on public.tickets as permissive for select to authenticated
    using (((tenant_user_id = ( SELECT auth.uid() AS uid)) OR public.has_property_access(property_id, 'mieterportal'::text, 'read'::text)));
create policy tickets_update on public.tickets as permissive for update to authenticated
    using (public.has_property_access(property_id, 'mieterportal'::text, 'write'::text))
    with check ((public.has_property_access(property_id, 'mieterportal'::text, 'write'::text) AND public.has_unit_access(unit_id, 'mieterportal'::text, 'write'::text)));
create policy units_delete on public.units as permissive for delete to authenticated
    using (public.has_property_access(property_id, 'immobilien'::text, 'write'::text));
create policy units_insert on public.units as permissive for insert to authenticated
    with check (public.has_property_access(property_id, 'immobilien'::text, 'write'::text));
create policy units_select on public.units as permissive for select to authenticated
    using (public.has_property_access(property_id, '*'::text, 'read'::text));
create policy units_update on public.units as permissive for update to authenticated
    using (public.has_property_access(property_id, 'immobilien'::text, 'write'::text))
    with check (public.has_property_access(property_id, 'immobilien'::text, 'write'::text));
create policy user_roles_delete_landlord on public.user_roles as permissive for delete to authenticated
    using (((role = 'tenant'::text) AND (public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text) OR ((property_id IS NOT NULL) AND public.has_property_access(property_id, 'mietverhaeltnisse'::text, 'write'::text)))));
create policy user_roles_insert_invited_tenant on public.user_roles as permissive for insert to authenticated
    with check (((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'tenant'::text) AND public.can_self_assign_tenant_role(tenant_id, unit_id, property_id)));
create policy user_roles_select_landlord on public.user_roles as permissive for select to authenticated
    using (((role = 'tenant'::text) AND (public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'read'::text) OR ((property_id IS NOT NULL) AND public.has_property_access(property_id, 'mietverhaeltnisse'::text, 'read'::text)))));
create policy user_roles_select_own on public.user_roles as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_roles_update_landlord on public.user_roles as permissive for update to authenticated
    using (((role = 'tenant'::text) AND public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text)))
    with check (((role = 'tenant'::text) AND public.has_tenant_access(tenant_id, 'mietverhaeltnisse'::text, 'write'::text) AND ((unit_id IS NULL) OR public.has_unit_access(unit_id, 'mietverhaeltnisse'::text, 'write'::text)) AND ((property_id IS NULL) OR public.has_property_access(property_id, 'mietverhaeltnisse'::text, 'write'::text))));
create policy user_smtp_settings_delete on public.user_smtp_settings as permissive for delete to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_smtp_settings_insert on public.user_smtp_settings as permissive for insert to authenticated
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_smtp_settings_select on public.user_smtp_settings as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_smtp_settings_update on public.user_smtp_settings as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy utility_settlements_delete on public.utility_settlements as permissive for delete to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'nebenkosten'::text, 'write'::text)
    WHEN (economic_unit_id IS NOT NULL) THEN public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy utility_settlements_insert on public.utility_settlements as permissive for insert to authenticated
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN (public.has_property_access(property_id, 'nebenkosten'::text, 'write'::text) AND public.rls_user_ok(user_id, 'property'::text, property_id))
    WHEN (economic_unit_id IS NOT NULL) THEN (public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text) AND public.rls_user_ok(user_id, 'economic_unit'::text, economic_unit_id))
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text))));
create policy utility_settlements_select on public.utility_settlements as permissive for select to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'nebenkosten'::text, 'read'::text)
    WHEN (economic_unit_id IS NOT NULL) THEN public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'read'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END);
create policy utility_settlements_update on public.utility_settlements as permissive for update to authenticated
    using (
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'nebenkosten'::text, 'write'::text)
    WHEN (economic_unit_id IS NOT NULL) THEN public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END)
    with check ((
CASE
    WHEN (property_id IS NOT NULL) THEN public.has_property_access(property_id, 'nebenkosten'::text, 'write'::text)
    WHEN (economic_unit_id IS NOT NULL) THEN public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text)
    ELSE (user_id = ( SELECT auth.uid() AS uid))
END AND ((economic_unit_id IS NULL) OR public.has_economic_unit_access(economic_unit_id, 'nebenkosten'::text, 'write'::text))));

-- -----------------------------------------------------------------------------
-- 11 · Rechte auf Tabellen und Sichten
-- -----------------------------------------------------------------------------
revoke all on table public.announcements from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.announcements to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.announcements to service_role;
revoke all on table public.bank_connections from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_connections to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_connections to service_role;
revoke all on table public.bank_matching_rules from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_matching_rules to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_matching_rules to service_role;
revoke all on table public.bank_transactions from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_transactions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bank_transactions to service_role;
revoke all on table public.claim_access_links from public, anon, authenticated, service_role;
grant delete on table public.claim_access_links to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_access_links to service_role;
revoke all on table public.claim_events from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_events to service_role;
revoke all on table public.claim_item_totals_view from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_item_totals_view to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_item_totals_view to service_role;
revoke all on table public.claim_items from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_items to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_items to service_role;
revoke all on table public.claim_payment_allocations from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_payment_allocations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_payment_allocations to service_role;
revoke all on table public.claim_payments from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_payments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_payments to service_role;
revoke all on table public.claim_totals_view from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_totals_view to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claim_totals_view to service_role;
revoke all on table public.claims from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claims to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.claims to service_role;
revoke all on table public.cloud_connections from public, anon, authenticated, service_role;
grant delete on table public.cloud_connections to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.cloud_connections to service_role;
revoke all on table public.contact_requests from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.contact_requests to service_role;
revoke all on table public.contacts from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.contacts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.contacts to service_role;
revoke all on table public.deals from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.deals to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.deals to service_role;
revoke all on table public.distribution_keys from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.distribution_keys to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.distribution_keys to service_role;
revoke all on table public.document_templates from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.document_templates to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.document_templates to service_role;
revoke all on table public.documents from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.documents to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.documents to service_role;
revoke all on table public.economic_units from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.economic_units to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.economic_units to service_role;
revoke all on table public.expense_categories from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expense_categories to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expense_categories to service_role;
revoke all on table public.expenses from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expenses to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expenses to service_role;
revoke all on table public.floor_plans from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.floor_plans to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.floor_plans to service_role;
revoke all on table public.invoice_counters from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_counters to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_counters to service_role;
revoke all on table public.invoices from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.invoices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoices to service_role;
revoke all on table public.lease_cloud_folders from public, anon, authenticated, service_role;
grant delete, insert, select, update on table public.lease_cloud_folders to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lease_cloud_folders to service_role;
revoke all on table public.lease_notes from public, anon, authenticated, service_role;
grant delete, insert, maintain, select, update on table public.lease_notes to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lease_notes to service_role;
revoke all on table public.lease_rent_periods from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lease_rent_periods to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lease_rent_periods to service_role;
revoke all on table public.leases from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.leases to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.leases to service_role;
revoke all on table public.loans from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.loans to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.loans to service_role;
revoke all on table public.messages from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate on table public.messages to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.messages to service_role;
revoke all on table public.meter_readings from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.meter_readings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.meter_readings to service_role;
revoke all on table public.meters from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.meters to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.meters to service_role;
revoke all on table public.objektkalender_events from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_events to service_role;
revoke all on table public.objektkalender_history from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_history to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_history to service_role;
revoke all on table public.objektkalender_settings from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_settings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objektkalender_settings to service_role;
revoke all on table public.payment_plan_installments from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plan_installments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plan_installments to service_role;
revoke all on table public.payment_plan_requests from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plan_requests to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plan_requests to service_role;
revoke all on table public.payment_plans from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plans to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_plans to service_role;
revoke all on table public.pdf_templates from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pdf_templates to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pdf_templates to service_role;
revoke all on table public.portfolio_cloud_links from public, anon, authenticated, service_role;
grant delete, insert, maintain, select, update on table public.portfolio_cloud_links to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.portfolio_cloud_links to service_role;
revoke all on table public.portfolio_shares from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.portfolio_shares to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.portfolio_shares to service_role;
revoke all on table public.portfolios from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.portfolios to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.portfolios to service_role;
revoke all on table public.profiles from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.profiles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.profiles to service_role;
revoke all on table public.properties from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.properties to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.properties to service_role;
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_subscriptions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_subscriptions to service_role;
revoke all on table public.renovation_calc_subtrades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calc_subtrades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calc_subtrades to service_role;
revoke all on table public.renovation_calc_trades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calc_trades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calc_trades to service_role;
revoke all on table public.renovation_calculations from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calculations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_calculations to service_role;
revoke all on table public.renovation_invoices from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_invoices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_invoices to service_role;
revoke all on table public.renovation_milestone_templates from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_milestone_templates to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_milestone_templates to service_role;
revoke all on table public.renovation_milestones from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_milestones to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_milestones to service_role;
revoke all on table public.renovation_project_subtrades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_project_subtrades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_project_subtrades to service_role;
revoke all on table public.renovation_project_trades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_project_trades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_project_trades to service_role;
revoke all on table public.renovation_projects from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_projects to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_projects to service_role;
revoke all on table public.renovation_subtrades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_subtrades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_subtrades to service_role;
revoke all on table public.renovation_tasks from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_tasks to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_tasks to service_role;
revoke all on table public.renovation_trades from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_trades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.renovation_trades to service_role;
revoke all on table public.rent_charges from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_charges to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_charges to service_role;
revoke all on table public.rent_ledger from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_ledger to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_ledger to service_role;
revoke all on table public.rent_payments from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_payments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rent_payments to service_role;
revoke all on table public.rental_applicants from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_applicants to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_applicants to service_role;
revoke all on table public.rental_processes from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_processes to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_processes to service_role;
revoke all on table public.rental_viewing_bookings from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_viewing_bookings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_viewing_bookings to service_role;
revoke all on table public.rental_viewings from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_viewings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.rental_viewings to service_role;
revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.stripe_webhook_events to service_role;
revoke all on table public.subscriptions from public, anon, authenticated, service_role;
grant select on table public.subscriptions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subscriptions to service_role;
revoke all on table public.tenant_auth_info from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_auth_info to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_auth_info to service_role;
revoke all on table public.tenant_change_log from public, anon, authenticated, service_role;
grant maintain, select on table public.tenant_change_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_change_log to service_role;
revoke all on table public.tenant_invitations from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_invitations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_invitations to service_role;
revoke all on table public.tenant_verification_links from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_verification_links to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_verification_links to service_role;
revoke all on table public.tenants from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants to service_role;
revoke all on table public.tickets from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tickets to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tickets to service_role;
revoke all on table public.units from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.units to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.units to service_role;
revoke all on table public.user_roles from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_roles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_roles to service_role;
revoke all on table public.user_smtp_settings from public, anon, authenticated, service_role;
grant delete on table public.user_smtp_settings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_smtp_settings to service_role;
revoke all on table public.utility_settlements from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.utility_settlements to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.utility_settlements to service_role;

-- -----------------------------------------------------------------------------
-- 12 · Spaltenrechte
-- -----------------------------------------------------------------------------
grant select (id) on table public.claim_access_links to authenticated;
grant select (claim_id) on table public.claim_access_links to authenticated;
grant select (expires_at) on table public.claim_access_links to authenticated;
grant select (revoked_at) on table public.claim_access_links to authenticated;
grant update (revoked_at) on table public.claim_access_links to authenticated;
grant select (last_used_at) on table public.claim_access_links to authenticated;
grant select (created_at) on table public.claim_access_links to authenticated;
grant select (created_by) on table public.claim_access_links to authenticated;
grant select (is_active) on table public.claim_access_links to authenticated;
grant update (is_active) on table public.claim_access_links to authenticated;
grant select (id) on table public.cloud_connections to authenticated;
grant select (user_id) on table public.cloud_connections to authenticated;
grant select (provider) on table public.cloud_connections to authenticated;
grant select (expires_at) on table public.cloud_connections to authenticated;
grant select (account_email) on table public.cloud_connections to authenticated;
grant select (created_at) on table public.cloud_connections to authenticated;
grant update (read) on table public.messages to authenticated;
grant select (id) on table public.user_smtp_settings to authenticated;
grant insert (user_id) on table public.user_smtp_settings to authenticated;
grant select (user_id) on table public.user_smtp_settings to authenticated;
grant insert (smtp_host) on table public.user_smtp_settings to authenticated;
grant select (smtp_host) on table public.user_smtp_settings to authenticated;
grant update (smtp_host) on table public.user_smtp_settings to authenticated;
grant insert (smtp_port) on table public.user_smtp_settings to authenticated;
grant select (smtp_port) on table public.user_smtp_settings to authenticated;
grant update (smtp_port) on table public.user_smtp_settings to authenticated;
grant insert (smtp_user) on table public.user_smtp_settings to authenticated;
grant select (smtp_user) on table public.user_smtp_settings to authenticated;
grant update (smtp_user) on table public.user_smtp_settings to authenticated;
grant insert (smtp_pass) on table public.user_smtp_settings to authenticated;
grant update (smtp_pass) on table public.user_smtp_settings to authenticated;
grant insert (smtp_sender) on table public.user_smtp_settings to authenticated;
grant select (smtp_sender) on table public.user_smtp_settings to authenticated;
grant update (smtp_sender) on table public.user_smtp_settings to authenticated;
grant select (created_at) on table public.user_smtp_settings to authenticated;
grant insert (updated_at) on table public.user_smtp_settings to authenticated;
grant select (updated_at) on table public.user_smtp_settings to authenticated;
grant update (updated_at) on table public.user_smtp_settings to authenticated;

-- -----------------------------------------------------------------------------
-- 13 · Rechte auf Funktionen
-- -----------------------------------------------------------------------------
revoke all on function public.accept_portfolio_share(uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_portfolio_share(uuid) to authenticated;
grant execute on function public.accept_portfolio_share(uuid) to service_role;
revoke all on function public.accept_tenant_invitation() from public, anon, authenticated, service_role;
grant execute on function public.accept_tenant_invitation() to authenticated;
grant execute on function public.accept_tenant_invitation() to service_role;
revoke all on function public.applicant_document_upload_allowed(text) from public, anon, authenticated, service_role;
grant execute on function public.applicant_document_upload_allowed(text) to anon;
grant execute on function public.applicant_document_upload_allowed(text) to authenticated;
grant execute on function public.applicant_document_upload_allowed(text) to service_role;
revoke all on function public.bank_transactions_unmatch_deleted_target() from public, anon, authenticated, service_role;
grant execute on function public.bank_transactions_unmatch_deleted_target() to service_role;
revoke all on function public.block_claim_events_modification() from public, anon, authenticated, service_role;
grant execute on function public.block_claim_events_modification() to service_role;
revoke all on function public.block_physical_delete() from public, anon, authenticated, service_role;
grant execute on function public.block_physical_delete() to service_role;
revoke all on function public.block_posted_allocation_update() from public, anon, authenticated, service_role;
grant execute on function public.block_posted_allocation_update() to service_role;
revoke all on function public.block_posted_payment_update() from public, anon, authenticated, service_role;
grant execute on function public.block_posted_payment_update() to service_role;
revoke all on function public.book_viewing(text,uuid,uuid,time without time zone) from public, anon, authenticated, service_role;
grant execute on function public.book_viewing(text,uuid,uuid,time without time zone) to anon;
grant execute on function public.book_viewing(text,uuid,uuid,time without time zone) to authenticated;
grant execute on function public.book_viewing(text,uuid,uuid,time without time zone) to service_role;
revoke all on function public.can_read_lease_rent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_read_lease_rent(uuid) to authenticated;
grant execute on function public.can_read_lease_rent(uuid) to service_role;
revoke all on function public.can_read_rent_ledger(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_read_rent_ledger(uuid) to authenticated;
grant execute on function public.can_read_rent_ledger(uuid) to service_role;
revoke all on function public.can_self_assign_tenant_role(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_self_assign_tenant_role(uuid,uuid,uuid) to authenticated;
grant execute on function public.can_self_assign_tenant_role(uuid,uuid,uuid) to service_role;
revoke all on function public.can_write_lease_rent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_write_lease_rent(uuid) to authenticated;
grant execute on function public.can_write_lease_rent(uuid) to service_role;
revoke all on function public.can_write_rent_ledger(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_write_rent_ledger(uuid) to authenticated;
grant execute on function public.can_write_rent_ledger(uuid) to service_role;
revoke all on function public.cancel_viewing_booking(text,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_viewing_booking(text,uuid,uuid) to anon;
grant execute on function public.cancel_viewing_booking(text,uuid,uuid) to authenticated;
grant execute on function public.cancel_viewing_booking(text,uuid,uuid) to service_role;
revoke all on function public.check_claim_allocation_integrity() from public, anon, authenticated, service_role;
grant execute on function public.check_claim_allocation_integrity() to service_role;
revoke all on function public.check_claim_event_document_owner() from public, anon, authenticated, service_role;
grant execute on function public.check_claim_event_document_owner() to service_role;
revoke all on function public.check_claim_item_rent_ledger_owner() from public, anon, authenticated, service_role;
grant execute on function public.check_claim_item_rent_ledger_owner() to service_role;
revoke all on function public.check_claim_payment_rent_payment_owner() from public, anon, authenticated, service_role;
grant execute on function public.check_claim_payment_rent_payment_owner() to service_role;
revoke all on function public.check_claim_reactivation_duplicates() from public, anon, authenticated, service_role;
grant execute on function public.check_claim_reactivation_duplicates() to service_role;
revoke all on function public.check_duplicate_active_claim_item() from public, anon, authenticated, service_role;
grant execute on function public.check_duplicate_active_claim_item() to service_role;
revoke all on function public.check_user_exists_by_email(text) from public, anon, authenticated, service_role;
grant execute on function public.check_user_exists_by_email(text) to authenticated;
grant execute on function public.check_user_exists_by_email(text) to service_role;
revoke all on function public.claim_format_eur(numeric) from public, anon, authenticated, service_role;
grant execute on function public.claim_format_eur(numeric) to authenticated;
grant execute on function public.claim_format_eur(numeric) to service_role;
revoke all on function public.claim_interest_amount(numeric,numeric,date,date) from public, anon, authenticated, service_role;
grant execute on function public.claim_interest_amount(numeric,numeric,date,date) to authenticated;
grant execute on function public.claim_interest_amount(numeric,numeric,date,date) to service_role;
revoke all on function public.claim_live_interest(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.claim_live_interest(uuid,date) to authenticated;
grant execute on function public.claim_live_interest(uuid,date) to service_role;
revoke all on function public.claim_portal_check_access(text,text) from public, anon, authenticated, service_role;
grant execute on function public.claim_portal_check_access(text,text) to service_role;
revoke all on function public.claim_portal_installment_options(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.claim_portal_installment_options(jsonb) to authenticated;
grant execute on function public.claim_portal_installment_options(jsonb) to service_role;
revoke all on function public.claim_portal_plan_request_block_reason(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_portal_plan_request_block_reason(uuid) to authenticated;
grant execute on function public.claim_portal_plan_request_block_reason(uuid) to service_role;
revoke all on function public.claim_today() from public, anon, authenticated, service_role;
grant execute on function public.claim_today() to authenticated;
grant execute on function public.claim_today() to service_role;
revoke all on function public.cloud_connections_delete_secrets() from public, anon, authenticated, service_role;
revoke all on function public.cloud_get_tokens(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.cloud_get_tokens(uuid,uuid) to service_role;
revoke all on function public.cloud_store_tokens(uuid,uuid,text,text,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.cloud_store_tokens(uuid,uuid,text,text,timestamp with time zone) to service_role;
revoke all on function public.cloud_tokens_keep_plaintext() from public, anon, authenticated, service_role;
revoke all on function public.cloud_vault_put(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.convert_rental_applicant_to_tenant(uuid,date,numeric,numeric,numeric,numeric,integer) from public, anon, authenticated, service_role;
grant execute on function public.convert_rental_applicant_to_tenant(uuid,date,numeric,numeric,numeric,numeric,integer) to authenticated;
grant execute on function public.convert_rental_applicant_to_tenant(uuid,date,numeric,numeric,numeric,numeric,integer) to service_role;
revoke all on function public.create_claim_advanced(uuid,uuid[],jsonb,numeric,numeric,numeric,date,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.create_claim_advanced(uuid,uuid[],jsonb,numeric,numeric,numeric,date,integer,text) to authenticated;
grant execute on function public.create_claim_advanced(uuid,uuid[],jsonb,numeric,numeric,numeric,date,integer,text) to service_role;
revoke all on function public.create_claim_portal_link(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.create_claim_portal_link(uuid,integer) to authenticated;
grant execute on function public.create_claim_portal_link(uuid,integer) to service_role;
revoke all on function public.create_credit_note(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_credit_note(uuid) to authenticated;
grant execute on function public.create_credit_note(uuid) to service_role;
revoke all on function public.create_payment_plan(uuid,date,integer,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.create_payment_plan(uuid,date,integer,numeric,text) to authenticated;
grant execute on function public.create_payment_plan(uuid,date,integer,numeric,text) to service_role;
revoke all on function public.decline_portfolio_share(uuid) from public, anon, authenticated, service_role;
grant execute on function public.decline_portfolio_share(uuid) to authenticated;
grant execute on function public.decline_portfolio_share(uuid) to service_role;
revoke all on function public.delete_claim_item(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_claim_item(uuid) to authenticated;
grant execute on function public.delete_claim_item(uuid) to service_role;
revoke all on function public.delete_portfolio(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.delete_portfolio(uuid,uuid,boolean) to authenticated;
grant execute on function public.delete_portfolio(uuid,uuid,boolean) to service_role;
revoke all on function public.delete_tenant_completely(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_tenant_completely(uuid) to authenticated;
grant execute on function public.delete_tenant_completely(uuid) to service_role;
revoke all on function public.economic_unit_is_linked(uuid) from public, anon, authenticated, service_role;
grant execute on function public.economic_unit_is_linked(uuid) to authenticated;
grant execute on function public.economic_unit_is_linked(uuid) to service_role;
revoke all on function public.floor_plan_can_write(uuid) from public, anon, authenticated, service_role;
grant execute on function public.floor_plan_can_write(uuid) to authenticated;
grant execute on function public.floor_plan_can_write(uuid) to service_role;
revoke all on function public.floor_plan_room_count(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.floor_plan_room_count(jsonb) to authenticated;
grant execute on function public.floor_plan_room_count(jsonb) to service_role;
revoke all on function public.floor_plan_storey_labels(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.floor_plan_storey_labels(jsonb) to authenticated;
grant execute on function public.floor_plan_storey_labels(jsonb) to service_role;
revoke all on function public.floor_plan_total_area_mm2(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.floor_plan_total_area_mm2(jsonb) to authenticated;
grant execute on function public.floor_plan_total_area_mm2(jsonb) to service_role;
revoke all on function public.floor_plans_user_id_guard() from public, anon, authenticated, service_role;
grant execute on function public.floor_plans_user_id_guard() to service_role;
revoke all on function public.generate_claim_access_link(uuid,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.generate_claim_access_link(uuid,text,text,integer) to authenticated;
grant execute on function public.generate_claim_access_link(uuid,text,text,integer) to service_role;
revoke all on function public.get_auth_user_id_by_email(text) from public, anon, authenticated, service_role;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;
revoke all on function public.get_investor_properties(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_investor_properties(uuid) to authenticated;
grant execute on function public.get_investor_properties(uuid) to service_role;
revoke all on function public.get_my_landlord_info(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_landlord_info(uuid) to authenticated;
grant execute on function public.get_my_landlord_info(uuid) to service_role;
revoke all on function public.get_my_role() from public, anon, authenticated, service_role;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.get_my_role() to service_role;
revoke all on function public.get_my_tenancy() from public, anon, authenticated, service_role;
grant execute on function public.get_my_tenancy() to authenticated;
grant execute on function public.get_my_tenancy() to service_role;
revoke all on function public.get_next_invoice_number(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_next_invoice_number(uuid,uuid,integer) to authenticated;
grant execute on function public.get_next_invoice_number(uuid,uuid,integer) to service_role;
revoke all on function public.get_pending_invitations() from public, anon, authenticated, service_role;
grant execute on function public.get_pending_invitations() to authenticated;
grant execute on function public.get_pending_invitations() to service_role;
revoke all on function public.get_public_claim_by_token(text,text) from public, anon, authenticated, service_role;
grant execute on function public.get_public_claim_by_token(text,text) to anon;
grant execute on function public.get_public_claim_by_token(text,text) to authenticated;
grant execute on function public.get_public_claim_by_token(text,text) to service_role;
revoke all on function public.get_rental_applicant_for_booking(text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_rental_applicant_for_booking(text,uuid) to anon;
grant execute on function public.get_rental_applicant_for_booking(text,uuid) to authenticated;
grant execute on function public.get_rental_applicant_for_booking(text,uuid) to service_role;
revoke all on function public.get_rental_process_by_token(text) from public, anon, authenticated, service_role;
grant execute on function public.get_rental_process_by_token(text) to anon;
grant execute on function public.get_rental_process_by_token(text) to authenticated;
grant execute on function public.get_rental_process_by_token(text) to service_role;
revoke all on function public.get_rental_viewing_schedule(text) from public, anon, authenticated, service_role;
grant execute on function public.get_rental_viewing_schedule(text) to anon;
grant execute on function public.get_rental_viewing_schedule(text) to authenticated;
grant execute on function public.get_rental_viewing_schedule(text) to service_role;
revoke all on function public.get_smtp_password(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_smtp_password(uuid) to service_role;
revoke all on function public.get_tenant_auth_info() from public, anon, authenticated, service_role;
grant execute on function public.get_tenant_auth_info() to authenticated;
grant execute on function public.get_tenant_auth_info() to service_role;
revoke all on function public.get_tenant_by_token(text) from public, anon, authenticated, service_role;
grant execute on function public.get_tenant_by_token(text) to anon;
grant execute on function public.get_tenant_by_token(text) to authenticated;
grant execute on function public.get_tenant_by_token(text) to service_role;
revoke all on function public.handle_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.handle_updated_at() to service_role;
revoke all on function public.has_claim_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_claim_access(uuid,text,text) to authenticated;
grant execute on function public.has_claim_access(uuid,text,text) to service_role;
revoke all on function public.has_economic_unit_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_economic_unit_access(uuid,text,text) to authenticated;
grant execute on function public.has_economic_unit_access(uuid,text,text) to service_role;
revoke all on function public.has_invoice_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_invoice_access(uuid,text,text) to authenticated;
grant execute on function public.has_invoice_access(uuid,text,text) to service_role;
revoke all on function public.has_lease_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_lease_access(uuid,text,text) to authenticated;
grant execute on function public.has_lease_access(uuid,text,text) to service_role;
revoke all on function public.has_portfolio_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_portfolio_access(uuid,text,text) to authenticated;
grant execute on function public.has_portfolio_access(uuid,text,text) to service_role;
revoke all on function public.has_property_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_property_access(uuid,text,text) to authenticated;
grant execute on function public.has_property_access(uuid,text,text) to service_role;
revoke all on function public.has_renovation_calculation_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_renovation_calculation_access(uuid,text,text) to authenticated;
grant execute on function public.has_renovation_calculation_access(uuid,text,text) to service_role;
revoke all on function public.has_renovation_project_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_renovation_project_access(uuid,text,text) to authenticated;
grant execute on function public.has_renovation_project_access(uuid,text,text) to service_role;
revoke all on function public.has_tenant_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_tenant_access(uuid,text,text) to authenticated;
grant execute on function public.has_tenant_access(uuid,text,text) to service_role;
revoke all on function public.has_unit_access(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.has_unit_access(uuid,text,text) to authenticated;
grant execute on function public.has_unit_access(uuid,text,text) to service_role;
revoke all on function public.import_rows(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.import_rows(jsonb) to authenticated;
grant execute on function public.import_rows(jsonb) to service_role;
revoke all on function public.is_applicant_document_owner(text) from public, anon, authenticated, service_role;
grant execute on function public.is_applicant_document_owner(text) to authenticated;
grant execute on function public.is_applicant_document_owner(text) to service_role;
revoke all on function public.keep_user_id_on_update() from public, anon, authenticated, service_role;
grant execute on function public.keep_user_id_on_update() to service_role;
revoke all on function public.lease_before_delete() from public, anon, authenticated, service_role;
grant execute on function public.lease_before_delete() to service_role;
revoke all on function public.lease_notes_set_meta() from public, anon, authenticated, service_role;
grant execute on function public.lease_notes_set_meta() to service_role;
revoke all on function public.lease_rent_period_for_month(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.lease_rent_period_for_month(uuid,date) to authenticated;
grant execute on function public.lease_rent_period_for_month(uuid,date) to service_role;
revoke all on function public.lease_rent_period_has_earlier(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.lease_rent_period_has_earlier(uuid,date) to authenticated;
grant execute on function public.lease_rent_period_has_earlier(uuid,date) to service_role;
revoke all on function public.lease_rent_periods_before_write() from public, anon, authenticated, service_role;
grant execute on function public.lease_rent_periods_before_write() to service_role;
revoke all on function public.leases_check_overlap() from public, anon, authenticated, service_role;
grant execute on function public.leases_check_overlap() to service_role;
revoke all on function public.leases_sync_tenant_owner() from public, anon, authenticated, service_role;
grant execute on function public.leases_sync_tenant_owner() to service_role;
revoke all on function public.notify_push(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.notify_push(text,jsonb) to service_role;
revoke all on function public.on_lease_change() from public, anon, authenticated, service_role;
grant execute on function public.on_lease_change() to service_role;
revoke all on function public.on_lease_rent_period_change() from public, anon, authenticated, service_role;
grant execute on function public.on_lease_rent_period_change() to service_role;
revoke all on function public.on_rent_payment_change() from public, anon, authenticated, service_role;
grant execute on function public.on_rent_payment_change() to service_role;
revoke all on function public.portfolio_shares_guard() from public, anon, authenticated, service_role;
grant execute on function public.portfolio_shares_guard() to service_role;
revoke all on function public.profiles_protect_stripe_connect() from public, anon, authenticated, service_role;
grant execute on function public.profiles_protect_stripe_connect() to service_role;
revoke all on function public.protect_claim_item_created_at() from public, anon, authenticated, service_role;
grant execute on function public.protect_claim_item_created_at() to service_role;
revoke all on function public.protect_claim_item_original_amount() from public, anon, authenticated, service_role;
grant execute on function public.protect_claim_item_original_amount() to service_role;
revoke all on function public.protect_claim_payment_records() from public, anon, authenticated, service_role;
grant execute on function public.protect_claim_payment_records() to service_role;
revoke all on function public.protect_claim_rent_payments() from public, anon, authenticated, service_role;
grant execute on function public.protect_claim_rent_payments() to service_role;
revoke all on function public.protect_issued_invoice() from public, anon, authenticated, service_role;
grant execute on function public.protect_issued_invoice() to service_role;
revoke all on function public.push_subscriptions_release_token() from public, anon, authenticated, service_role;
grant execute on function public.push_subscriptions_release_token() to service_role;
revoke all on function public.recalculate_lease_ledgers(uuid) from public, anon, authenticated, service_role;
grant execute on function public.recalculate_lease_ledgers(uuid) to authenticated;
grant execute on function public.recalculate_lease_ledgers(uuid) to service_role;
revoke all on function public.recalculate_rent_ledger_entry(uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.recalculate_rent_ledger_entry(uuid,date) to authenticated;
grant execute on function public.recalculate_rent_ledger_entry(uuid,date) to service_role;
revoke all on function public.record_claim_payment(uuid,date,numeric,text,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_claim_payment(uuid,date,numeric,text,uuid,text,uuid) to authenticated;
grant execute on function public.record_claim_payment(uuid,date,numeric,text,uuid,text,uuid) to service_role;
revoke all on function public.register_trial_rate_check(text) from public, anon, authenticated, service_role;
grant execute on function public.register_trial_rate_check(text) to authenticated;
grant execute on function public.register_trial_rate_check(text) to service_role;
revoke all on function public.renovation_calculations_owner_follows_property() from public, anon, authenticated, service_role;
grant execute on function public.renovation_calculations_owner_follows_property() to service_role;
revoke all on function public.renovation_projects_same_owner_on_move() from public, anon, authenticated, service_role;
grant execute on function public.renovation_projects_same_owner_on_move() to service_role;
revoke all on function public.renovation_set_created_by() from public, anon, authenticated, service_role;
grant execute on function public.renovation_set_created_by() to authenticated;
grant execute on function public.renovation_set_created_by() to service_role;
revoke all on function public.renovation_user_id_guard() from public, anon, authenticated, service_role;
grant execute on function public.renovation_user_id_guard() to service_role;
revoke all on function public.rent_ledger_block_claimed_delete() from public, anon, authenticated, service_role;
grant execute on function public.rent_ledger_block_claimed_delete() to service_role;
revoke all on function public.reverse_appended_claim(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reverse_appended_claim(uuid) to authenticated;
grant execute on function public.reverse_appended_claim(uuid) to service_role;
revoke all on function public.reverse_claim_payment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reverse_claim_payment(uuid) to authenticated;
grant execute on function public.reverse_claim_payment(uuid) to service_role;
revoke all on function public.reverse_payment_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reverse_payment_plan(uuid) to authenticated;
grant execute on function public.reverse_payment_plan(uuid) to service_role;
revoke all on function public.rls_contact_user_id_unchanged(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_contact_user_id_unchanged(uuid,uuid) to authenticated;
grant execute on function public.rls_contact_user_id_unchanged(uuid,uuid) to service_role;
revoke all on function public.rls_is_my_landlord(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_is_my_landlord(uuid) to authenticated;
grant execute on function public.rls_is_my_landlord(uuid) to service_role;
revoke all on function public.rls_is_portfolio_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_is_portfolio_owner(uuid) to authenticated;
grant execute on function public.rls_is_portfolio_owner(uuid) to service_role;
revoke all on function public.rls_is_unit_tenant(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_is_unit_tenant(uuid,uuid) to authenticated;
grant execute on function public.rls_is_unit_tenant(uuid,uuid) to service_role;
revoke all on function public.rls_message_allowed(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.rls_message_allowed(uuid,uuid,boolean) to authenticated;
grant execute on function public.rls_message_allowed(uuid,uuid,boolean) to service_role;
revoke all on function public.rls_ok_event_core_unchanged(uuid,uuid,uuid,text,text,text,date,boolean,text,date,uuid,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.rls_ok_event_core_unchanged(uuid,uuid,uuid,text,text,text,date,boolean,text,date,uuid,text,text,boolean) to authenticated;
grant execute on function public.rls_ok_event_core_unchanged(uuid,uuid,uuid,text,text,text,date,boolean,text,date,uuid,text,text,boolean) to service_role;
revoke all on function public.rls_owner_shares(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rls_owner_shares(uuid,text,text) to authenticated;
grant execute on function public.rls_owner_shares(uuid,text,text) to service_role;
revoke all on function public.rls_tenant_link_unchanged(text,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_tenant_link_unchanged(text,uuid,uuid) to authenticated;
grant execute on function public.rls_tenant_link_unchanged(text,uuid,uuid) to service_role;
revoke all on function public.rls_tenant_ok(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_tenant_ok(uuid,text,uuid) to authenticated;
grant execute on function public.rls_tenant_ok(uuid,text,uuid) to service_role;
revoke all on function public.rls_tenant_unleased_shared(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rls_tenant_unleased_shared(uuid,uuid,text,text) to authenticated;
grant execute on function public.rls_tenant_unleased_shared(uuid,uuid,text,text) to service_role;
revoke all on function public.rls_tenant_user_id_unchanged(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_tenant_user_id_unchanged(uuid,uuid) to authenticated;
grant execute on function public.rls_tenant_user_id_unchanged(uuid,uuid) to service_role;
revoke all on function public.rls_ticket_message_visible(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_ticket_message_visible(uuid) to authenticated;
grant execute on function public.rls_ticket_message_visible(uuid) to service_role;
revoke all on function public.rls_user_ok(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rls_user_ok(uuid,text,uuid) to authenticated;
grant execute on function public.rls_user_ok(uuid,text,uuid) to service_role;
revoke all on function public.save_property_economic_unit(uuid,uuid,jsonb,uuid,uuid[],uuid[],boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_property_economic_unit(uuid,uuid,jsonb,uuid,uuid[],uuid[],boolean) to authenticated;
grant execute on function public.save_property_economic_unit(uuid,uuid,jsonb,uuid,uuid[],uuid[],boolean) to service_role;
revoke all on function public.set_forderungsmanagement_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_forderungsmanagement_updated_at() to service_role;
revoke all on function public.set_owner_user_id() from public, anon, authenticated, service_role;
grant execute on function public.set_owner_user_id() to service_role;
revoke all on function public.settle_claim_item(uuid) from public, anon, authenticated, service_role;
grant execute on function public.settle_claim_item(uuid) to authenticated;
grant execute on function public.settle_claim_item(uuid) to service_role;
revoke all on function public.share_permits(jsonb,text,text) from public, anon, authenticated, service_role;
grant execute on function public.share_permits(jsonb,text,text) to authenticated;
grant execute on function public.share_permits(jsonb,text,text) to service_role;
revoke all on function public.storage_segment_uuid(text) from public, anon, authenticated, service_role;
grant execute on function public.storage_segment_uuid(text) to authenticated;
grant execute on function public.storage_segment_uuid(text) to service_role;
revoke all on function public.stripe_webhook_event_begin(text,text,boolean,text,bigint) from public, anon, authenticated, service_role;
grant execute on function public.stripe_webhook_event_begin(text,text,boolean,text,bigint) to service_role;
revoke all on function public.stripe_webhook_event_finish(text,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function public.stripe_webhook_event_finish(text,boolean,text,text) to service_role;
revoke all on function public.submit_public_payment_plan_request(text,text,integer,numeric,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_payment_plan_request(text,text,integer,numeric,numeric,numeric,text) to anon;
grant execute on function public.submit_public_payment_plan_request(text,text,integer,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.submit_public_payment_plan_request(text,text,integer,numeric,numeric,numeric,text) to service_role;
revoke all on function public.submit_rental_application(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_rental_application(text,jsonb) to anon;
grant execute on function public.submit_rental_application(text,jsonb) to authenticated;
grant execute on function public.submit_rental_application(text,jsonb) to service_role;
revoke all on function public.sync_all_rent_ledgers() from public, anon, authenticated, service_role;
grant execute on function public.sync_all_rent_ledgers() to authenticated;
grant execute on function public.sync_all_rent_ledgers() to service_role;
revoke all on function public.sync_contact_to_tenant() from public, anon, authenticated, service_role;
grant execute on function public.sync_contact_to_tenant() to service_role;
revoke all on function public.sync_lease_rent_from_periods(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sync_lease_rent_from_periods(uuid) to authenticated;
grant execute on function public.sync_lease_rent_from_periods(uuid) to service_role;
revoke all on function public.sync_lease_to_contact() from public, anon, authenticated, service_role;
grant execute on function public.sync_lease_to_contact() to service_role;
revoke all on function public.sync_tenant_to_contact() from public, anon, authenticated, service_role;
grant execute on function public.sync_tenant_to_contact() to service_role;
revoke all on function public.tenant_invitations_guard() from public, anon, authenticated, service_role;
grant execute on function public.tenant_invitations_guard() to service_role;
revoke all on function public.tenant_link_token_hash(text) from public, anon, authenticated, service_role;
grant execute on function public.tenant_link_token_hash(text) to authenticated;
grant execute on function public.tenant_link_token_hash(text) to service_role;
revoke all on function public.tenant_verification_links_hash_token() from public, anon, authenticated, service_role;
grant execute on function public.tenant_verification_links_hash_token() to service_role;
revoke all on function public.tenants_log_portal_change() from public, anon, authenticated, service_role;
grant execute on function public.tenants_log_portal_change() to service_role;
revoke all on function public.tenants_protect_columns() from public, anon, authenticated, service_role;
grant execute on function public.tenants_protect_columns() to service_role;
revoke all on function public.trigger_push_on_announcement() from public, anon, authenticated, service_role;
grant execute on function public.trigger_push_on_announcement() to service_role;
revoke all on function public.trigger_push_on_document() from public, anon, authenticated, service_role;
grant execute on function public.trigger_push_on_document() to service_role;
revoke all on function public.trigger_push_on_message() from public, anon, authenticated, service_role;
grant execute on function public.trigger_push_on_message() to service_role;
revoke all on function public.trigger_push_on_registration() from public, anon, authenticated, service_role;
grant execute on function public.trigger_push_on_registration() to service_role;
revoke all on function public.trigger_push_on_ticket() from public, anon, authenticated, service_role;
grant execute on function public.trigger_push_on_ticket() to service_role;
revoke all on function public.update_document_templates_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.update_document_templates_updated_at() to service_role;
revoke all on function public.update_meter_last_reading() from public, anon, authenticated, service_role;
grant execute on function public.update_meter_last_reading() to service_role;
revoke all on function public.update_overdue_claims_status() from public, anon, authenticated, service_role;
grant execute on function public.update_overdue_claims_status() to authenticated;
grant execute on function public.update_overdue_claims_status() to service_role;
revoke all on function public.update_tenant_by_token(text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.update_tenant_by_token(text,text,text,text,text,text,text,text,text) to anon;
grant execute on function public.update_tenant_by_token(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_tenant_by_token(text,text,text,text,text,text,text,text,text) to service_role;
revoke all on function public.update_updated_at_column() from public, anon, authenticated, service_role;
grant execute on function public.update_updated_at_column() to service_role;
revoke all on function public.user_roles_mark_invitation_accepted() from public, anon, authenticated, service_role;
grant execute on function public.user_roles_mark_invitation_accepted() to service_role;
revoke all on function public.user_roles_protect_identity() from public, anon, authenticated, service_role;
grant execute on function public.user_roles_protect_identity() to service_role;
revoke all on function public.user_smtp_settings_drop_secret() from public, anon, authenticated, service_role;
grant execute on function public.user_smtp_settings_drop_secret() to service_role;
revoke all on function public.user_smtp_settings_secure_pass() from public, anon, authenticated, service_role;
grant execute on function public.user_smtp_settings_secure_pass() to service_role;
revoke all on function public.verify_payment_allocations_sum() from public, anon, authenticated, service_role;
grant execute on function public.verify_payment_allocations_sum() to service_role;

-- -----------------------------------------------------------------------------
-- 14 · Kommentare
-- -----------------------------------------------------------------------------
comment on view public.claim_item_totals_view is 'Je Position: paid_principal = getilgt (Zahlung oder Erlass), waived_principal = davon Erlass/Ausbuchung ohne Geldeingang, open_amount = offen.';
comment on view public.claim_totals_view is 'Summen je Forderung. principal_paid = getilgt (Zahlung oder Erlass), principal_waived = davon Erlass/Ausbuchung ohne Geldeingang. Zinsen bis claim_today() (Berliner Kalendertag).';
comment on table public.contact_requests is 'Anfragen aus dem Kontaktformular der Website. Schreiben nur über die Edge Function contact-form (service_role).';
comment on table public.lease_cloud_folders is 'Cloud-Ordner (Pfad unterhalb ImmoControlpro360) je Mietverhältnis und Cloud-Verbindung – bleibt nach Umbenennungen gültig.';
comment on table public.lease_notes is 'Interne Notizen des Vermieters/Teams zu einem Mietverhältnis (nicht für Mieter sichtbar).';
comment on table public.lease_rent_periods is 'Miethistorie: Kaltmiete/NK/Heizkosten/Sonstiges/Zahltag je Mietvertrag, gültig ab valid_from (monatsgenau, ein Zeitraum je Monat).';
comment on table public.renovation_invoices is 'Rechnungen pro Untergewerk';
comment on table public.renovation_milestone_templates is 'Benutzer-eigene Meilenstein-Templates';
comment on table public.renovation_milestones is 'Meilensteine pro Gewerk – frei abhackbar';
comment on table public.renovation_project_subtrades is 'Untergewerke (Ebene 2) mit eigenem Budget & Rechnungen';
comment on table public.renovation_project_trades is 'Gewerke (Ebene 1) innerhalb eines Projekts';
comment on table public.renovation_projects is 'Sanierungsprojekte – mehrere pro Immobilie möglich';
comment on table public.renovation_subtrades is 'Benutzer-eigene Untergewerke-Templates';
comment on table public.renovation_tasks is 'Projektbezogene Aufgaben – optional Gewerk-bezogen';
comment on table public.renovation_trades is 'Benutzer-eigene Gewerke-Templates (Einstellungen)';
comment on table public.stripe_webhook_events is 'Ereignisprotokoll des Stripe-Webhooks (Edge Function stripe-webhook, nur service_role): je Stripe-Ereignis (event.id) Status, Versuche, Ergebnis-Code und kurze Fehlermeldung. Kein Ereignisinhalt, keine Personendaten.';
comment on table public.tenant_change_log is 'Änderungsprotokoll der Mieter-Stammdaten: Aktualisierung über den Mieterdaten-Link (source token_link, geschrieben von update_tenant_by_token) und Selbständerungen im Mieterportal (source tenant_portal, Trigger trg_tenants_portal_change_log). App-Konten dürfen nur lesen.';
comment on column public.claim_access_links.token_hash is 'SHA-256 (hex, klein) des Portal-Tokens; Prüfung in claim_portal_check_access. Klartext wird nie gespeichert.';
comment on column public.claim_access_links.pin_hash is 'bcrypt-Hash der Portal-PIN (extensions.crypt/gen_salt(''bf'', 8)); Prüfung in claim_portal_check_access. Klartext wird nie gespeichert.';
comment on column public.claims.tenant_id is 'Mieter der Forderung; bewusst nullable: delete_tenant_completely löst den Bezug (Lösch-Regel D2-17), die Forderung bleibt über lease_id zugeordnet.';
comment on column public.claims.interest_rate is 'Verzugszinssatz in Prozent p. a. (5.0000 = 5 %).';
comment on column public.cloud_connections.access_token is 'Veraltet: Klartext nur im Übergangsbetrieb (bis 08b_cloud_tokens_finalize). Maßgeblich ist der Vault.';
comment on column public.cloud_connections.refresh_token is 'Veraltet: Klartext nur im Übergangsbetrieb (bis 08b_cloud_tokens_finalize). Maßgeblich ist der Vault.';
comment on column public.cloud_connections.access_token_secret_id is 'Verweis auf vault.secrets (verschlüsseltes Access-Token). Lesen/Schreiben nur über cloud_get_tokens/cloud_store_tokens (service_role).';
comment on column public.cloud_connections.refresh_token_secret_id is 'Verweis auf vault.secrets (verschlüsseltes Refresh-Token). Lesen/Schreiben nur über cloud_get_tokens/cloud_store_tokens (service_role).';
comment on column public.contact_requests.client_hash is 'HMAC-Pseudonym der Absender-IP (nur für die Missbrauchsbremse, keine IP im Klartext).';
comment on column public.contact_requests.notified_at is 'Zeitpunkt der E-Mail-Benachrichtigung an das Team (null = keine Benachrichtigung verschickt).';
comment on column public.expense_categories.user_id is 'Eigentümer der Kategorie; NULL = globale Standardkategorie (für alle sichtbar, nicht änderbar).';
comment on column public.floor_plans.room_count is 'Generiert aus plan_data: Anzahl Räume (Grundriss-Liste ohne plan_data).';
comment on column public.floor_plans.total_area_mm2 is 'Generiert aus plan_data: Summe der Raumflächen in mm² (netto, wie im Editor).';
comment on column public.floor_plans.storey_labels is 'Generiert aus plan_data: Geschoss-Bezeichnungen in Reihenfolge.';
comment on column public.invoice_counters.object_unit_id is 'Veraltet: wird von get_next_invoice_number ignoriert (ein Zähler je Portfolio und Jahr, object_unit_id NULL).';
comment on column public.leases.tenant_id is 'Mieter des Vertrags; bewusst nullable: delete_tenant_completely löst den Bezug (Lösch-Regel D2-17), Vertrag und Mietkonto bleiben erhalten.';
comment on column public.leases.booking_start_date is 'Beginn der Mietkonto-Führung in ImmoControl360 (z. B. Importmonat bei Bestandsverträgen). Monate vor diesem Stichtag gelten in der App nicht als Mietrückstand (einblendbar). NULL = Heuristik über den Erfassungszeitpunkt des Vertrags.';
comment on column public.loans.bank_name is 'Bank / Co-Invest / sonstiges Darlehen';
comment on column public.loans.interest_rate is 'Sollzinssatz in Prozent p. a. (z. B. 3.5 = 3,5 %).';
comment on column public.portfolios.is_small_business is 'Kleinunternehmer nach § 19 UStG: Rechnungen dieses Portfolios ohne Umsatzsteuer-Ausweis (Voreinstellung im Rechnungsformular).';
comment on column public.properties.market_value_total is 'Marktwert gesamt (€)';
comment on column public.properties.market_value_per_sqm is 'Marktwert pro m² (€), automatisch berechnet';
comment on column public.properties.total_investment_cost is 'Gesamtinvestition inkl. KNK (€)';
comment on column public.properties.equity_invested is 'Eingesetztes Eigenkapital (€)';
comment on column public.properties.location_score_total is 'Lage-Score 1–10 (manuell, Ampel: 1-4 rot, 5-7 gelb, 8-10 grün)';
comment on column public.properties.dd_condition_exterior is 'DD Objektzustand Außen (0=keine Angabe, 1=Saniert, 2=Gut, 3=OK, 4=Mangel, 5=Defekt)';
comment on column public.properties.dd_condition_roof is 'DD Objektzustand Dach';
comment on column public.properties.dd_condition_staircase is 'DD Objektzustand Treppenhaus';
comment on column public.properties.dd_condition_units is 'DD Objektzustand Wohnungen';
comment on column public.properties.dd_condition_heating is 'DD Objektzustand Heizung';
comment on column public.properties.dd_energy_basement_ceiling is 'DD Energiestand Kellerdecke (0-5 Stufensystem)';
comment on column public.properties.dd_energy_attic_roof is 'DD Energiestand Dach/OG (0-5 Stufensystem)';
comment on column public.properties.dd_energy_facade is 'DD Energiestand Fassade (0-5 Stufensystem)';
comment on column public.properties.dd_energy_windows is 'DD Energiestand Fenster (0-5 Stufensystem)';
comment on column public.properties.dd_energy_heating is 'DD Energiestand Heizung (0-5 Stufensystem)';
comment on column public.properties.building_share_percent is 'Gebäudeanteil in % (für AfA-Berechnung)';
comment on column public.properties.afa_percent is 'AfA-Satz in % (Standard 2%)';
comment on column public.renovation_invoices.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';
comment on column public.renovation_projects.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';
comment on column public.renovation_tasks.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';
comment on column public.rent_payments.claim_payment_id is 'Forderungszahlung, aus der diese Mietzahlung gespiegelt wurde (gesetzt nur von record_claim_payment). Die Notiz "Verrechnung Forderungsakte (Ref: …)" ist reiner Anzeigetext.';
comment on column public.rental_applicants.received_mail_sent_at is 'Zeitpunkt, zu dem send-letting-email die Eingangsbestätigung belegt/verschickt hat (NULL = noch nicht).';
comment on column public.rental_viewing_bookings.confirmed_mail_sent_at is 'Zeitpunkt, zu dem send-letting-email die Terminbestätigung belegt/verschickt hat (NULL = noch nicht).';
comment on column public.rental_viewing_bookings.canceled_mail_sent_at is 'Zeitpunkt, zu dem send-letting-email die Absagebestätigung belegt/verschickt hat (NULL = noch nicht).';
comment on column public.stripe_webhook_events.outcome is 'Ergebnis-Code der Verarbeitung, z. B. claim_payment_booked, claim_payment_duplicate, claim_payment_unbooked (fachlich nicht verbuchbar, Hinweis in der Forderungsakte), claim_payment_unbooked_no_claim, unhandled.';
comment on column public.stripe_webhook_events.started_at is 'Beginn des letzten Verarbeitungsversuchs; ein Versuch im Status processing gilt nach 10 Minuten als abgebrochen.';
comment on column public.subscriptions.cancel_at_period_end is 'Stripe: Abo ist zum Ende der laufenden Periode gekündigt (gepflegt von stripe-webhook).';
comment on column public.tenants.salutation is 'Anrede für Briefe: female = Frau, male = Herr, diverse; NULL = keine Angabe (neutrale Anrede).';
comment on column public.units.cold_rent_ist is 'Kaltmiete IST (€) – wird automatisch aus Mietvertrag synchronisiert';
comment on column public.units.service_charge_soll is 'Nebenkosten (€) – wird automatisch aus Mietvertrag synchronisiert';
comment on column public.units.heating_cost_soll is 'Heizkosten (€) – wird automatisch aus Mietvertrag synchronisiert';
comment on column public.units.other_costs_soll is 'Sonstige Kosten (€) – wird automatisch aus Mietvertrag synchronisiert';
comment on column public.units.deposit_soll is 'Kaution (€) – wird automatisch aus Mietvertrag synchronisiert';
comment on column public.user_smtp_settings.smtp_pass is 'Nur Eingabekanal: wird vom Trigger trg_user_smtp_settings_secure_pass in den Vault verschoben und ist immer NULL.';
comment on column public.user_smtp_settings.smtp_pass_secret_id is 'Verweis auf vault.secrets (Name smtp_pass:<user_id>). Nur über get_smtp_password (service_role) lesbar.';
comment on column public.utility_settlements.calculation_snapshot is 'Festschreibung beim Fertigstellen (status = done): alle Rechengrundlagen und Ergebnisse je Mieter. Das PDF einer fertigen Abrechnung wird ausschließlich hieraus erzeugt.';
comment on function public.bank_transactions_unmatch_deleted_target() is 'Setzt Bankumsätze auf pending zurück, wenn die zugeordnete Mietzahlung (income) bzw. Ausgabe (expense) gelöscht wird.';
comment on function public.claim_interest_amount(numeric,numeric,date,date) is 'Einzige Zinsformel des Forderungsmoduls: Kapital x Satz/100 x Tage/365, auf Cent gerundet. Bewusste Vereinfachung: immer 365 Tage (auch in Schaltjahren). Stichtag der Sichten und RPCs ist claim_today() (Kalendertag Europe/Berlin).';
comment on function public.claim_live_interest(uuid,date) is 'Laufende Zinsen einer Forderung seit interest_start_date bis zum Stichtag (ohne Positionen eines aktiven Ratenplans).';
comment on function public.claim_portal_check_access(text,text) is 'Interne Prüfung des Mieterportal-Zugangs (Token-SHA-256 + PIN-bcrypt, Fehlversuchs-Sperre). Nur über get_public_claim_by_token / submit_public_payment_plan_request aufrufen.';
comment on function public.claim_today() is 'Heutiger Kalendertag des Forderungsmoduls (Europe/Berlin, Transaktionsbeginn). Stichtag für Zinsen in claim_totals_view und den Forderungs-RPCs (D1b-16).';
comment on function public.create_claim_portal_link(uuid,integer) is 'Erzeugt einen Mieterportal-Link (Token + PIN) für eine Forderung. Gespeichert werden nur Hashes; Token und PIN werden nur in dieser Antwort geliefert (G15-05, G17b-12, R1-08, D3a-16).';
comment on function public.create_credit_note(uuid) is 'Erstellt zur ausgestellten Rechnung eine Gutschrift (eigene Nummer, negative Beträge, Bezug je Position) und kennzeichnet die Rechnung als storniert – in einer Transaktion. SECURITY INVOKER (RLS des Aufrufers). Aufruf: lib/invoiceDocument.js createCreditNote.';
comment on function public.delete_portfolio(uuid,uuid,boolean) is 'Löscht ein eigenes Nicht-Hauptportfolio; mit Ziel werden alle Inhalte vorher übertragen. Alles in einer Transaktion. SECURITY DEFINER mit Eigentümer-Prüfung (Quelle und Ziel). Aufruf: Settings.jsx.';
comment on function public.floor_plan_can_write(uuid) is 'FLOORPLAN G30a-05: Schreibrecht des aktuellen Kontos am Grundriss (wie floor_plans_update); für die Storage-Policies des Buckets floorplan-backgrounds.';
comment on function public.floor_plan_room_count(jsonb) is 'FLOORPLAN G29-05: Anzahl Räume aller Geschosse in plan_data (für die generierte Spalte floor_plans.room_count).';
comment on function public.floor_plan_storey_labels(jsonb) is 'FLOORPLAN G29-05: Geschoss-Bezeichnungen in Reihenfolge (für floor_plans.storey_labels).';
comment on function public.floor_plan_total_area_mm2(jsonb) is 'FLOORPLAN G29-05: Summe area_mm2 aller Räume in plan_data (für floor_plans.total_area_mm2).';
comment on function public.generate_claim_access_link(uuid,text,text,integer) is 'Altweg (App bis 27.11.2026): legt einen Portal-Link mit vom Aufrufer erzeugtem Token/PIN an; gespeichert werden nur Hashes. Neue App: create_claim_portal_link.';
comment on function public.get_my_landlord_info(uuid) is 'Mieterportal: Vermieter-ID (Nachrichten-Empfänger) und Öffnungszeiten für das eigene Objekt. Keine weiteren Profil-, Portfolio- oder Objektspalten.';
comment on function public.get_next_invoice_number(uuid,uuid,integer) is 'Nächste Rechnungsnummer „JJJJ-NNN“ je Portfolio und Jahr (p_object_unit_id wird ignoriert). Berücksichtigt Zähler und bereits vergebene Nummern. Aufruf: create_credit_note.';
comment on function public.import_rows(jsonb) is 'Excel-Import (Import.jsx): legt Portfolios, Immobilien, Einheiten, Mieter und Mietverträge aus dem geprüften Importplan in einer Transaktion an (alles oder nichts). SECURITY INVOKER – RLS des Aufrufers.';
comment on function public.lease_before_delete() is 'BEFORE-DELETE-Trigger auf leases (Paket DB-SCHEMA): verhindert das direkte Löschen von Verträgen mit Buchungsdaten und entfernt unbearbeitete Auto-Sollstellungen.';
comment on function public.profiles_protect_stripe_connect() is 'Stripe-Connect-Konto und -Status sind nur für service_role (Edge Functions stripe-connect-onboard/stripe-webhook) änderbar.';
comment on function public.protect_issued_invoice() is 'Trigger (invoices, BEFORE UPDATE OR DELETE): Entwürfe frei; ausgestellte/stornierte Rechnungen und Gutschriften unveränderlich und nicht löschbar (Ausnahmen: issued->credited, Portfolio-Übertrag durch den Eigentümer, Verweis->NULL nach Löschen des Datensatzes, Löschen mit dem Benutzerkonto).';
comment on function public.push_subscriptions_release_token() is 'BEFORE-Trigger auf push_subscriptions (Paket DB-SCHEMA): ein FCM-Token gehört nur dem zuletzt angemeldeten Konto.';
comment on function public.register_trial_rate_check(text) is 'Missbrauchsbremse für die Edge Function register-trial (nur service_role). Paket BILLING, 2026-11-27.';
comment on function public.renovation_set_created_by() is 'FLOORPLAN G29-13: setzt created_by beim Anlegen auf auth.uid() und hält es danach fest.';
comment on function public.save_property_economic_unit(uuid,uuid,jsonb,uuid,uuid[],uuid[],boolean) is 'Speichert ein Objekt samt Wirtschaftseinheit (Gesamtwerte, Zuordnen, Lösen) in einer Transaktion. SECURITY INVOKER: es gelten die RLS-Regeln des aufrufenden Nutzers. Aufruf: Properties.jsx handleSaveProperty.';
comment on function public.storage_segment_uuid(text) is 'SEC-STORAGE: wandelt ein Storage-Pfadsegment in uuid um (NULL bei ungültigem Format).';
comment on function public.stripe_webhook_event_begin(text,text,boolean,text,bigint) is 'Stripe-Webhook (nur service_role): Ereignis vermerken. Rückgabe process | duplicate | in_progress.';
comment on function public.stripe_webhook_event_finish(text,boolean,text,text) is 'Stripe-Webhook (nur service_role): Ergebnis eines Ereignisses vermerken (processed/failed).';
comment on function public.tenants_log_portal_change() is 'Trigger (AFTER UPDATE auf tenants): protokolliert Selbständerungen des Mieters im Mieterportal in tenant_change_log (source tenant_portal).';

-- -----------------------------------------------------------------------------
-- 15 · Realtime-Publikation
-- -----------------------------------------------------------------------------
do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then alter publication supabase_realtime add table public.announcements; end if; end $pub$;
do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents') then alter publication supabase_realtime add table public.documents; end if; end $pub$;
do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then alter publication supabase_realtime add table public.messages; end if; end $pub$;
do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets') then alter publication supabase_realtime add table public.tickets; end if; end $pub$;
do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_roles') then alter publication supabase_realtime add table public.user_roles; end if; end $pub$;

-- -----------------------------------------------------------------------------
-- 16 · Storage: Buckets und Policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('announcements', 'announcements', 'f', 10485760, '{image/*,application/pdf}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('applicant-documents', 'applicant-documents', 'f', 10485760, '{application/pdf,image/jpeg,image/png}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('chat-attachments', 'chat-attachments', 'f', 10485760, '{image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('claim-documents', 'claim-documents', 'f', 10485760, '{application/pdf}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('documents', 'documents', 'f', 10485760, '{application/pdf,image/jpeg,image/png,image/gif,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('floorplan-backgrounds', 'floorplan-backgrounds', 'f', 15728640, '{image/png,image/jpeg}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('pdf-assets', 'pdf-assets', 't', 5242880, '{image/png,image/jpeg,image/webp,image/gif}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('tenant-documents', 'tenant-documents', 'f', 10485760, '{application/pdf,image/jpeg,image/png,image/gif,image/webp}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('tickets', 'tickets', 'f', 10485760, '{image/*}') on conflict (id) do nothing;
create policy allow_authenticated_read_buckets on storage.buckets as permissive for select to public
    using ((auth.role() = 'authenticated'::text));
create policy announcements_delete_access on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'announcements'::text) AND public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text)));
create policy announcements_insert_access on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'announcements'::text) AND public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text)));
create policy announcements_read_access on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'announcements'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'read'::text) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = 'tenant'::text) AND ((ur.property_id)::text = (storage.foldername(objects.name))[1])))))));
create policy applicant_docs_owner_delete on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'applicant-documents'::text) AND public.is_applicant_document_owner(name)));
create policy applicant_docs_owner_select on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'applicant-documents'::text) AND public.is_applicant_document_owner(name)));
create policy applicant_docs_public_insert on storage.objects as permissive for insert to anon, authenticated
    with check (((bucket_id = 'applicant-documents'::text) AND public.applicant_document_upload_allowed(name)));
create policy chat_attachments_delete_access on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'chat-attachments'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.messages m
  WHERE ((m.sender_id = auth.uid()) AND (m.attachment_url = objects.name)))))));
create policy chat_attachments_insert_access on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'chat-attachments'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy chat_attachments_read_access on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'chat-attachments'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM public.messages m
  WHERE ((m.receiver_id = auth.uid()) AND ((m.sender_id)::text = (storage.foldername(objects.name))[1]) AND (m.attachment_url = objects.name)))))));
create policy claim_documents_insert on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'claim-documents'::text) AND (COALESCE(array_length(storage.foldername(name), 1), 0) = 1) AND (lower(COALESCE(storage.extension(name), ''::text)) = 'pdf'::text) AND public.has_claim_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'finanzen'::text, 'write'::text)));
create policy claim_documents_read on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'claim-documents'::text) AND public.has_claim_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'finanzen'::text, 'write'::text)));
create policy documents_delete_access on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'documents'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'immobilien'::text, 'write'::text) OR public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text))));
create policy documents_delete_own_folder on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy documents_insert_access on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'documents'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'immobilien'::text, 'write'::text) OR public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text)) AND (((storage.foldername(name))[2] = 'general'::text) OR (((storage.foldername(name))[2] = 'tenant'::text) AND public.has_tenant_access(public.storage_segment_uuid((storage.foldername(name))[3]), '*'::text, 'read'::text)))));
create policy documents_insert_own_folder on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy documents_read_access on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'documents'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'immobilien'::text, 'read'::text) OR public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'read'::text) OR (((storage.foldername(name))[2] = 'general'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = 'tenant'::text) AND ((ur.property_id)::text = (storage.foldername(objects.name))[1])))) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (((d.file_path = objects.name) OR (d.storage_path = objects.name)) AND (d.tenant_id IS NULL) AND ((d.property_id)::text = (storage.foldername(objects.name))[1]))))) OR (((storage.foldername(name))[2] = 'tenant'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = 'tenant'::text) AND ((ur.tenant_id)::text = (storage.foldername(objects.name))[3])))) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (((d.file_path = objects.name) OR (d.storage_path = objects.name)) AND ((d.tenant_id)::text = (storage.foldername(objects.name))[3]))))))));
create policy documents_read_own_folder on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy documents_update_own_folder on storage.objects as permissive for update to authenticated
    using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
    with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy floorplan_backgrounds_delete on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'floorplan-backgrounds'::text) AND public.floor_plan_can_write(public.storage_segment_uuid((storage.foldername(name))[1]))));
create policy floorplan_backgrounds_insert on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'floorplan-backgrounds'::text) AND (COALESCE(array_length(storage.foldername(name), 1), 0) = 1) AND public.floor_plan_can_write(public.storage_segment_uuid((storage.foldername(name))[1]))));
create policy floorplan_backgrounds_read on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'floorplan-backgrounds'::text) AND (EXISTS ( SELECT 1
   FROM public.floor_plans fp
  WHERE (fp.id = public.storage_segment_uuid((storage.foldername(objects.name))[1]))))));
create policy pdf_assets_delete_access on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'pdf-assets'::text) AND ((owner_id = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'logos'::text) AND (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])) AND (p.user_id = auth.uid()))))))));
create policy pdf_assets_insert_access on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'pdf-assets'::text) AND ((storage.foldername(name))[1] = 'logos'::text) AND (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])) AND (p.user_id = auth.uid()))))));
create policy pdf_assets_read_access on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'pdf-assets'::text) AND ((owner_id = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'logos'::text) AND public.has_portfolio_access(public.storage_segment_uuid((storage.foldername(name))[2]), '*'::text, 'read'::text)))));
create policy pdf_assets_update_access on storage.objects as permissive for update to authenticated
    using (((bucket_id = 'pdf-assets'::text) AND ((owner_id = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'logos'::text) AND (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])) AND (p.user_id = auth.uid()))))))))
    with check (((bucket_id = 'pdf-assets'::text) AND ((storage.foldername(name))[1] = 'logos'::text) AND (EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])) AND (p.user_id = auth.uid()))))));
create policy tenant_documents_delete_own_folder on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'tenant-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy tenant_documents_insert_own_folder on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'tenant-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy tenant_documents_read_own_folder on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'tenant-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy tickets_delete_access on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'tickets'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text) OR ((owner_id = (auth.uid())::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.tickets t
  WHERE (objects.name = ANY (t.images)))))))));
create policy tickets_insert_access on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'tickets'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'write'::text) OR ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = 'tenant'::text) AND ((ur.property_id)::text = (storage.foldername(objects.name))[1]) AND ((ur.unit_id)::text = (storage.foldername(objects.name))[2])))) AND ((COALESCE(array_length(storage.foldername(name), 1), 0) = 2) OR ((COALESCE(array_length(storage.foldername(name), 1), 0) = 3) AND ((storage.foldername(name))[3] = (auth.uid())::text)))))));
create policy tickets_read_access on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'tickets'::text) AND (public.has_property_access(public.storage_segment_uuid((storage.foldername(name))[1]), 'mieterportal'::text, 'read'::text) OR (owner_id = (auth.uid())::text))));

-- -----------------------------------------------------------------------------
-- 17 · Standardrechte für künftige Objekte (Rolle postgres, Schema public)
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to authenticated;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to postgres;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to service_role;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to authenticated;
alter default privileges for role postgres in schema public grant execute on functions to postgres;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant delete, insert, maintain, references, select, trigger, truncate, update on tables to authenticated;
alter default privileges for role postgres in schema public grant delete, insert, maintain, references, select, trigger, truncate, update on tables to postgres;
alter default privileges for role postgres in schema public grant delete, insert, maintain, references, select, trigger, truncate, update on tables to service_role;

-- Prüfsumme (md5 des Inhalts vor dieser Zeile): 2464c53455a7277f40e991958c9f1e04
