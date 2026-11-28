// Unit-Tests der Serien- und ICS-Logik des Objektkalenders (G11-04, G11-14).
// UTC-Zeitpunkte liegen jeweils mittags, damit das lokale Datum in jeder Zeitzone gleich bleibt.
import { describe, it, expect } from 'vitest';
import {
    buildRecurringDates,
    nextRecurringDate,
    summarizeRecurringSeries,
    endsAtYearEnd,
    planSeriesExtension,
    seriesEndingBefore,
    parseRrule,
    expandRrule,
    parseIcs,
    planHorizonIso,
} from './calendarRecurrence';

const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

describe('wiederkehrende Zusatzaufgaben', () => {
    it('buildRecurringDates wie bisher (Start eingeschlossen, Monatsende begrenzt)', () => {
        expect(buildRecurringDates('2026-12-14', 'weekly', '2026-12-31')).toEqual(['2026-12-14', '2026-12-21', '2026-12-28']);
        expect(buildRecurringDates('2027-01-31', 'monthly', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    });

    it('nextRecurringDate', () => {
        expect(nextRecurringDate('2027-12-27', 'weekly')).toBe('2028-01-03');
        expect(nextRecurringDate('2027-12-20', 'biweekly')).toBe('2028-01-03');
        expect(nextRecurringDate('2027-12-31', 'monthly')).toBe('2028-01-31');
    });

    it('fasst Serien je Titel/Regel/Einheit/Takt zusammen (zwei Wochentage = zwei Serien)', () => {
        const rows = [
            { title: 'Winterdienst', recurrence_rule: 'weekly', assigned_unit_id: null, event_date: '2027-12-20' }, // Montag
            { title: 'Winterdienst', recurrence_rule: 'weekly', assigned_unit_id: null, event_date: '2027-12-27' }, // Montag
            { title: 'Winterdienst', recurrence_rule: 'weekly', assigned_unit_id: null, event_date: '2027-12-30' }, // Donnerstag
            { title: 'winterdienst ', recurrence_rule: 'weekly', assigned_unit_id: 'u1', event_date: '2027-12-27' },
            { title: 'Kaputt', recurrence_rule: 'yearly', event_date: '2027-12-27' }, // unbekannte Regel → ignoriert
        ];
        const series = summarizeRecurringSeries(rows);
        expect(series).toHaveLength(3);
        const mondays = series.find(s => !s.assignedUnitId && s.lastDate === '2027-12-27');
        expect(mondays).toBeTruthy();
        expect(series.some(s => s.lastDate === '2027-12-30')).toBe(true);
    });

    it('nur Serien, die am Jahresende enden, werden fortgeschrieben', () => {
        const atYearEnd = { title: 'A', rule: 'weekly', lastDate: '2027-12-27' };
        const endedMidYear = { title: 'B', rule: 'weekly', lastDate: '2027-06-07' };
        expect(endsAtYearEnd(atYearEnd)).toBe(true);
        expect(endsAtYearEnd(endedMidYear)).toBe(false);
        expect(planSeriesExtension(endedMidYear, { horizonIso: '2028-12-31', todayIso: '2027-11-01' })).toEqual([]);
    });

    it('planSeriesExtension: Folgetermine im bisherigen Takt bis zum Horizont, nur ab heute', () => {
        const s = { title: 'Rasen', rule: 'monthly', lastDate: '2027-12-31' };
        const dates = planSeriesExtension(s, { horizonIso: planHorizonIso(2027), todayIso: '2027-12-01' });
        expect(dates[0]).toBe('2028-01-31');
        expect(dates[1]).toBe('2028-02-29'); // Schaltjahr, Monatsende begrenzt
        expect(dates[dates.length - 1]).toBe('2028-12-31');
        expect(dates).toHaveLength(12);
        // Horizont bereits erreicht → nichts
        expect(planSeriesExtension({ ...s, lastDate: '2028-12-31' }, { horizonIso: '2028-12-31', todayIso: '2027-12-01' })).toEqual([]);
        // Serie endete schon vor heute → keine rückwirkenden Termine
        const late = planSeriesExtension({ title: 'W', rule: 'weekly', lastDate: '2026-12-28' }, { horizonIso: '2028-12-31', todayIso: '2027-03-10' });
        expect(late[0]).toBe('2027-03-15');
        expect(late.every(d => d >= '2027-03-10')).toBe(true);
    });

    it('seriesEndingBefore', () => {
        const list = [
            { title: 'A', rule: 'weekly', lastDate: '2027-12-27' },
            { title: 'B', rule: 'weekly', lastDate: '2027-06-07' },
            { title: 'C', rule: 'weekly', lastDate: '2028-12-25' },
        ];
        expect(seriesEndingBefore(list, '2028-01-15', '2028-12-31').map(s => s.title)).toEqual(['A']);
    });
});

describe('RRULE', () => {
    it('parseRrule: unterstützte und nicht unterstützte Regeln', () => {
        expect(parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU')).toEqual({ freq: 'WEEKLY', interval: 2, count: null, untilIso: null, byDay: [2] });
        expect(parseRrule('FREQ=MONTHLY;COUNT=3').count).toBe(3);
        expect(parseRrule('FREQ=DAILY;UNTIL=20270110').untilIso).toBe('2027-01-10');
        expect(parseRrule('FREQ=MONTHLY;BYDAY=2TU').unsupported).toBe(true);
        expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=15').unsupported).toBe(true);
        expect(parseRrule('FREQ=HOURLY').unsupported).toBe(true);
        expect(parseRrule('FREQ=WEEKLY;BYDAY=2MO').unsupported).toBe(true);
    });

    it('expandRrule: zweiwöchentlich mit UNTIL und EXDATE', () => {
        const rule = parseRrule('FREQ=WEEKLY;INTERVAL=2;UNTIL=20270301');
        const { dates } = expandRrule('2027-01-05', rule, { endIso: '2028-12-31', exdates: new Set(['2027-02-02']) });
        expect(dates).toEqual(['2027-01-05', '2027-01-19', '2027-02-16']);
    });

    it('expandRrule: COUNT zählt ab DTSTART, auch vor dem Importstichtag', () => {
        const rule = parseRrule('FREQ=WEEKLY;COUNT=4');
        const { dates } = expandRrule('2027-01-04', rule, { endIso: '2028-12-31', fromIso: '2027-01-15' });
        expect(dates).toEqual(['2027-01-18', '2027-01-25']);
    });

    it('expandRrule: monatlich am 31. überspringt kürzere Monate (RFC 5545)', () => {
        const { dates } = expandRrule('2027-01-31', parseRrule('FREQ=MONTHLY'), { endIso: '2027-05-31' });
        expect(dates).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
    });

    it('expandRrule: wöchentlich an zwei Tagen', () => {
        const { dates } = expandRrule('2027-01-04', parseRrule('FREQ=WEEKLY;BYDAY=MO,TH;COUNT=5'), { endIso: '2028-12-31' });
        expect(dates).toEqual(['2027-01-04', '2027-01-07', '2027-01-11', '2027-01-14', '2027-01-18']);
    });

    it('expandRrule: Obergrenze', () => {
        const { dates, truncated } = expandRrule('2027-01-01', parseRrule('FREQ=DAILY'), { endIso: '2028-12-31', maxDates: 10 });
        expect(dates).toHaveLength(10);
        expect(truncated).toBe(true);
    });
});

describe('parseIcs', () => {
    it('Einzeltermine wie bisher (gefaltete Zeilen, VALARM, UTC-Zeitpunkt)', () => {
        const text = ics(
            ['UID:1', 'DTSTART;VALUE=DATE:20270105', 'SUMMARY:Restmüll', 'BEGIN:VALARM', 'TRIGGER:-PT12H', 'END:VALARM'],
            ['UID:2', 'DTSTART:20270106T120000Z', 'SUMMARY:Bio', ' tonne'],
        );
        const { events, expandedRules, unsupportedRules } = parseIcs(text, { untilIso: '2028-12-31' });
        expect(events).toEqual([
            { title: 'Restmüll', wasteType: 'restmuell', date: '2027-01-05' },
            { title: 'Biotonne', wasteType: 'bio', date: '2027-01-06' },
        ]);
        expect(expandedRules).toBe(0);
        expect(unsupportedRules).toBe(0);
    });

    it('löst Serien auf, beachtet EXDATE, RECURRENCE-ID und abgesagte Termine', () => {
        const text = ics(
            ['UID:paper', 'DTSTART;TZID=Europe/Berlin:20270104T070000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4', 'EXDATE;TZID=Europe/Berlin:20270118T070000', 'SUMMARY:Papier'],
            // verschobener Einzeltermin der Serie (statt 01.02. am 02.02.)
            ['UID:paper', 'RECURRENCE-ID;TZID=Europe/Berlin:20270201T070000', 'DTSTART;TZID=Europe/Berlin:20270202T070000', 'SUMMARY:Papier'],
            ['UID:x', 'DTSTART;VALUE=DATE:20270110', 'STATUS:CANCELLED', 'SUMMARY:Gelbe Tonne'],
        );
        const { events, expandedRules } = parseIcs(text, { untilIso: '2028-12-31' });
        expect(expandedRules).toBe(1);
        expect(events.map(e => e.date).sort()).toEqual(['2027-01-04', '2027-02-02', '2027-02-15']);
        expect(events.every(e => e.wasteType === 'papier')).toBe(true);
    });

    it('Serien nur bis zum Horizont und ab dem Stichtag', () => {
        const text = ics(['UID:w', 'DTSTART;VALUE=DATE:20261228', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Wertstoff']);
        const { events } = parseIcs(text, { fromIso: '2027-12-01', untilIso: '2027-12-31' });
        expect(events.map(e => e.date)).toEqual(['2027-12-06', '2027-12-13', '2027-12-20', '2027-12-27']);
        expect(events[0].wasteType).toBe('gelbe_tonne');
    });

    it('nicht unterstützte Regel: nur der erste Termin, gezählt', () => {
        const text = ics(['UID:m', 'DTSTART;VALUE=DATE:20270112', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Sperrmüll']);
        const { events, unsupportedRules, expandedRules } = parseIcs(text, { untilIso: '2028-12-31' });
        expect(events.map(e => e.date)).toEqual(['2027-01-12']);
        expect(unsupportedRules).toBe(1);
        expect(expandedRules).toBe(0);
    });

    it('Obergrenze zählt nur künftige Termine', () => {
        const past = ['01', '02', '03', '04', '05'].map(d => [`UID:p${d}`, `DTSTART;VALUE=DATE:202601${d}`, 'SUMMARY:Rest']);
        const pastOnly = parseIcs(ics(...past), { fromIso: '2027-01-01', untilIso: '2028-12-31', maxEvents: 1 });
        expect(pastOnly.truncated).toBe(false);
        expect(pastOnly.events).toHaveLength(5);
        const daily = parseIcs(ics(['UID:d', 'DTSTART;VALUE=DATE:20270101', 'RRULE:FREQ=DAILY', 'SUMMARY:Rest']), { fromIso: '2027-01-01', untilIso: '2028-12-31', maxEvents: 10 });
        expect(daily.truncated).toBe(true);
    });

    it('TZID mit Doppelpunkt im Namen', () => {
        const text = ics(['UID:t', 'DTSTART;TZID="(GMT+01:00) Amsterdam":20270303T063000', 'SUMMARY:Rest']);
        expect(parseIcs(text, { untilIso: '2028-12-31' }).events[0].date).toBe('2027-03-03');
    });
});
