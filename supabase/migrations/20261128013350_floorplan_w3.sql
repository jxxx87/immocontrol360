-- =============================================================================
-- WAVE3 Paket 05 FLOORPLAN (Grundrisse / Sanierungsmanager) – 27.11.2026
--
-- Befunde:
--   G29-05   Grundriss-Liste lädt komplette plan_data (live 24,6 MB je Aufruf)
--            -> Kennzahlen room_count / total_area_mm2 / storey_labels als generierte
--               Spalten an floor_plans (aus plan_data berechnet, beim Schreiben gespeichert).
--   G30a-05  Hintergrundbild als Base64 in plan_data
--            -> privater Bucket floorplan-backgrounds, Pfad <floor_plan_id>/<datei>,
--               Rechte wie der Grundriss selbst (Lesen = Grundriss sichtbar,
--               Hochladen/Löschen = Schreibrecht am Grundriss).
--   G29-13   Projektdaten hängen per ON DELETE CASCADE am anlegenden Konto
--            -> App schreibt user_id = Portfolio-Eigentümer; hier zusätzlich
--               created_by (Ersteller) an renovation_projects, renovation_invoices,
--               renovation_tasks – per Trigger gesetzt, nicht fälschbar.
--   G27-25   Tote Tabelle renovation_positions (0 Zeilen, nirgends benutzt) -> entfernen,
--            aber nur, solange sie leer ist.
--
-- Verträglich mit der heute ausgelieferten App:
--   * Die App liest/schreibt die neuen Spalten nicht (generierte Spalten werden nie
--     mitgesendet; select('*') liefert sie zusätzlich, ohne Wirkung).
--   * Neuer Bucket wird von der heutigen App nicht benutzt.
--   * created_by wird vom Trigger gefüllt; die heutige App sendet es nicht.
--   * renovation_positions wird weder in src noch in Edge Functions benutzt.
-- Idempotent: create or replace / add column if not exists / drop … if exists /
-- on conflict. Keine bestehende Funktionssignatur wird geändert.
-- =============================================================================

-- =============================================================================
-- 1) G29-05 – Kennzahlen aus plan_data (generierte Spalten)
-- Die Funktionen sind robust gegen unerwartete Formen (kein Array, Räume ohne Fläche,
-- Fläche als Text): ein Fehler im Ausdruck würde sonst jedes Speichern verhindern.
-- =============================================================================
create or replace function public.floor_plan_room_count(p_plan jsonb)
returns integer
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(sum(
           case when jsonb_typeof(s -> 'rooms') = 'array' then jsonb_array_length(s -> 'rooms') else 0 end
         ), 0)::integer
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end) as s
$$;

create or replace function public.floor_plan_total_area_mm2(p_plan jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(sum(
           case when jsonb_typeof(r -> 'area_mm2') = 'number' then (r ->> 'area_mm2')::numeric else 0 end
         ), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end) as s
  cross join lateral jsonb_array_elements(
           case when jsonb_typeof(s -> 'rooms') = 'array' then s -> 'rooms' else '[]'::jsonb end) as r
$$;

create or replace function public.floor_plan_storey_labels(p_plan jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(coalesce(nullif(e.s ->> 'label', ''), '?') order by e.ord), '{}'::text[])
  from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end)
       with ordinality as e(s, ord)
$$;

comment on function public.floor_plan_room_count(jsonb) is
  'FLOORPLAN G29-05: Anzahl Räume aller Geschosse in plan_data (für die generierte Spalte floor_plans.room_count).';
comment on function public.floor_plan_total_area_mm2(jsonb) is
  'FLOORPLAN G29-05: Summe area_mm2 aller Räume in plan_data (für floor_plans.total_area_mm2).';
comment on function public.floor_plan_storey_labels(jsonb) is
  'FLOORPLAN G29-05: Geschoss-Bezeichnungen in Reihenfolge (für floor_plans.storey_labels).';

-- Ausführen müssen sie alle Rollen, die floor_plans schreiben (der Ausdruck der generierten
-- Spalte läuft mit den Rechten des Schreibenden). anon schreibt floor_plans nicht.
revoke all on function public.floor_plan_room_count(jsonb) from public, anon;
revoke all on function public.floor_plan_total_area_mm2(jsonb) from public, anon;
revoke all on function public.floor_plan_storey_labels(jsonb) from public, anon;
grant execute on function public.floor_plan_room_count(jsonb) to authenticated, service_role;
grant execute on function public.floor_plan_total_area_mm2(jsonb) to authenticated, service_role;
grant execute on function public.floor_plan_storey_labels(jsonb) to authenticated, service_role;

alter table public.floor_plans
  add column if not exists room_count integer
    generated always as (public.floor_plan_room_count(plan_data)) stored;
alter table public.floor_plans
  add column if not exists total_area_mm2 numeric
    generated always as (public.floor_plan_total_area_mm2(plan_data)) stored;
alter table public.floor_plans
  add column if not exists storey_labels text[]
    generated always as (public.floor_plan_storey_labels(plan_data)) stored;

comment on column public.floor_plans.room_count is 'Generiert aus plan_data: Anzahl Räume (Grundriss-Liste ohne plan_data).';
comment on column public.floor_plans.total_area_mm2 is 'Generiert aus plan_data: Summe der Raumflächen in mm² (netto, wie im Editor).';
comment on column public.floor_plans.storey_labels is 'Generiert aus plan_data: Geschoss-Bezeichnungen in Reihenfolge.';

-- =============================================================================
-- 2) G30a-05 – Bucket für Hintergrundbilder
-- Pfad: <floor_plan_id>/<datei> (genau eine Ordnerebene). Die Rechte folgen dem Grundriss:
--   Lesen      = der Grundriss ist für das Konto sichtbar (floor_plans-RLS)
--   Hochladen  = Schreibrecht am Grundriss (wie floor_plans_update)
--   Löschen    = Schreibrecht am Grundriss
-- Kein UPDATE (Dateien werden nie überschrieben, jede Datei hat einen eindeutigen Namen).
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('floorplan-backgrounds', 'floorplan-backgrounds', false, 15728640, array['image/png', 'image/jpeg']::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Schreibrecht am Grundriss – gleiche Regel wie die Policy floor_plans_update.
-- SECURITY INVOKER: der Grundriss muss für den Aufrufer sichtbar sein (floor_plans-RLS).
create or replace function public.floor_plan_can_write(p_plan_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.floor_plan_can_write(uuid) is
  'FLOORPLAN G30a-05: Schreibrecht des aktuellen Kontos am Grundriss (wie floor_plans_update); für die Storage-Policies des Buckets floorplan-backgrounds.';

revoke all on function public.floor_plan_can_write(uuid) from public, anon;
grant execute on function public.floor_plan_can_write(uuid) to authenticated, service_role;

drop policy if exists floorplan_backgrounds_read on storage.objects;
drop policy if exists floorplan_backgrounds_insert on storage.objects;
drop policy if exists floorplan_backgrounds_delete on storage.objects;

create policy floorplan_backgrounds_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'floorplan-backgrounds'
    and exists (
      select 1 from public.floor_plans fp
      where fp.id = public.storage_segment_uuid((storage.foldername(objects.name))[1]))
  );

create policy floorplan_backgrounds_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'floorplan-backgrounds'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 1
    and public.floor_plan_can_write(public.storage_segment_uuid((storage.foldername(objects.name))[1]))
  );

create policy floorplan_backgrounds_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'floorplan-backgrounds'
    and public.floor_plan_can_write(public.storage_segment_uuid((storage.foldername(objects.name))[1]))
  );

-- =============================================================================
-- 3) G29-13 – Ersteller festhalten (created_by)
-- user_id = Eigentümer der Daten (App: Portfolio-Eigentümer), created_by = anlegendes
-- Konto. ON DELETE SET NULL: das Löschen eines Teammitglieds löscht keine Projektdaten.
-- Der Trigger setzt created_by beim Anlegen auf auth.uid() (nicht fälschbar) und hält es
-- danach fest; erlaubt sind nur das Leeren (ON DELETE SET NULL) und der Nachtrag unten.
-- =============================================================================
alter table public.renovation_projects
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.renovation_invoices
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.renovation_tasks
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

comment on column public.renovation_projects.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';
comment on column public.renovation_invoices.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';
comment on column public.renovation_tasks.created_by is 'Anlegendes Konto (Trigger); user_id = Eigentümer der Daten.';

create or replace function public.renovation_set_created_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.renovation_set_created_by() is
  'FLOORPLAN G29-13: setzt created_by beim Anlegen auf auth.uid() und hält es danach fest.';

revoke all on function public.renovation_set_created_by() from public, anon;
grant execute on function public.renovation_set_created_by() to authenticated, service_role;

drop trigger if exists trg_renovation_projects_created_by on public.renovation_projects;
create trigger trg_renovation_projects_created_by
  before insert or update of created_by on public.renovation_projects
  for each row execute function public.renovation_set_created_by();

drop trigger if exists trg_renovation_invoices_created_by on public.renovation_invoices;
create trigger trg_renovation_invoices_created_by
  before insert or update of created_by on public.renovation_invoices
  for each row execute function public.renovation_set_created_by();

drop trigger if exists trg_renovation_tasks_created_by on public.renovation_tasks;
create trigger trg_renovation_tasks_created_by
  before insert or update of created_by on public.renovation_tasks
  for each row execute function public.renovation_set_created_by();

-- Bestand: bisher war user_id stets das anlegende Konto (live geprüft: alle Zeilen gehören
-- dem Portfolio-Eigentümer) -> als Ersteller übernehmen. Läuft als Migration ohne
-- auth.uid(); der Trigger lässt das Nachtragen eines fehlenden Werts dann zu.
-- updated_at bleibt unverändert (Trigger set_updated_at für den Nachtrag kurz aus).
do $$
declare
  t text;
  toggle boolean;
begin
  foreach t in array array['renovation_projects', 'renovation_invoices', 'renovation_tasks'] loop
    toggle := exists (
      select 1 from pg_trigger
      where tgrelid = ('public.' || t)::regclass and tgname = 'set_updated_at'
        and not tgisinternal and tgenabled = 'O');
    if toggle then
      execute format('alter table public.%I disable trigger set_updated_at', t);
    end if;
    execute format('update public.%I set created_by = user_id where created_by is null and user_id is not null', t);
    if toggle then
      execute format('alter table public.%I enable trigger set_updated_at', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- 4) G27-25 – renovation_positions entfernen (nur wenn leer)
-- Rückbau: _fixwork/sql/wave3/rollback/05_floorplan.rollback.sql (Tabelle, Indizes,
-- Policies und Rechte wie live am 27.11.2026).
-- =============================================================================
do $$
begin
  if to_regclass('public.renovation_positions') is not null then
    if exists (select 1 from public.renovation_positions limit 1) then
      raise notice 'renovation_positions enthält Daten – Tabelle bleibt bestehen.';
    else
      drop table public.renovation_positions;
    end if;
  end if;
end $$;

-- PostgREST-Schema neu laden (neue Spalten sofort per API sichtbar)
notify pgrst, 'reload schema';
