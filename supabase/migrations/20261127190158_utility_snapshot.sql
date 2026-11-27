-- =============================================================================
-- Paket NK · Festschreibung der Nebenkostenabrechnung (Komplett-Check 2026-11-27, Thema 4.14)
--
-- Befunde:
--   G09b-02  Fertiggestellte Abrechnung ist nicht eingefroren – PDF und Mieterliste werden
--            aus Live-Daten neu berechnet
--   G09a-09  Druck berechnet Bezugsgrößen neu aus dem aktuellen Datenstand
--
-- Inhalt:
--   1. Spalte utility_settlements.calculation_snapshot (jsonb, darf leer sein).
--      Beim Fertigstellen schreibt die App alle Rechengrundlagen und Ergebnisse je Mieter
--      hinein (Zeiträume, Tage, Personen, Bezugsgrößen je Kostenart, Anteile, Vorauszahlungen,
--      Saldo, Empfänger-/Vermieterangaben). Das PDF einer fertigen Abrechnung wird nur noch
--      daraus erzeugt.
--      Eigene Spalte statt eines Feldes in data, weil ältere App-Versionen beim Speichern
--      data vollständig überschreiben und den Snapshot sonst verlieren würden.
--   2. Übernahme von Snapshots, die die App vor dieser Migration ersatzweise in
--      data.calculation_snapshot abgelegt hat (Feature-Erkennung in der App).
--   3. Prüfregel: der Snapshot ist ein JSON-Objekt.
--
-- Keine neuen Policies: die Spalte unterliegt den bestehenden Zeilen-Policies von
-- utility_settlements (Paket SEC-POLICIES). Keine Funktionen, keine Trigger.
-- Idempotent (mehrfach ausführbar).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Spalte
-- -----------------------------------------------------------------------------
alter table public.utility_settlements
    add column if not exists calculation_snapshot jsonb;

comment on column public.utility_settlements.calculation_snapshot is
    'Festschreibung beim Fertigstellen (status = done): alle Rechengrundlagen und Ergebnisse je Mieter. Das PDF einer fertigen Abrechnung wird ausschließlich hieraus erzeugt.';

-- -----------------------------------------------------------------------------
-- 2. Ersatzweise in data gespeicherte Snapshots übernehmen
-- -----------------------------------------------------------------------------
update public.utility_settlements
   set calculation_snapshot = data -> 'calculation_snapshot',
       data = data - 'calculation_snapshot'
 where calculation_snapshot is null
   and data is not null
   and jsonb_typeof(data -> 'calculation_snapshot') = 'object';

-- Doppelt vorhandene Kopie in data entfernen, wenn die Spalte bereits gefüllt ist
update public.utility_settlements
   set data = data - 'calculation_snapshot'
 where calculation_snapshot is not null
   and data ? 'calculation_snapshot';

-- -----------------------------------------------------------------------------
-- 3. Prüfregel
-- -----------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'utility_settlements_snapshot_is_object'
           and conrelid = 'public.utility_settlements'::regclass
    ) then
        alter table public.utility_settlements
            add constraint utility_settlements_snapshot_is_object
            check (calculation_snapshot is null or jsonb_typeof(calculation_snapshot) = 'object');
    end if;
end $$;
