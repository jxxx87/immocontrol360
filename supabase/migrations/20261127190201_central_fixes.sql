-- =============================================================================
-- Zentrale Ergänzungen (Komplett-Check 2026-11-27)
-- G29-01: renovation_projects.gik_transferred_amount – bereits in die Gesamtinvestition (GIK)
--         des Objekts übernommener Betrag. NULL = unbekannt (Projekt wurde vor Einführung der
--         Spalte abgeschlossen -> die App warnt vor erneuter Übernahme), 0 = noch nichts übernommen.
--         Live gibt es nur Projekte mit Status 'active' (4), daher keine Altlasten.
-- =============================================================================

alter table public.renovation_projects
    add column if not exists gik_transferred_amount numeric;

-- Neue Projekte (Wizard sendet die Spalte nicht mit) starten mit 0 = "noch nichts übernommen",
-- nicht mit NULL (= "Altstand unbekannt", würde unnötig vor Doppelbuchung warnen).
alter table public.renovation_projects
    alter column gik_transferred_amount set default 0;

update public.renovation_projects
   set gik_transferred_amount = 0
 where gik_transferred_amount is null
   and status in ('planned', 'active');

alter table public.renovation_projects
    drop constraint if exists renovation_projects_gik_transferred_amount_check;
alter table public.renovation_projects
    add constraint renovation_projects_gik_transferred_amount_check
    check (gik_transferred_amount is null or gik_transferred_amount >= 0);
