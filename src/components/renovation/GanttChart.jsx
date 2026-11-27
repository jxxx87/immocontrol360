import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, ZoomIn, ZoomOut } from 'lucide-react';
import { parseLocalDate, calendarDayDiff, formatDateDE } from './renovationUtils';

/**
 * Lightweight Gantt chart for renovation project trades.
 * Props:
 *   trades: array of { id, name, start_date, end_date, status }
 *   onTradeClick: (tradeId) => void
 *   isMobile: boolean
 *
 * Datumswerte (Typ date, 'YYYY-MM-DD') werden als lokale Kalendertage behandelt;
 * Abstände werden in Kalendertagen gerechnet (keine Verschiebung durch UTC/Uhrzeit).
 */

const COLORS = {
    open: { bar: '#94a3b8', bg: '#f1f5f9', text: '#475569' },
    in_progress: { bar: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
    completed: { bar: '#16a34a', bg: '#dcfce7', text: '#166534' },
};

// Darstellungszeitraum begrenzen: ein Tippfehler im Jahr (z. B. 2062) erzeugt sonst
// eine extrem breite Fläche. Max. 2 Jahre zurück und 3 Jahre voraus (ab heute).
const MAX_PAST_DAYS = 2 * 366;
const MAX_FUTURE_DAYS = 3 * 366;

const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const ZOOM_CONFIGS = [
    { label: 'Monat', dayWidth: 8, headerFormat: 'month' },
    { label: '2 Wochen', dayWidth: 16, headerFormat: 'week' },
    { label: 'Woche', dayWidth: 32, headerFormat: 'day' },
];

const getWeekNumber = (d) => {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round((calendarDayDiff(week1, date) - 3 + (week1.getDay() + 6) % 7) / 7);
};

const dateFormatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const monthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });

const GanttChart = ({ trades = [], onTradeClick, isMobile = false }) => {
    const containerRef = useRef(null);
    const [zoomLevel, setZoomLevel] = useState(isMobile ? 1 : 2); // 0=month, 1=2-week, 2=week
    const zoom = ZOOM_CONFIGS[zoomLevel];

    /* ─── Date range computation ─── */
    const { today, startDate, totalDays, weeks } = useMemo(() => {
        const todayLocal = parseLocalDate(new Date());
        let earliest = todayLocal;
        let latest = addDays(todayLocal, 0);
        latest.setMonth(latest.getMonth() + 3);

        trades.forEach(t => {
            const s = parseLocalDate(t.start_date);
            const e = parseLocalDate(t.end_date);
            [s, e].forEach(d => {
                if (!d) return;
                if (d < earliest) earliest = d;
                if (d > latest) latest = d;
            });
        });

        // Zeitraum begrenzen
        const minStart = addDays(todayLocal, -MAX_PAST_DAYS);
        const maxEnd = addDays(todayLocal, MAX_FUTURE_DAYS);
        if (earliest < minStart) earliest = minStart;
        if (latest > maxEnd) latest = maxEnd;

        // Start at Monday on/before earliest (Sonntag: 6 Tage zurück, nicht 1 Tag vor)
        const start = addDays(earliest, -((earliest.getDay() + 6) % 7));
        // Extend 2 weeks past latest
        const end = addDays(latest, 14);

        const days = calendarDayDiff(start, end) + 1;
        const weekCount = Math.ceil(days / 7);
        const weekStarts = [];
        for (let i = 0; i < weekCount; i++) {
            weekStarts.push(addDays(start, i * 7));
        }

        return { today: todayLocal, startDate: start, totalDays: weekCount * 7, weeks: weekStarts };
    }, [trades]);

    const dayToX = (date) => calendarDayDiff(startDate, date) * zoom.dayWidth;

    const totalWidth = totalDays * zoom.dayWidth;
    const ROW_HEIGHT = 40;
    const HEADER_HEIGHT = 50;
    const LABEL_WIDTH = isMobile ? 120 : 200;

    /* ─── Today line ─── */
    const todayX = dayToX(today);

    /* ─── Beim Öffnen und beim Zoomen zu "Heute" scrollen ─── */
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
    }, [todayX]);

    /* ─── Navigate ─── */
    const scroll = (dir) => {
        if (containerRef.current) {
            containerRef.current.scrollLeft += dir * 200;
        }
    };

    /* ─── Format header labels ─── */
    const getWeekLabel = (weekStart, i) => {
        if (zoom.headerFormat === 'month') {
            // Monatslabel nur in der ersten Woche eines Monats
            const prev = i > 0 ? weeks[i - 1] : null;
            if (prev && prev.getMonth() === weekStart.getMonth()) return '';
            return monthFormatter.format(weekStart);
        }
        return `KW ${getWeekNumber(weekStart)} · ${dateFormatter.format(weekStart)}`;
    };

    /* ─── Bar geometry per trade ─── */
    const getBar = (t) => {
        const s = parseLocalDate(t.start_date);
        const e = parseLocalDate(t.end_date);
        if (!s || !e) return { kind: 'none' };
        if (e < s) {
            const x = Math.min(Math.max(0, dayToX(s)), Math.max(0, totalWidth - zoom.dayWidth * 3));
            return { kind: 'invalid', left: x, s, e };
        }
        // Ende inklusive: ein Gewerk mit Start = Ende ist genau einen Tag breit
        const rawLeft = dayToX(s);
        const rawRight = dayToX(e) + zoom.dayWidth;
        const left = Math.max(0, rawLeft);
        const right = Math.min(totalWidth, rawRight);
        if (right <= left) {
            return { kind: 'outside', left: rawRight <= 0 ? 0 : Math.max(0, totalWidth - 20), s, e };
        }
        return { kind: 'bar', left, width: right - left, clipped: left !== rawLeft || right !== rawRight, s, e };
    };

    return (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--surface-color)' }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderBottom: '1px solid var(--border-color)',
                background: 'var(--background-color)', fontSize: '0.82rem',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={16} color="#0ea5e9" />
                    <span style={{ fontWeight: 700 }}>Bauzeitenplan</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button onClick={() => scroll(-1)} style={btnStyle} title="Links scrollen"><ChevronLeft size={16} /></button>
                    <button onClick={() => scroll(1)} style={btnStyle} title="Rechts scrollen"><ChevronRight size={16} /></button>
                    <span style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 4px' }} />
                    <button onClick={() => setZoomLevel(Math.max(0, zoomLevel - 1))} disabled={zoomLevel === 0} style={btnStyle} title="Weniger Zoom"><ZoomOut size={16} /></button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '60px', textAlign: 'center' }}>{zoom.label}</span>
                    <button onClick={() => setZoomLevel(Math.min(2, zoomLevel + 1))} disabled={zoomLevel === 2} style={btnStyle} title="Mehr Zoom"><ZoomIn size={16} /></button>
                </div>
            </div>

            <div style={{ display: 'flex', overflow: 'hidden' }}>
                {/* Fixed Labels */}
                <div style={{ width: LABEL_WIDTH, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--background-color)' }}>
                    <div style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Gewerk
                    </div>
                    {trades.map(t => (
                        <div
                            key={t.id}
                            onClick={() => onTradeClick?.(t.id)}
                            style={{
                                height: ROW_HEIGHT, display: 'flex', alignItems: 'center',
                                padding: '0 10px', fontSize: '0.82rem', fontWeight: 600,
                                borderBottom: '1px solid var(--border-color)',
                                cursor: onTradeClick ? 'pointer' : 'default',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={t.name}
                        >
                            {t.name}
                        </div>
                    ))}
                </div>

                {/* Scrollable Gantt Area */}
                <div ref={containerRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}>
                    <div style={{ width: totalWidth, minWidth: '100%', position: 'relative' }}>
                        {/* Header */}
                        <div style={{ height: HEADER_HEIGHT, display: 'flex', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
                            {weeks.map((w, i) => (
                                <div key={i} style={{
                                    width: 7 * zoom.dayWidth, flexShrink: 0,
                                    borderRight: '1px solid var(--border-color)',
                                    display: 'flex', alignItems: 'center', justifyContent: zoom.headerFormat === 'month' ? 'flex-start' : 'center',
                                    fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500,
                                    whiteSpace: 'nowrap', overflow: 'visible', paddingLeft: zoom.headerFormat === 'month' ? '3px' : 0,
                                }}>
                                    {getWeekLabel(w, i)}
                                </div>
                            ))}
                        </div>

                        {/* Week grid lines (einmalig für alle Zeilen) */}
                        <div style={{ position: 'absolute', left: 0, top: HEADER_HEIGHT, width: totalWidth, height: trades.length * ROW_HEIGHT, pointerEvents: 'none' }}>
                            {weeks.map((w, i) => (
                                <div key={i} style={{
                                    position: 'absolute', left: i * 7 * zoom.dayWidth, top: 0,
                                    width: 7 * zoom.dayWidth, height: '100%',
                                    borderRight: '1px solid var(--border-color)',
                                    background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                                }} />
                            ))}
                        </div>

                        {/* Rows */}
                        {trades.map(t => {
                            const col = COLORS[t.status] || COLORS.open;
                            const bar = getBar(t);

                            return (
                                <div key={t.id} style={{ height: ROW_HEIGHT, position: 'relative', borderBottom: '1px solid var(--border-color)' }}>
                                    {/* Bar */}
                                    {bar.kind === 'bar' && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left: bar.left, top: 8,
                                                width: bar.width, height: ROW_HEIGHT - 16,
                                                borderRadius: '6px',
                                                background: `linear-gradient(135deg, ${col.bar}, ${col.bar}dd)`,
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.7rem', fontWeight: 700, color: '#fff',
                                                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                padding: '0 6px',
                                                cursor: 'pointer',
                                                transition: 'opacity 0.15s',
                                                borderStyle: bar.clipped ? 'dashed' : 'none',
                                                borderWidth: bar.clipped ? '1px' : 0,
                                                borderColor: '#fff',
                                            }}
                                            onClick={() => onTradeClick?.(t.id)}
                                            title={`${t.name}: ${formatDateDE(t.start_date)} – ${formatDateDE(t.end_date)}${bar.clipped ? ' (teilweise außerhalb des dargestellten Zeitraums)' : ''}`}
                                        >
                                            {bar.width > 60 ? t.name : ''}
                                        </div>
                                    )}

                                    {/* Ungültiger Zeitraum: Ende vor Start */}
                                    {bar.kind === 'invalid' && (
                                        <div
                                            onClick={() => onTradeClick?.(t.id)}
                                            title={`${t.name}: Enddatum (${formatDateDE(t.end_date)}) liegt vor dem Startdatum (${formatDateDE(t.start_date)})`}
                                            style={{
                                                position: 'absolute', left: bar.left, top: 8, height: ROW_HEIGHT - 16,
                                                padding: '0 8px', borderRadius: '6px', border: '1px dashed #dc2626',
                                                background: '#fef2f2', color: '#dc2626', fontSize: '0.68rem', fontWeight: 700,
                                                display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', cursor: 'pointer',
                                            }}
                                        >
                                            Ende vor Start
                                        </div>
                                    )}

                                    {/* Zeitraum komplett außerhalb des dargestellten Bereichs */}
                                    {bar.kind === 'outside' && (
                                        <div
                                            title={`${t.name}: ${formatDateDE(t.start_date)} – ${formatDateDE(t.end_date)} (außerhalb des dargestellten Zeitraums)`}
                                            style={{
                                                position: 'absolute', left: bar.left, top: ROW_HEIGHT / 2 - 2,
                                                width: '20px', height: '4px', borderRadius: '2px',
                                                border: '1px dashed var(--text-secondary)',
                                            }}
                                        />
                                    )}

                                    {/* No-date placeholder */}
                                    {bar.kind === 'none' && (
                                        <div style={{
                                            position: 'absolute', left: todayX, top: ROW_HEIGHT / 2 - 1,
                                            width: '20px', height: '3px', borderRadius: '2px',
                                            background: 'var(--border-color)',
                                        }} />
                                    )}
                                </div>
                            );
                        })}

                        {/* Today line */}
                        <div style={{
                            position: 'absolute', left: todayX, top: 0,
                            width: '2px', height: HEADER_HEIGHT + trades.length * ROW_HEIGHT,
                            background: '#ef4444', opacity: 0.6, zIndex: 5,
                            pointerEvents: 'none',
                        }} />
                        <div style={{
                            position: 'absolute', left: Math.max(0, todayX - 18), top: 2,
                            fontSize: '0.62rem', fontWeight: 700, color: '#ef4444',
                            background: '#fef2f2', padding: '1px 4px', borderRadius: '3px',
                            zIndex: 6, pointerEvents: 'none',
                        }}>
                            Heute
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: '16px', padding: '8px 12px', borderTop: '1px solid var(--border-color)', fontSize: '0.72rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                {Object.entries(COLORS).map(([key, val]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: val.bar }} />
                        {{ open: 'Offen', in_progress: 'In Arbeit', completed: 'Fertig' }[key]}
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '12px', height: '2px', background: '#ef4444' }} />
                    Heute
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '12px', height: '10px', borderRadius: '3px', border: '1px dashed #dc2626', background: '#fef2f2' }} />
                    Ende vor Start
                </div>
            </div>
        </div>
    );
};

const btnStyle = {
    background: 'none', border: '1px solid var(--border-color)',
    borderRadius: '4px', padding: '4px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', color: 'var(--text-secondary)',
};

export default GanttChart;
