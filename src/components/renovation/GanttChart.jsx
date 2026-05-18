import React, { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, ZoomIn, ZoomOut } from 'lucide-react';

/**
 * Lightweight Gantt chart for renovation project trades.
 * Props:
 *   trades: array of { id, name, start_date, end_date, status, subtrades, depends_on }
 *   onTradeClick: (tradeId) => void
 *   onDateChange: (tradeId, start_date, end_date) => void
 */

const COLORS = {
    open: { bar: '#94a3b8', bg: '#f1f5f9', text: '#475569' },
    in_progress: { bar: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
    completed: { bar: '#16a34a', bg: '#dcfce7', text: '#166534' },
};

const DAY_MS = 86400000;

const GanttChart = ({ trades = [], onTradeClick, onDateChange, isMobile = false }) => {
    const containerRef = useRef(null);
    const [zoomLevel, setZoomLevel] = useState(isMobile ? 1 : 2); // 0=month, 1=2-week, 2=week
    const [viewOffset, setViewOffset] = useState(0); // weeks offset from start

    const zoomConfigs = [
        { label: 'Monat', dayWidth: 8, headerFormat: 'month' },
        { label: '2 Wochen', dayWidth: 16, headerFormat: 'week' },
        { label: 'Woche', dayWidth: 32, headerFormat: 'day' },
    ];
    const zoom = zoomConfigs[zoomLevel];

    /* ─── Date range computation ─── */
    const { startDate, endDate, totalDays, weeks } = useMemo(() => {
        const now = new Date();
        let earliest = new Date(now);
        let latest = new Date(now);
        latest.setMonth(latest.getMonth() + 3);

        trades.forEach(t => {
            if (t.start_date) {
                const s = new Date(t.start_date);
                if (s < earliest) earliest = s;
            }
            if (t.end_date) {
                const e = new Date(t.end_date);
                if (e > latest) latest = e;
            }
        });

        // Start at Monday before earliest
        const start = new Date(earliest);
        start.setDate(start.getDate() - start.getDay() + 1);
        // Extend 2 weeks past latest
        const end = new Date(latest);
        end.setDate(end.getDate() + 14);

        const totalDays = Math.ceil((end - start) / DAY_MS);
        const weekCount = Math.ceil(totalDays / 7);
        const weeks = [];
        for (let i = 0; i < weekCount; i++) {
            const weekStart = new Date(start);
            weekStart.setDate(weekStart.getDate() + i * 7);
            weeks.push(weekStart);
        }

        return { startDate: start, endDate: end, totalDays, weeks };
    }, [trades]);

    const dayToX = (date) => {
        const d = new Date(date);
        const diff = Math.round((d - startDate) / DAY_MS);
        return diff * zoom.dayWidth;
    };

    const totalWidth = totalDays * zoom.dayWidth;
    const ROW_HEIGHT = 40;
    const HEADER_HEIGHT = 50;
    const LABEL_WIDTH = isMobile ? 120 : 200;

    /* ─── Today line ─── */
    const todayX = dayToX(new Date());

    /* ─── Navigate ─── */
    const scroll = (dir) => {
        if (containerRef.current) {
            containerRef.current.scrollLeft += dir * 200;
        }
    };

    /* ─── Format header labels ─── */
    const getWeekLabel = (weekStart) => {
        const dateFormatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
        const monthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });
        if (zoom.headerFormat === 'month') return monthFormatter.format(weekStart);
        return `KW ${getWeekNumber(weekStart)} · ${dateFormatter.format(weekStart)}`;
    };

    const getWeekNumber = (d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        const week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date - week1) / DAY_MS - 3 + (week1.getDay() + 6) % 7) / 7);
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
                    <div style={{ width: totalWidth, minWidth: '100%' }}>
                        {/* Header */}
                        <div style={{ height: HEADER_HEIGHT, display: 'flex', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
                            {weeks.map((w, i) => (
                                <div key={i} style={{
                                    width: 7 * zoom.dayWidth, flexShrink: 0,
                                    borderRight: '1px solid var(--border-color)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500,
                                }}>
                                    {getWeekLabel(w)}
                                </div>
                            ))}
                        </div>

                        {/* Rows */}
                        {trades.map(t => {
                            const col = COLORS[t.status] || COLORS.open;
                            const hasRange = t.start_date && t.end_date;
                            const barLeft = hasRange ? dayToX(t.start_date) : 0;
                            const barWidth = hasRange ? Math.max(dayToX(t.end_date) - barLeft + zoom.dayWidth, zoom.dayWidth * 2) : 0;

                            return (
                                <div key={t.id} style={{ height: ROW_HEIGHT, position: 'relative', borderBottom: '1px solid var(--border-color)' }}>
                                    {/* Week grid lines */}
                                    {weeks.map((w, i) => (
                                        <div key={i} style={{
                                            position: 'absolute', left: i * 7 * zoom.dayWidth, top: 0,
                                            width: 7 * zoom.dayWidth, height: '100%',
                                            borderRight: '1px solid var(--border-color)',
                                            background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                                        }} />
                                    ))}

                                    {/* Bar */}
                                    {hasRange && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left: barLeft, top: 8,
                                                width: barWidth, height: ROW_HEIGHT - 16,
                                                borderRadius: '6px',
                                                background: `linear-gradient(135deg, ${col.bar}, ${col.bar}dd)`,
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.7rem', fontWeight: 700, color: '#fff',
                                                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                padding: '0 6px',
                                                cursor: 'pointer',
                                                transition: 'opacity 0.15s',
                                            }}
                                            onClick={() => onTradeClick?.(t.id)}
                                            title={`${t.name}: ${new Date(t.start_date).toLocaleDateString('de-DE')} – ${new Date(t.end_date).toLocaleDateString('de-DE')}`}
                                        >
                                            {barWidth > 60 ? t.name : ''}
                                        </div>
                                    )}

                                    {/* No-date placeholder */}
                                    {!hasRange && (
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
                            position: 'absolute', left: todayX - 18, top: 2,
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
