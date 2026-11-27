-- ════════════════════════════════════════════════════════════════════════════
-- 101400_invoices_tax.sql  ·  Paket INVOICES  ·  Komplett-Check 2026-11-27
--
-- Befunde:
--   G10-06 / G08-14  Umsatzsteuer war fest 7 %; es gab keine Kleinunternehmer-Option.
--       Fix (App): Steuersatz je Rechnungsposition (0/7/19 %), Summen je Satz.
--       Fix (DB, diese Datei): neue Spalte portfolios.is_small_business als
--       Voreinstellung „Kleinunternehmer nach § 19 UStG" je Portfolio (Rechnungen
--       ohne USt-Ausweis, mit Hinweistext). Der Status wird beim Speichern einer
--       Rechnung in deren Positionen (invoices.positions[].smallBusiness) eingefroren,
--       spätere Änderungen am Portfolio ändern ausgestellte Rechnungen also nicht.
--
-- Bewusst NUR die Spalte:
--   - keine Policies (Portfolio-Policies gehören dem Paket SEC-SHARES; das Ändern
--     der Spalte folgt den bestehenden UPDATE-Regeln für portfolios),
--   - keine weiteren Rechnungs-Spalten: Belegstatus ('draft' | 'issued' | 'credited' |
--     'credit_note'), Steuersatz je Position und der Bezug einer Gutschrift auf die
--     Originalrechnung liegen in vorhandenen Spalten (status text ohne CHECK,
--     positions jsonb). Ein späterer CHECK auf invoices.status muss diese vier Werte
--     zulassen (siehe Test).
--
-- Kompatibilität: Die App erkennt die Spalte per Feature-Erkennung (select('*')
-- liefert das Feld erst nach dieser Migration) und funktioniert auch ohne sie
-- (Kleinunternehmer dann je Rechnung im Formular wählbar).
--
-- Idempotent: kann mehrfach ausgeführt werden.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.portfolios
    add column if not exists is_small_business boolean not null default false;

comment on column public.portfolios.is_small_business is
    'Kleinunternehmer nach § 19 UStG: Rechnungen dieses Portfolios ohne Umsatzsteuer-Ausweis (Voreinstellung im Rechnungsformular).';
