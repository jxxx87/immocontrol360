-- =============================================================================
-- Paket WEB-B (Komplett-Check 2026-11-27) – Tabelle public.contact_requests
--
-- Befunde: W1b-01 (Kontaktformular sendet nichts, meldet aber Erfolg),
--          W1b-04 (Spam-Schutz / tatsächliche Verarbeitung der Formulardaten)
--
-- Speichert Anfragen aus dem Kontaktformular der Website (immocontrol360.de).
-- Geschrieben wird AUSSCHLIESSLICH von der Edge Function "contact-form" mit service_role.
--   - RLS ist eingeschaltet, es gibt bewusst KEINE Policy für anon/authenticated
--     (service_role umgeht RLS). Zusätzlich sind die Tabellenrechte für anon/authenticated entzogen.
--   - Die IP-Adresse wird nicht gespeichert, nur ein HMAC-Pseudonym (client_hash) für die
--     Begrenzung "x Anfragen pro Stunde".
--   - Lesen/Bearbeiten: Supabase-Dashboard (Table Editor) bzw. service_role.
--
-- Speicherdauer: noch nicht festgelegt (Entscheidung des Betreibers, Datenschutzerklärung) –
-- alte Anfragen müssen derzeit manuell gelöscht werden.
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  message text not null,
  source_page text,
  client_hash text,
  notified_at timestamptz,
  status text not null default 'new'
);

comment on table public.contact_requests is
  'Anfragen aus dem Kontaktformular der Website. Schreiben nur über die Edge Function contact-form (service_role).';
comment on column public.contact_requests.client_hash is
  'HMAC-Pseudonym der Absender-IP (nur für die Missbrauchsbremse, keine IP im Klartext).';
comment on column public.contact_requests.notified_at is
  'Zeitpunkt der E-Mail-Benachrichtigung an das Team (null = keine Benachrichtigung verschickt).';

-- Plausibilitäts-Constraints (benannt, damit sie wiederholbar angelegt werden können)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_name_len' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_name_len check (char_length(name) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_email_len' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_email_len check (char_length(email) between 3 and 254 and position('@' in email) > 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_message_len' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_message_len check (char_length(message) between 1 and 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_source_page_len' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_source_page_len check (source_page is null or char_length(source_page) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_client_hash_len' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_client_hash_len check (client_hash is null or char_length(client_hash) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_status_check' and conrelid = 'public.contact_requests'::regclass) then
    alter table public.contact_requests
      add constraint contact_requests_status_check check (status in ('new', 'done', 'spam'));
  end if;
end $$;

-- Indizes für die Begrenzung (Zählung der letzten Stunde) und die Übersicht
create index if not exists contact_requests_created_at_idx
  on public.contact_requests (created_at desc);
create index if not exists contact_requests_client_hash_idx
  on public.contact_requests (client_hash, created_at desc)
  where client_hash is not null;
create index if not exists contact_requests_email_idx
  on public.contact_requests (email, created_at desc);

-- Zugriff: nur service_role
alter table public.contact_requests enable row level security;

revoke all on table public.contact_requests from public;
revoke all on table public.contact_requests from anon;
revoke all on table public.contact_requests from authenticated;
grant select, insert, update, delete on table public.contact_requests to service_role;

-- Keine Policies für anon/authenticated (eventuell früher angelegte Policies entfernen)
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'contact_requests'
  loop
    execute format('drop policy if exists %I on public.contact_requests', p.policyname);
  end loop;
end $$;
