-- =============================================================================
-- Ausgangsschema (Baseline) aus dem Live-Katalog erzeugen und prüfen
--
-- Ergebnis: eine Zeile mit den Spalten
--   ddl     Inhalt von baseline_public.sql (letzte Zeile = md5-Prüfsumme des Inhalts davor)
--   seed    Inhalt von seed_system_defaults.sql (globale Vorgaben mit user_id IS NULL)
--   report  Prüfbericht: das erzeugte DDL wurde in dieser Transaktion in Ersatz-Schemata
--           (w3bl_public / w3bl_auth / w3bl_storage) eingespielt und Objekt für Objekt mit dem
--           Live-Stand verglichen. Erwartet: "OK" in jeder Zeile. Bekannte, harmlose Abweichungen:
--           notify_push (absichtlich, siehe unten) sowie contact_requests_email_len und
--           lease_cloud_folders_path_check (gleiche Bedingung, nur andere Klammerung: die Originale
--           wurden mit BETWEEN angelegt).
--
-- Aufruf: per Supabase-MCP execute_sql oder SQL-Editor (der ganze Inhalt dieser Datei). Alles läuft
-- in EINER Transaktion, die am Ende zurückgerollt wird – die Datenbank bleibt unverändert. Danach
-- mit  node supabase/baseline/extract_baseline.cjs <gespeichertes Ergebnis.json>  die Dateien schreiben.
--
-- Liest nur Katalog/Metadaten, keine Kundendaten. Ausnahme (Spalte seed): die globalen Vorgaben in
-- distribution_keys und expense_categories mit user_id IS NULL (Systemdaten, keine Personen).
--
-- notify_push: Der Live-Rumpf enthält bis zur Schlüssel-Erneuerung (Phase 0) ein Schlüssel-Literal.
-- Er wird NIE ausgegeben; stattdessen schreibt der Generator eine Vault-Fassung (siehe unten).
-- =============================================================================
begin;
set local search_path = pg_catalog;

create function pg_temp.baseline_notify_push_def() returns text language sql immutable as $def$
select $nb$CREATE OR REPLACE FUNCTION public.notify_push(p_table text, p_record jsonb)
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
$nb$
$def$;

create function pg_temp.baseline_role(p_oid oid) returns text language sql stable as $f$
    select case when p_oid = 0 then 'public' else quote_ident(pg_get_userbyid(p_oid)::text) end
$f$;

-- -----------------------------------------------------------------------------
-- DDL-Erzeugung
-- -----------------------------------------------------------------------------
create function pg_temp.baseline_ddl() returns text language sql stable as $gen$
with
tbl as (
    select c.oid, c.relname::text as relname, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
vw as (
    select c.oid, c.relname::text as relname, c.relowner, c.relacl, c.reloptions
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
),
fn as (
    select p.oid, p.proname::text as proname, p.proowner, p.proacl, p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
-- Funktionen, die schon beim Anlegen der Tabellen existieren müssen: von berechneten Spalten,
-- Spalten-Vorgaben oder CHECK-Constraints benutzt (z. B. floor_plans.room_count ->
-- floor_plan_room_count(jsonb)). Sie stehen deshalb vor Abschnitt 3, nicht in Abschnitt 5.
early_fn as (
    select distinct fn.oid
      from fn
      join pg_depend d on d.refclassid = 'pg_proc'::regclass and d.refobjid = fn.oid
     where (d.classid = 'pg_attrdef'::regclass
            and exists (select 1 from pg_attrdef ad join tbl on tbl.oid = ad.adrelid where ad.oid = d.objid))
        or (d.classid = 'pg_constraint'::regclass
            and exists (select 1 from pg_constraint k join tbl on tbl.oid = k.conrelid
                         where k.oid = d.objid and k.contype = 'c'))
),
cols as (
    select a.attrelid, a.attnum,
           '    ' || quote_ident(a.attname::text) || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attcollation <> 0 and a.attcollation <> t.typcollation
                   then ' collate ' || a.attcollation::regcollation::text else '' end
           || case when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
                   when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid)
                   else '' end
           || case a.attidentity when 'a' then ' generated always as identity'
                                 when 'd' then ' generated by default as identity' else '' end
           || case when a.attnotnull then ' not null' else '' end as txt
      from pg_attribute a
      join tbl on tbl.oid = a.attrelid
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attnum > 0 and not a.attisdropped
),
inline_cons as (
    select k.conrelid, k.conname::text as conname,
           case k.contype when 'p' then 1 when 'u' then 2 when 'x' then 3 else 4 end as o,
           '    constraint ' || quote_ident(k.conname::text) || ' ' || pg_get_constraintdef(k.oid) as txt
      from pg_constraint k
     where k.connamespace = 'public'::regnamespace
       and k.contype in ('p', 'u', 'x', 'c') and k.convalidated
       and k.conrelid in (select oid from tbl)
),
lines(sec, ord, txt) as (
    -- 0 Kopf
    select 0, '0', concat_ws(E'\n',
        '-- =============================================================================',
        '-- ImmoControl360 · Ausgangsschema (Baseline) der Live-Datenbank – Schema public (+ Storage-Policies)',
        '-- Erzeugt mit supabase/baseline/generate_baseline.sql aus dem Live-Katalog (nur lesend).',
        '-- Stand: ' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD') || ' · ' || split_part(version(), ' on ', 1)
            || ' · letzte eingetragene Migration: '
            || coalesce((select max(version) from supabase_migrations.schema_migrations), 'unbekannt'),
        '-- Inhalt: ' || (select count(*) from tbl) || ' Tabellen, ' || (select count(*) from vw) || ' Sichten, '
            || (select count(*) from fn) || ' Funktionen, '
            || (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = 'public'::regnamespace)
            || ' Policies (public), '
            || (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = 'storage'::regnamespace)
            || ' Storage-Policies',
        '--',
        '-- NUR AUF EINER LEEREN DATENBANK (frisches Supabase-Projekt) ausführen, als eine Transaktion:',
        '--   psql "<db-url>" -v ON_ERROR_STOP=1 --single-transaction -f baseline_public.sql',
        '-- Danach optional seed_system_defaults.sql, dann alle Migrationen, die NACH dem oben genannten Stand',
        '-- eingetragen wurden (Einzelheiten: supabase/baseline/README.md). Nie auf der Live-Datenbank ausführen.',
        '--',
        '-- notify_push ist hier eine Vault-Fassung (Schlüssel aus vault.decrypted_secrets), NICHT der Live-Rumpf.',
        '-- Keine Daten außer Storage-Bucket-Einstellungen. Rollen anon/authenticated/service_role und die',
        '-- Supabase-Schemata auth/storage/extensions/vault werden vorausgesetzt.',
        '-- =============================================================================')
    union all
    select 1, '0', concat_ws(E'\n',
        'set check_function_bodies = off;',
        'set client_min_messages = warning;',
        'select pg_catalog.set_config(''search_path'', '''', false);')

    -- 1 (Fortsetzung) Funktionen für berechnete Spalten/Vorgaben/CHECK – vor den Tabellen
    union all
    select 1, '1', E'\n-- Funktionen, die berechnete Spalten, Spalten-Vorgaben oder CHECK-Constraints benutzen\n-- (müssen vor den Tabellen in Abschnitt 3 existieren; Rechte und Kommentare folgen in 13/14)'
     where exists (select 1 from early_fn)
    union all
    select 1, '1 ' || fn.proname || ' ' || fn.sig, replace(pg_get_functiondef(fn.oid), E'\r\n', E'\n') || ';'
      from fn where fn.oid in (select oid from early_fn)

    -- 2 Erweiterungen
    union all
    select 2, e.extname::text, format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname <> 'plpgsql'

    -- 3 Tabellen mit Spalten, Primär-/Unique-/Check-Constraints
    union all
    select 3, tbl.relname,
           'create table public.' || quote_ident(tbl.relname) || E' (\n'
           || coalesce((select string_agg(x.txt, E',\n' order by x.o, x.k)
                          from (select 0 as o, lpad(c.attnum::text, 5, '0') as k, c.txt from cols c where c.attrelid = tbl.oid
                                union all
                                select ic.o, ic.conname, ic.txt from inline_cons ic where ic.conrelid = tbl.oid) x), '')
           || E'\n);'
      from tbl

    -- 4 Fremdschlüssel und nicht validierte Constraints (nach allen Tabellen)
    union all
    select 4, c.relname::text || '.' || k.conname::text,
           format('alter table public.%I add constraint %I %s;', c.relname, k.conname, pg_get_constraintdef(k.oid))
      from pg_constraint k join pg_class c on c.oid = k.conrelid
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and (k.contype = 'f' or (k.contype in ('p', 'u', 'x', 'c') and not k.convalidated))

    -- 5 Funktionen (notify_push als Vault-Fassung; Windows-Zeilenenden einzelner Altfunktionen -> LF)
    union all
    select 5, fn.proname || ' ' || fn.sig,
           case when fn.proname = 'notify_push' then pg_temp.baseline_notify_push_def()
                else replace(pg_get_functiondef(fn.oid), E'\r\n', E'\n') end || ';'
      from fn
     where fn.oid not in (select oid from early_fn)

    -- 6 Sichten
    union all
    select 6, lpad(vw.oid::text, 12, '0'),
           format(E'create view public.%I%s as\n%s;', vw.relname,
                  case when vw.reloptions is not null then ' with (' || array_to_string(vw.reloptions, ', ') || ')' else '' end,
                  rtrim(pg_get_viewdef(vw.oid, true), E'; \n'))
      from vw

    -- 7 Indizes (ohne die von Constraints)
    union all
    select 7, c.relname::text || '.' || ic.relname::text, pg_get_indexdef(i.indexrelid) || ';'
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
     where c.relnamespace = 'public'::regnamespace
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p', 'u', 'x'))

    -- 8 Trigger (auf public-Tabellen und auf fremden Tabellen mit public-Funktion)
    union all
    select 8, c.relnamespace::regnamespace::text || '.' || c.relname::text || '.' || t.tgname::text,
           pg_get_triggerdef(t.oid) || ';'
           || case t.tgenabled
                  when 'D' then E'\n' || format('alter table %s disable trigger %I;', c.oid::regclass::text, t.tgname)
                  when 'R' then E'\n' || format('alter table %s enable replica trigger %I;', c.oid::regclass::text, t.tgname)
                  when 'A' then E'\n' || format('alter table %s enable always trigger %I;', c.oid::regclass::text, t.tgname)
                  else '' end
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
       and (c.relnamespace = 'public'::regnamespace or p.pronamespace = 'public'::regnamespace)

    -- 9 Zeilenschutz
    union all
    select 9, tbl.relname,
           format('alter table public.%I enable row level security;', tbl.relname)
           || case when tbl.relforcerowsecurity then E'\n' || format('alter table public.%I force row level security;', tbl.relname) else '' end
      from tbl where tbl.relrowsecurity

    -- 10 Policies (public) und 16 Storage-Policies
    union all
    select case when c.relnamespace = 'public'::regnamespace then 10 else 16 end,
           c.relname::text || '.' || pol.polname::text,
           format('create policy %I on %s as %s for %s to %s', pol.polname, c.oid::regclass::text,
                  case when pol.polpermissive then 'permissive' else 'restrictive' end,
                  case pol.polcmd when '*' then 'all' when 'r' then 'select' when 'a' then 'insert'
                                  when 'w' then 'update' when 'd' then 'delete' end,
                  (select string_agg(pg_temp.baseline_role(r.oid), ', ' order by r.n)
                     from unnest(pol.polroles) with ordinality as r(oid, n)))
           || case when pol.polqual is not null then E'\n    using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')' else '' end
           || case when pol.polwithcheck is not null then E'\n    with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')' else '' end
           || ';'
      from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)

    -- 11 Rechte auf Tabellen und Sichten
    union all
    select 11, o.relname,
           format('revoke all on table public.%I from public, anon, authenticated, service_role;', o.relname)
           || coalesce((select string_agg(E'\n' || format('grant %s on table public.%I to %s%s;', g.privs, o.relname,
                                                           pg_temp.baseline_role(g.grantee),
                                                           case when g.grantable then ' with grant option' else '' end),
                                          '' order by pg_temp.baseline_role(g.grantee), g.grantable)
                          from (select a.grantee, a.is_grantable as grantable,
                                       string_agg(lower(a.privilege_type), ', ' order by a.privilege_type) as privs
                                  from aclexplode(coalesce(o.relacl, acldefault('r', o.relowner))) a
                                 where a.grantee <> o.relowner
                                 group by a.grantee, a.is_grantable) g), '')
      from (select relname, relacl, relowner from tbl union all select relname, relacl, relowner from vw) o

    -- 12 Spaltenrechte
    union all
    select 12, c.relname::text || '.' || lpad(at.attnum::text, 5, '0'),
           (select string_agg(format('grant %s (%I) on table public.%I to %s%s;', lower(a.privilege_type), at.attname, c.relname,
                                     pg_temp.baseline_role(a.grantee),
                                     case when a.is_grantable then ' with grant option' else '' end),
                              E'\n' order by pg_temp.baseline_role(a.grantee), a.privilege_type)
              from aclexplode(at.attacl) a)
      from pg_attribute at join pg_class c on c.oid = at.attrelid
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
       and at.attnum > 0 and not at.attisdropped and at.attacl is not null

    -- 13 Rechte auf Funktionen
    union all
    select 13, fn.proname || ' ' || fn.sig,
           format('revoke all on function %s from public, anon, authenticated, service_role;', fn.sig)
           || coalesce((select string_agg(E'\n' || format('grant execute on function %s to %s%s;', fn.sig,
                                                           pg_temp.baseline_role(a.grantee),
                                                           case when a.is_grantable then ' with grant option' else '' end),
                                          '' order by pg_temp.baseline_role(a.grantee))
                          from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
                         where a.grantee <> fn.proowner), '')
      from fn

    -- 14 Kommentare
    union all
    select 14, '1 ' || c.relname::text,
           format('comment on %s public.%I is %L;', case c.relkind when 'v' then 'view' else 'table' end, c.relname, ds.description)
      from pg_description ds join pg_class c on c.oid = ds.objoid
     where ds.classoid = 'pg_class'::regclass and ds.objsubid = 0
       and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
    union all
    select 14, '2 ' || c.relname::text || '.' || lpad(ds.objsubid::text, 5, '0'),
           format('comment on column public.%I.%I is %L;', c.relname, a.attname, ds.description)
      from pg_description ds
      join pg_class c on c.oid = ds.objoid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = ds.objsubid
     where ds.classoid = 'pg_class'::regclass and ds.objsubid > 0
       and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
    union all
    select 14, '3 ' || fn.proname || ' ' || fn.sig, format('comment on function %s is %L;', fn.sig, ds.description)
      from pg_description ds join fn on fn.oid = ds.objoid
     where ds.classoid = 'pg_proc'::regclass

    -- 15 Realtime-Publikation (eine Zeile je Tabelle, beginnt mit "do $pub$")
    union all
    select 15, c.relname::text,
           format('do $pub$ begin if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = %L and schemaname = %L and tablename = %L) then alter publication %I add table %s%s%s; end if; end $pub$;',
                  p.pubname, 'public', c.relname, p.pubname, c.oid::regclass::text,
                  case when pr.prattrs is not null
                       then ' (' || (select string_agg(quote_ident(a.attname::text), ', ' order by a.attnum)
                                       from pg_attribute a where a.attrelid = c.oid and a.attnum = any (pr.prattrs::int2[])) || ')'
                       else '' end,
                  case when pr.prqual is not null then ' where (' || pg_get_expr(pr.prqual, pr.prrelid) || ')' else '' end)
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
     where p.pubname = 'supabase_realtime' and c.relnamespace = 'public'::regnamespace

    -- 16 Storage-Buckets (Einstellungen, keine Dateien)
    union all
    select 16, '0 ' || b.id,
           format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %s, %L) on conflict (id) do nothing;',
                  b.id, b.name, b.public, coalesce(b.file_size_limit::text, 'null'), b.allowed_mime_types)
      from storage.buckets b

    -- 17 Standardrechte für künftige Objekte der Rolle postgres im Schema public
    union all
    select 17, d.defaclobjtype::text,
           format('alter default privileges for role postgres in schema public revoke all on %s from public, anon, authenticated, service_role;',
                  case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' end)
           || coalesce((select string_agg(E'\n' || format('alter default privileges for role postgres in schema public grant %s on %s to %s;',
                                                           g.privs,
                                                           case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' end,
                                                           pg_temp.baseline_role(g.grantee)),
                                          '' order by pg_temp.baseline_role(g.grantee))
                          from (select a.grantee, string_agg(lower(a.privilege_type), ', ' order by a.privilege_type) as privs
                                  from aclexplode(d.defaclacl) a
                                 group by a.grantee) g), '')
      from pg_default_acl d
     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype in ('r', 'S', 'f', 'T')
),
sections(sec, title) as (
    values (2, 'Erweiterungen'), (3, 'Tabellen (Spalten, Primär-/Unique-/Check-Constraints)'),
           (4, 'Fremdschlüssel'), (5, 'Funktionen'), (6, 'Sichten'), (7, 'Indizes'), (8, 'Trigger'),
           (9, 'Zeilenschutz (RLS)'), (10, 'Policies'), (11, 'Rechte auf Tabellen und Sichten'),
           (12, 'Spaltenrechte'), (13, 'Rechte auf Funktionen'), (14, 'Kommentare'),
           (15, 'Realtime-Publikation'), (16, 'Storage: Buckets und Policies'),
           (17, 'Standardrechte für künftige Objekte (Rolle postgres, Schema public)')
),
body as (
    select string_agg(x.txt, E'\n' order by x.sec, x.o, x.ord) as ddl
      from (select l.sec, 1 as o, l.ord, l.txt from lines l
            union all
            select s.sec, 0, '', E'\n-- -----------------------------------------------------------------------------\n-- '
                                 || s.sec || ' · ' || s.title
                                 || E'\n-- -----------------------------------------------------------------------------'
              from sections s) x
)
select body.ddl || E'\n\n-- Prüfsumme (md5 des Inhalts vor dieser Zeile): ' || md5(body.ddl || E'\n') || E'\n'
  from body
$gen$;

-- -----------------------------------------------------------------------------
-- Systemvorgaben (keine Personen): globale Verteilerschlüssel und Kostenarten
-- -----------------------------------------------------------------------------
create function pg_temp.baseline_seed() returns text language sql stable as $gen$
select concat_ws(E'\n',
    '-- =============================================================================',
    '-- ImmoControl360 · globale Systemvorgaben (user_id IS NULL) – nach baseline_public.sql einspielen',
    '-- Erzeugt mit supabase/baseline/generate_baseline.sql. Idempotent (on conflict do nothing).',
    '-- =============================================================================',
    format('insert into public.distribution_keys select * from jsonb_populate_recordset(null::public.distribution_keys, %L::jsonb) on conflict do nothing;',
           (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb) from public.distribution_keys d where d.user_id is null)),
    format('insert into public.expense_categories select * from jsonb_populate_recordset(null::public.expense_categories, %L::jsonb) on conflict do nothing;',
           (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from public.expense_categories e where e.user_id is null))
) || E'\n'
$gen$;

-- -----------------------------------------------------------------------------
-- Prüfung: DDL in Ersatz-Schemata einspielen und mit dem Live-Stand vergleichen
-- (läuft in dieser Transaktion; alles wird am Ende zurückgerollt)
-- -----------------------------------------------------------------------------
create function pg_temp.baseline_norm(p text) returns text language sql immutable as $f$
    select replace(replace(replace(p, 'w3bl_public', 'public'), 'w3bl_auth.', 'auth.'), 'w3bl_storage.', 'storage.')
$f$;

create function pg_temp.baseline_verify(p_ddl text) returns text language plpgsql
set search_path = pg_catalog
as $v$
declare
    v_sql text := p_ddl;
    v_report text := '';
    r record;
begin
    create schema w3bl_public;
    create schema w3bl_auth;
    create schema w3bl_storage;
    create table w3bl_auth.users (like auth.users including defaults including indexes);
    create table w3bl_storage.objects (like storage.objects including defaults including indexes);
    create table w3bl_storage.buckets (like storage.buckets including defaults including indexes);

    -- Umbenennen: public -> w3bl_public, auth.users / storage.objects / storage.buckets -> Ersatz
    v_sql := regexp_replace(v_sql, '\mpublic\.', 'w3bl_public.', 'g');
    v_sql := replace(v_sql, 'search_path TO ''public''', 'search_path TO ''w3bl_public''');
    v_sql := regexp_replace(v_sql, '\min schema public\M', 'in schema w3bl_public', 'g');
    v_sql := regexp_replace(v_sql, '\mauth\.users\M', 'w3bl_auth.users', 'g');
    v_sql := regexp_replace(v_sql, '\mstorage\.objects\M', 'w3bl_storage.objects', 'g');
    v_sql := regexp_replace(v_sql, '\mstorage\.buckets\M', 'w3bl_storage.buckets', 'g');
    -- Publikation nicht anfassen
    v_sql := regexp_replace(v_sql, '^do \$pub\$[^\n]*$', '', 'gn');

    execute v_sql;
    perform set_config('search_path', 'pg_catalog', true);

    -- Vergleich je Objektart: Live (public) gegen Neubau (w3bl_public), Texte normalisiert
    create temp table w3bl_fp (side text, cat text, k text, v text) on commit drop;

    insert into w3bl_fp
    select s.side, 'spalten', c.relname || '.' || a.attname,
           format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' || a.attgenerated::text || '|' || a.attidentity::text
           || '|' || coalesce(pg_temp.baseline_norm(pg_get_expr(d.adbin, d.adrelid)), '') || '|' || a.attcollation
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace and c.relkind in ('r', 'p', 'v')
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum;

    insert into w3bl_fp
    select s.side, 'constraints', c.relname || '.' || k.conname,
           k.contype::text || '|' || k.convalidated || '|'
           || pg_temp.baseline_norm(pg_get_constraintdef(k.oid))
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace
      join pg_constraint k on k.conrelid = c.oid;

    insert into w3bl_fp
    select s.side, 'indizes', c.relname || '.' || ic.relname, pg_temp.baseline_norm(pg_get_indexdef(i.indexrelid))
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace
      join pg_index i on i.indrelid = c.oid
      join pg_class ic on ic.oid = i.indexrelid;

    insert into w3bl_fp
    select s.side, 'funktionen', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           case when p.proname = 'notify_push' then 'Rumpf absichtlich abweichend (Vault-Fassung)'
                else md5(regexp_replace(replace(pg_temp.baseline_norm(pg_get_functiondef(p.oid)), E'\r', ''), '\s+', ' ', 'g')) end
           || '|' || p.prosecdef || '|' || p.provolatile::text || '|' || coalesce(pg_temp.baseline_norm(p.proconfig::text), '')
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_proc p on p.pronamespace = s.nsp::regnamespace;

    insert into w3bl_fp
    select s.side, 'sichten', c.relname,
           md5(pg_temp.baseline_norm(pg_get_viewdef(c.oid, true))) || '|' || coalesce(c.reloptions::text, '')
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace and c.relkind = 'v';

    insert into w3bl_fp
    select s.side, 'trigger', c.relname || '.' || t.tgname,
           pg_temp.baseline_norm(pg_get_triggerdef(t.oid)) || '|' || t.tgenabled::text
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace
      join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal;

    insert into w3bl_fp
    select s.side, 'policies', c.relname || '.' || pol.polname,
           pol.polcmd::text || '|' || pol.polpermissive || '|' || pol.polroles::regrole[]::text || '|'
           || coalesce(pg_temp.baseline_norm(pg_get_expr(pol.polqual, pol.polrelid)), '') || '|'
           || coalesce(pg_temp.baseline_norm(pg_get_expr(pol.polwithcheck, pol.polrelid)), '')
      from (values ('live', 'public'), ('neu', 'w3bl_public'), ('live', 'storage'), ('neu', 'w3bl_storage')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace
      join pg_policy pol on pol.polrelid = c.oid;

    insert into w3bl_fp
    select s.side, 'rls', c.relname, c.relrowsecurity || '|' || c.relforcerowsecurity
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace and c.relkind in ('r', 'p');

    insert into w3bl_fp
    select s.side, 'rechte', c.relname,
           coalesce((select string_agg(pg_temp.baseline_role(a.grantee) || ':' || a.privilege_type || ':' || a.is_grantable, ','
                                       order by pg_temp.baseline_role(a.grantee), a.privilege_type, a.is_grantable)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '')
           || '|' || coalesce((select string_agg(at.attname || '=' || pg_temp.baseline_role(a.grantee) || ':' || a.privilege_type,
                                                 ',' order by at.attnum, pg_temp.baseline_role(a.grantee), a.privilege_type)
                                 from pg_attribute at, aclexplode(at.attacl) a
                                where at.attrelid = c.oid and at.attacl is not null), '')
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace and c.relkind in ('r', 'p', 'v');

    insert into w3bl_fp
    select s.side, 'funktionsrechte', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           coalesce((select string_agg(pg_temp.baseline_role(a.grantee) || ':' || a.privilege_type, ','
                                       order by pg_temp.baseline_role(a.grantee), a.privilege_type)
                       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '')
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_proc p on p.pronamespace = s.nsp::regnamespace;

    insert into w3bl_fp
    select s.side, 'kommentare', c.relname || '.' || ds.objsubid, ds.description
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_class c on c.relnamespace = s.nsp::regnamespace
      join pg_description ds on ds.classoid = 'pg_class'::regclass and ds.objoid = c.oid
    union all
    select s.side, 'kommentare', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ds.description
      from (values ('live', 'public'), ('neu', 'w3bl_public')) s(side, nsp)
      join pg_proc p on p.pronamespace = s.nsp::regnamespace
      join pg_description ds on ds.classoid = 'pg_proc'::regclass and ds.objoid = p.oid;

    insert into w3bl_fp
    select 'live', 'buckets', b.id, b.name || '|' || b.public || '|' || coalesce(b.file_size_limit::text, '') || '|' || coalesce(b.allowed_mime_types::text, '')
      from storage.buckets b
    union all
    select 'neu', 'buckets', b.id, b.name || '|' || b.public || '|' || coalesce(b.file_size_limit::text, '') || '|' || coalesce(b.allowed_mime_types::text, '')
      from w3bl_storage.buckets b;

    insert into w3bl_fp
    select 'live', 'standardrechte', d.defaclobjtype::text, d.defaclacl::text
      from pg_default_acl d where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
    union all
    select 'neu', 'standardrechte', d.defaclobjtype::text, d.defaclacl::text
      from pg_default_acl d where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'w3bl_public'::regnamespace;

    for r in
        select cat,
               count(*) filter (where l.k is not null) as n_live,
               count(*) filter (where n.k is not null) as n_neu,
               count(*) filter (where l.v is distinct from n.v) as n_diff,
               string_agg(coalesce(l.k, n.k), ', ' order by coalesce(l.k, n.k)) filter (where l.v is distinct from n.v) as diffs
          from (select * from w3bl_fp where side = 'live') l
          full join (select * from w3bl_fp where side = 'neu') n using (cat, k)
         group by cat
         order by cat
    loop
        v_report := v_report || format('%-16s live=%s neu=%s abweichend=%s%s', r.cat, r.n_live, r.n_neu, r.n_diff,
                                       case when r.n_diff = 0 then '  OK' else '  -> ' || left(r.diffs, 400) end) || E'\n';
    end loop;
    return v_report;
end;
$v$;

with x as materialized (select pg_temp.baseline_ddl() as ddl, pg_temp.baseline_seed() as seed)
select x.ddl, x.seed, pg_temp.baseline_verify(x.ddl) as report
  from x;

rollback;
