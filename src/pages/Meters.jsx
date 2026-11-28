import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import { Plus, Zap, Droplets, Flame, MoreHorizontal, Filter, Loader2, Gauge, Trash2, Edit2, Search, MoreVertical, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';
import { translateError } from '../lib/errorTranslator';

// Kennzeichnung des Anfangsstands nach einem Zählerwechsel (Notiz-Präfix, ohne Schemaänderung)
const METER_SWAP_NOTE = 'Zählerwechsel:';
const READ_ONLY_HINT = 'Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Zähler und Zählerstände können nur mit Schreibrecht „Zähler“ angelegt, geändert oder gelöscht werden.';
const HISTORY_PAGE = 50;

// Lokales Datum (toISOString() wäre UTC und liefert nachts den Vortag)
const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isIsoDate = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const fmtDate = (iso) => {
    if (!iso) return '-';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('de-DE');
};
const fmtNumber = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '-' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 6 }));
const parseNumber = (v) => {
    const s = String(v ?? '').trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
const isSwapStart = (r) => typeof r?.note === 'string' && r.note.startsWith(METER_SWAP_NOTE);
const sortReadingsDesc = (a, b) => b.reading_date.localeCompare(a.reading_date) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
const emptyReadingForm = () => ({ value: '', date: localToday(), note: '', isSwap: false, oldFinalValue: '', newMeterNumber: '' });

// Plausibilität gegen die zeitlich benachbarten Stände (kleiner als der vorherige bzw. größer als der spätere Stand)
const readingWarnings = (readings, date, value, unit, excludeId) => {
    const others = readings.filter(r => r.id !== excludeId);
    const prev = others.filter(r => r.reading_date < date).sort(sortReadingsDesc)[0];
    const next = others.filter(r => r.reading_date > date).sort(sortReadingsDesc).pop();
    const warnings = [];
    if (prev && value < Number(prev.reading_value)) {
        warnings.push(`Der Wert ist kleiner als der vorherige Stand vom ${fmtDate(prev.reading_date)} (${fmtNumber(prev.reading_value)} ${unit}).`);
    }
    if (next && !isSwapStart(next) && value > Number(next.reading_value)) {
        warnings.push(`Der Wert ist größer als der spätere Stand vom ${fmtDate(next.reading_date)} (${fmtNumber(next.reading_value)} ${unit}).`);
    }
    return warnings;
};

// Der Live-Trigger setzt meters.last_reading_* nur beim Einfügen (und nur vorwärts). Nach Korrektur
// oder Löschung eines Stands wird der letzte Stand hier aus der Historie neu ermittelt; ein künftiger
// Trigger, der das selbst erledigt, kommt zum gleichen Ergebnis.
const recalcLastReading = async (meterId) => {
    const { data, error } = await supabase
        .from('meter_readings')
        .select('reading_value, reading_date')
        .eq('meter_id', meterId)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1);
    if (error) return error;
    const top = data?.[0] || null;
    const { error: updateError } = await supabase
        .from('meters')
        .update({ last_reading_value: top ? top.reading_value : null, last_reading_date: top ? top.reading_date : null, updated_at: new Date().toISOString() })
        .eq('id', meterId);
    return updateError || null;
};

// onReading/onEdit/onDelete fehlen bei Freigabe nur zum Lesen (dann nur „Historie“)
const ActionMenu =({ onEdit, onDelete, onHistory, onReading }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);
    const contentRef = useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            // Check if click is outside BOTH the trigger button (menuRef) AND the portal content (contentRef)
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);

            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);

            // Calculate Position
            // Use fixed position relative to viewport, so we don't need scrollY if we use fixed.
            // But if user scrolls while menu is open, we want it to stick or close?
            // Usually fixed menus stay put on screen.
            // Let's use getBoundingClientRect which is relative to viewport.
            if (menuRef.current) {
                const rect = menuRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed',
                    top: `${rect.bottom + 5}px`, // Fixed is viewport relative
                    left: `${rect.right - 160}px`,
                    zIndex: 9999
                });
            }
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Use Portal to render outside of table overflow
    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '160px',
                overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()} // Stop bubbling to prevent immediate close if table row has click handlers
        >
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px' }}>
                {onReading && <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onReading(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Plus size={16} /> Stand erfassen
                </button>}
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onHistory(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <FileText size={16} /> Historie
                </button>
                {onEdit && <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onEdit(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Edit2 size={16} /> Bearbeiten
                </button>}
                {onDelete && <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />}
                {onDelete && <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onDelete(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--danger-color)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Trash2 size={16} /> Löschen
                </button>}
                {!onReading && !onEdit && !onDelete && (
                    <div style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Nur lesen (Freigabe)</div>
                )}
            </div>
        </div>
    );

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} />
            {isOpen && createPortal(MenuContent, document.body)}
        </div>
    );
};

const Meters = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const perm = usePermission();

    // Schreibrecht „Zähler“ im Portfolio des Zählers (wie die RLS von meters/meter_readings); ohne Portfolio:
    // aktueller Bereich. Während die Rechte laden, optimistisch; die Datenbank prüft zusätzlich.
    const canWriteMeters = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite('zaehler', portfolioId) : perm.canWrite('zaehler');
    };
    const canCreateMeters = canWriteMeters(selectedPortfolioID || null);

    // Data State
    const [meters, setMeters] = useState([]);
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const fetchSeq = useRef(0);
    const unitsSeq = useRef(0);
    const historySeq = useRef(0);

    // Filter State
    const [filters, setFilters] = useState({
        propertyId: '',
        meterType: 'all',
        search: ''
    });

    // Modal State
    const [isMeterModalOpen, setIsMeterModalOpen] = useState(false);
    const [editingMeter, setEditingMeter] = useState(null);
    const [meterForm, setMeterForm] = useState({
        property_id: '',
        unit_id: '', // nullable (null = Property Level)
        meter_number: '',
        meter_type: 'Strom',
        unit: 'kWh',
        meter_name: '',
        location: '',
        supplier: '',
        contract_number: '',
        notes: ''
    });

    // Reading Modal State
    const [isReadingModalOpen, setIsReadingModalOpen] = useState(false);
    const [readingMeter, setReadingMeter] = useState(null);
    const [readingForm, setReadingForm] = useState(emptyReadingForm);

    // Detail Modal State
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [detailMeter, setDetailMeter] = useState(null);
    const [readingsHistory, setReadingsHistory] = useState([]);
    const [historyOlder, setHistoryOlder] = useState(null); // nächstälterer Stand (nur für die Verbrauchsberechnung)
    const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [editingReadingId, setEditingReadingId] = useState(null);
    const [readingEdit, setReadingEdit] = useState({ value: '', date: '', note: '' });

    // --- DATA FETCHING ---
    const fetchData = React.useCallback(async () => {
        if (!user) return;
        const seq = ++fetchSeq.current;
        setLoading(true);

        try {
            // 1. Fetch Meters
            let meterQuery = supabase
                .from('meters')
                .select(`
                    *,
                    property:properties(id, street, house_number, city),
                    unit_ref:units(id, unit_name, floor)
                `)
                .order('created_at', { ascending: false });

            if (selectedPortfolioID) meterQuery = meterQuery.eq('portfolio_id', selectedPortfolioID);

            // 2. Fetch Properties for filters/dropdowns
            let propQuery = supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id')
                .order('street');

            if (selectedPortfolioID) propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);

            const [{ data: meterData, error: meterError }, { data: propData, error: propError }] = await Promise.all([meterQuery, propQuery]);
            // Veraltete Antwort (Portfolio inzwischen gewechselt) verwerfen
            if (seq !== fetchSeq.current) return;

            const errors = [];
            if (meterError) {
                console.error('Error fetching meters:', meterError);
                errors.push(`Zähler: ${translateError(meterError)}`);
                setMeters([]);
            } else {
                setMeters(meterData || []);
            }
            if (propError) {
                console.error('Error fetching properties:', propError);
                errors.push(`Immobilien: ${translateError(propError)}`);
                setProperties([]);
            } else {
                setProperties(propData || []);
            }
            setLoadError(errors.length ? errors.join(' · ') : null);

        } catch (error) {
            if (seq !== fetchSeq.current) return;
            console.error('Unexpected error fetching data:', error);
            setLoadError(translateError(error));
        } finally {
            if (seq === fetchSeq.current) setLoading(false);
        }
    }, [user, selectedPortfolioID]);

    useEffect(() => {
        setFilters({
            propertyId: '',
            meterType: 'all',
            search: ''
        });
        fetchData();
    }, [user, selectedPortfolioID, fetchData]);

    // Fetch units for a specific property (for Modal dropdown)
    const fetchUnitsForProperty = async (propertyId) => {
        const seq = ++unitsSeq.current;
        if (!propertyId) {
            setUnits([]);
            return;
        }
        const { data, error } = await supabase.from('units').select('id, unit_name, floor').eq('property_id', propertyId).order('unit_name');
        // Nur die Antwort zur zuletzt gewählten Immobilie übernehmen
        if (seq !== unitsSeq.current) return;
        if (error) console.error('Error fetching units:', error);
        setUnits(data || []);
    };

    // Use effect to load units when form property changes
    useEffect(() => {
        if (isMeterModalOpen && meterForm.property_id) {
            fetchUnitsForProperty(meterForm.property_id);
        } else if (!meterForm.property_id) {
            unitsSeq.current++;
            setUnits([]);
        }
    }, [meterForm.property_id, isMeterModalOpen]);

    // --- COMPUTED / FILTERED DATA ---
    const filteredMeters = meters.filter(m => {
        // Portfolio filter already applied in query
        if (filters.propertyId && m.property_id !== filters.propertyId) return false;
        if (filters.meterType !== 'all' && m.meter_type !== filters.meterType) return false;
        if (filters.search) {
            const term = filters.search.toLowerCase();
            return (
                (m.meter_number || '').toLowerCase().includes(term) ||
                (m.meter_name || '').toLowerCase().includes(term) ||
                (m.supplier || '').toLowerCase().includes(term) ||
                (m.location || '').toLowerCase().includes(term) ||
                (m.contract_number || '').toLowerCase().includes(term) ||
                (m.notes || '').toLowerCase().includes(term) ||
                // Search in Property
                (m.property?.street || '').toLowerCase().includes(term) ||
                (m.property?.city || '').toLowerCase().includes(term) ||
                // Search in Unit
                (m.unit_ref?.unit_name || '').toLowerCase().includes(term)
            );
        }
        return true;
    });

    // --- ACTIONS ---

    const handleOpenAdd = () => {
        if (!canCreateMeters) return alert(READ_ONLY_HINT);
        setEditingMeter(null);
        setMeterForm({
            property_id: '',
            unit_id: '',
            meter_number: '',
            meter_type: 'Strom',
            unit: 'kWh',
            meter_name: '',
            location: '',
            supplier: '',
            contract_number: '',
            notes: ''
        });
        setUnits([]);
        setIsMeterModalOpen(true);
    };

    const handleOpenEdit = (meter) => {
        if (!canWriteMeters(meter.portfolio_id)) return alert(READ_ONLY_HINT);
        setEditingMeter(meter);
        setMeterForm({
            property_id: meter.property_id,
            unit_id: meter.unit_id || '',
            meter_number: meter.meter_number,
            meter_type: meter.meter_type,
            unit: meter.unit,
            meter_name: meter.meter_name || '',
            location: meter.location || '',
            supplier: meter.supplier || '',
            contract_number: meter.contract_number || '',
            notes: meter.notes || ''
        });
        setIsMeterModalOpen(true);
    };

    const handleSaveMeter = async () => {
        if (isSaving) return;
        // Validation
        if (!meterForm.property_id) return alert('Bitte wählen Sie eine Immobilie.');
        const meterNumber = String(meterForm.meter_number || '').trim();
        if (!meterNumber) return alert('Bitte geben Sie eine Zählernummer ein.');
        const targetPortfolioId = properties.find(p => p.id === meterForm.property_id)?.portfolio_id || null;
        if ((editingMeter && !canWriteMeters(editingMeter.portfolio_id)) || !canWriteMeters(targetPortfolioId)) {
            return alert(READ_ONLY_HINT);
        }

        try {
            setIsSaving(true);

            // portfolio_id always comes from the chosen property (selectedPortfolioID may be empty = "Alle")
            const selectedProp = properties.find(p => p.id === meterForm.property_id);
            if (!selectedProp) throw new Error('Immobilie nicht gefunden');

            const values = {
                portfolio_id: selectedProp.portfolio_id, // ensure correct mapping
                property_id: meterForm.property_id,
                unit_id: meterForm.unit_id || null,
                meter_number: meterNumber,
                meter_type: meterForm.meter_type,
                unit: meterForm.unit,
                meter_name: meterForm.meter_name,
                location: meterForm.location,
                supplier: meterForm.supplier,
                contract_number: meterForm.contract_number,
                notes: meterForm.notes
            };

            if (editingMeter) {
                // user_id (Eigentümer der Zeile) bleibt beim Bearbeiten unverändert
                const { data: updated, error } = await supabase
                    .from('meters')
                    .update({ ...values, updated_at: new Date().toISOString() })
                    .eq('id', editingMeter.id)
                    .select('id');
                if (error) throw error;
                if (!updated?.length) throw new Error('Der Zähler konnte nicht gespeichert werden (keine Berechtigung).');

                // Erfasste Stände folgen dem Zähler in ein anderes Portfolio (Rechte/Auswertungen bleiben konsistent)
                if (editingMeter.portfolio_id && editingMeter.portfolio_id !== values.portfolio_id) {
                    const { error: readingsError } = await supabase
                        .from('meter_readings')
                        .update({ portfolio_id: values.portfolio_id })
                        .eq('meter_id', editingMeter.id);
                    if (readingsError) {
                        alert(`Der Zähler wurde gespeichert, die erfassten Stände konnten aber nicht dem neuen Portfolio zugeordnet werden: ${translateError(readingsError)}`);
                    }
                }
            } else {
                const { error } = await supabase
                    .from('meters')
                    .insert([{ ...values, user_id: user.id }]);
                if (error) throw error;
            }

            setIsMeterModalOpen(false);
            fetchData(); // Reload table

        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteMeter = async (meter) => {
        if (isSaving) return;
        if (!canWriteMeters(meter.portfolio_id)) return alert(READ_ONLY_HINT);
        if (!window.confirm('Möchten Sie diesen Zähler wirklich löschen? Alle erfassten Stände werden ebenfalls gelöscht.')) return;
        try {
            setIsSaving(true); // show generic saving overlay
            const { error } = await supabase.from('meters').delete().eq('id', meter.id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // --- READING ACTIONS ---
    const handleOpenReading = (meter) => {
        if (!canWriteMeters(meter.portfolio_id)) return alert(READ_ONLY_HINT);
        setReadingMeter(meter);
        setReadingForm(emptyReadingForm());
        setIsReadingModalOpen(true);
    };

    const handleSaveReading = async () => {
        if (isSaving || !readingMeter) return;
        if (!canWriteMeters(readingMeter.portfolio_id)) return alert(READ_ONLY_HINT);
        const isSwap = !!readingForm.isSwap;
        const unit = readingMeter.unit || '';
        const value = parseNumber(readingForm.value);
        if (value === null) return alert(isSwap ? 'Bitte den Anfangsstand des neuen Zählers eingeben.' : 'Bitte Zählerstand eingeben.');
        if (value < 0) return alert('Der Zählerstand darf nicht negativ sein.');
        if (!isIsoDate(readingForm.date)) return alert('Bitte ein gültiges Ablesedatum eingeben.');
        if (readingForm.date > localToday()) return alert('Das Ablesedatum darf nicht in der Zukunft liegen.');
        let oldFinal = null;
        if (isSwap && String(readingForm.oldFinalValue ?? '').trim() !== '') {
            oldFinal = parseNumber(readingForm.oldFinalValue);
            if (oldFinal === null || oldFinal < 0) return alert('Bitte einen gültigen Endstand des alten Zählers eingeben.');
        }
        const newMeterNumber = isSwap ? String(readingForm.newMeterNumber || '').trim() : '';
        const note = String(readingForm.note || '').trim();

        try {
            setIsSaving(true);

            // Plausibilität gegen die bereits erfassten Stände prüfen
            const { data: existing, error: existingError } = await supabase
                .from('meter_readings')
                .select('id, reading_value, reading_date, note, created_at')
                .eq('meter_id', readingMeter.id)
                .order('reading_date', { ascending: false })
                .limit(1000);
            if (existingError) throw existingError;
            const known = existing || [];

            if (!isSwap && known.some(r => r.reading_date === readingForm.date)) {
                alert(`Für den ${fmtDate(readingForm.date)} ist bereits ein Zählerstand erfasst. Bitte korrigieren Sie ihn in der Historie oder wählen Sie ein anderes Datum.`);
                return;
            }
            const warnings = isSwap
                ? (oldFinal !== null ? readingWarnings(known, readingForm.date, oldFinal, unit).map(w => `Endstand alter Zähler: ${w}`) : [])
                : readingWarnings(known, readingForm.date, value, unit);
            if (warnings.length) {
                const hint = isSwap ? '' : 'Wurde der Zähler getauscht, nutzen Sie bitte die Option „Zählerwechsel“.\n\n';
                if (!window.confirm(`${warnings.join('\n')}\n\n${hint}Trotzdem speichern (z. B. bei Zählerüberlauf)?`)) return;
            }

            const base = {
                meter_id: readingMeter.id,
                user_id: user.id,
                portfolio_id: readingMeter.portfolio_id,
                reading_date: readingForm.date
            };

            if (isSwap) {
                const oldNumber = readingMeter.meter_number || '';
                // Zwei getrennte Requests: der Anfangsstand des neuen Zählers muss der jüngere Eintrag sein
                if (oldFinal !== null) {
                    const { error } = await supabase.from('meter_readings').insert([{ ...base, reading_value: oldFinal, note: `Endstand alter Zähler${oldNumber ? ` Nr. ${oldNumber}` : ''}` }]);
                    if (error) throw error;
                }
                const swapNote = `${METER_SWAP_NOTE} neuer Zähler${newMeterNumber ? ` Nr. ${newMeterNumber}` : ''}${note ? ` – ${note}` : ''}`;
                const { error: startError } = await supabase.from('meter_readings').insert([{ ...base, reading_value: value, note: swapNote }]);
                if (startError) {
                    alert(oldFinal !== null
                        ? `Der Endstand des alten Zählers wurde gespeichert, der Anfangsstand des neuen Zählers aber nicht: ${translateError(startError)}`
                        : translateError(startError));
                    // Bei erneutem Speichern den bereits gespeicherten Endstand nicht doppelt anlegen
                    if (oldFinal !== null) setReadingForm(f => ({ ...f, oldFinalValue: '' }));
                    fetchData();
                    return;
                }
                if (newMeterNumber && newMeterNumber !== oldNumber) {
                    const swapInfo = `Zählerwechsel am ${fmtDate(readingForm.date)}: Nr. ${oldNumber || '–'} → Nr. ${newMeterNumber}`;
                    const { error: meterError } = await supabase
                        .from('meters')
                        .update({ meter_number: newMeterNumber, notes: readingMeter.notes ? `${readingMeter.notes}\n${swapInfo}` : swapInfo, updated_at: new Date().toISOString() })
                        .eq('id', readingMeter.id);
                    if (meterError) alert(`Die Stände wurden gespeichert, die neue Zählernummer konnte aber nicht übernommen werden: ${translateError(meterError)}`);
                }
            } else {
                const { error } = await supabase.from('meter_readings').insert([{ ...base, reading_value: value, note: note || null }]);
                if (error) throw error;
            }

            setIsReadingModalOpen(false);
            // Trigger auto-updates last_reading on meters table via DB trigger, but we need to reload UI
            fetchData();

        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // --- DETAIL ACTIONS ---
    const loadHistory = async (meterId, limit) => {
        const seq = ++historySeq.current;
        setLoadingHistory(true);
        setHistoryError(null);
        try {
            const { data, error } = await supabase
                .from('meter_readings')
                .select('id, meter_id, reading_value, reading_date, note, created_at')
                .eq('meter_id', meterId)
                .order('reading_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(limit + 1);
            // Antwort zu einem inzwischen anderen Zähler verwerfen
            if (seq !== historySeq.current) return;
            if (error) throw error;
            const rows = data || [];
            setReadingsHistory(rows.slice(0, limit));
            setHistoryOlder(rows[limit] || null);
            setHistoryHasMore(rows.length > limit);
        } catch (error) {
            if (seq !== historySeq.current) return;
            console.error(error);
            setReadingsHistory([]);
            setHistoryOlder(null);
            setHistoryHasMore(false);
            setHistoryError(translateError(error));
        } finally {
            if (seq === historySeq.current) setLoadingHistory(false);
        }
    };

    const handleOpenDetail = (meter) => {
        setDetailMeter(meter);
        setIsDetailModalOpen(true);
        setReadingsHistory([]);
        setHistoryOlder(null);
        setHistoryHasMore(false);
        setEditingReadingId(null);
        setHistoryLimit(HISTORY_PAGE);
        loadHistory(meter.id, HISTORY_PAGE);
    };

    const handleCloseDetail = () => {
        historySeq.current++;
        setIsDetailModalOpen(false);
        setEditingReadingId(null);
    };

    const handleLoadMoreHistory = () => {
        if (!detailMeter) return;
        const next = historyLimit + HISTORY_PAGE;
        setHistoryLimit(next);
        loadHistory(detailMeter.id, next);
    };

    const handleStartEditReading = (r) => {
        if (!canWriteMeters(detailMeter?.portfolio_id)) return alert(READ_ONLY_HINT);
        setEditingReadingId(r.id);
        setReadingEdit({ value: r.reading_value != null ? String(r.reading_value) : '', date: r.reading_date || '', note: r.note || '' });
    };

    const handleSaveReadingEdit = async (r) => {
        if (historyBusy || !detailMeter) return;
        if (!canWriteMeters(detailMeter.portfolio_id)) return alert(READ_ONLY_HINT);
        const value = parseNumber(readingEdit.value);
        if (value === null) return alert('Bitte einen gültigen Zählerstand eingeben.');
        if (value < 0) return alert('Der Zählerstand darf nicht negativ sein.');
        if (!isIsoDate(readingEdit.date)) return alert('Bitte ein gültiges Ablesedatum eingeben.');
        if (readingEdit.date > localToday()) return alert('Das Ablesedatum darf nicht in der Zukunft liegen.');
        const note = String(readingEdit.note || '').trim();

        const known = historyOlder ? [...readingsHistory, historyOlder] : readingsHistory;
        const warnings = isSwapStart({ note }) ? [] : readingWarnings(known, readingEdit.date, value, detailMeter.unit || '', r.id);
        if (known.some(x => x.id !== r.id && x.reading_date === readingEdit.date)) {
            warnings.unshift(`Für den ${fmtDate(readingEdit.date)} ist bereits ein weiterer Stand erfasst.`);
        }
        if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nTrotzdem speichern?`)) return;

        setHistoryBusy(true);
        try {
            const { data, error } = await supabase
                .from('meter_readings')
                .update({ reading_value: value, reading_date: readingEdit.date, note: note || null })
                .eq('id', r.id)
                .select('id');
            if (error) throw error;
            if (!data?.length) return alert('Der Zählerstand konnte nicht geändert werden (keine Berechtigung).');
            const recalcError = await recalcLastReading(detailMeter.id);
            if (recalcError) alert(`Der Zählerstand wurde geändert, der „letzte Stand“ des Zählers konnte aber nicht aktualisiert werden: ${translateError(recalcError)}`);
            setEditingReadingId(null);
            await loadHistory(detailMeter.id, historyLimit);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setHistoryBusy(false);
        }
    };

    const handleDeleteReading = async (r) => {
        if (historyBusy || !detailMeter) return;
        if (!canWriteMeters(detailMeter.portfolio_id)) return alert(READ_ONLY_HINT);
        if (!window.confirm(`Zählerstand vom ${fmtDate(r.reading_date)} (${fmtNumber(r.reading_value)} ${detailMeter.unit || ''}) wirklich löschen?`)) return;
        setHistoryBusy(true);
        try {
            const { error, count } = await supabase.from('meter_readings').delete({ count: 'exact' }).eq('id', r.id);
            if (error) throw error;
            if (!count) return alert('Der Zählerstand konnte nicht gelöscht werden (keine Berechtigung).');
            const recalcError = await recalcLastReading(detailMeter.id);
            if (recalcError) alert(`Der Zählerstand wurde gelöscht, der „letzte Stand“ des Zählers konnte aber nicht aktualisiert werden: ${translateError(recalcError)}`);
            if (editingReadingId === r.id) setEditingReadingId(null);
            await loadHistory(detailMeter.id, historyLimit);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setHistoryBusy(false);
        }
    };

    // --- UTILS ---
    const getIcon = (type) => {
        switch (type) {
            case 'Strom': return <Zap size={18} />;
            case 'Kaltwasser': case 'Warmwasser': return <Droplets size={18} />;
            case 'Gas': case 'Wärmemengen': return <Flame size={18} />;
            default: return <Gauge size={18} />;
        }
    };

    const formatPropName = (row) => {
        const p = row.property;
        if (!p) return '-';
        return `${p.street} ${p.house_number}, ${p.city}`;
    };

    const formatReading = (value, unit) => (value != null ? `${fmtNumber(value)} ${unit || ''}`.trim() : '-');

    // Ohne Schreibrecht nur „Historie“ (Lesemodus je Zähler-Portfolio)
    const renderActionMenu = (row) => {
        const writable = canWriteMeters(row.portfolio_id);
        return (
            <ActionMenu
                onReading={writable ? () => handleOpenReading(row) : undefined}
                onHistory={() => handleOpenDetail(row)}
                onEdit={writable ? () => handleOpenEdit(row) : undefined}
                onDelete={writable ? () => handleDeleteMeter(row) : undefined}
            />
        );
    };

    const columns = [
        {
            header: 'Typ',
            accessor: 'meter_type',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        padding: '4px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--background-color)',
                        display: 'flex',
                        color: 'var(--text-secondary)'
                    }}>
                        {getIcon(row.meter_type)}
                    </div>
                    <span>{row.meter_type}</span>
                </div>
            )
        },
        { header: 'Nr.', accessor: 'meter_number', render: r => <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{r.meter_number}</span> },
        { header: 'Immobilie', accessor: 'property', render: formatPropName },
        { header: 'Zuordnung', accessor: 'unit_ref', render: r => r.unit_ref ? `Einheit: ${r.unit_ref.unit_name}` : `Gebäudezähler` },
        { header: 'Stand', accessor: 'last_reading_value', align: 'right', render: r => formatReading(r.last_reading_value, r.unit) },
        { header: 'Datum', accessor: 'last_reading_date', align: 'right', render: r => r.last_reading_date ? fmtDate(r.last_reading_date) : '-' },
        { header: 'Versorger', accessor: 'supplier', align: 'right', render: r => r.supplier || '-' },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {renderActionMenu(row)}
                </div>
            )
        }
    ];

    // Verbrauch je Ablesung = Differenz zum zeitlich vorherigen Stand (nicht über einen Zählerwechsel hinweg)
    const historyRows = readingsHistory.map((r, i) => {
        const older = readingsHistory[i + 1] || (i === readingsHistory.length - 1 ? historyOlder : null);
        const swap = isSwapStart(r);
        const consumption = !swap && older && r.reading_value != null && older.reading_value != null
            ? Number(r.reading_value) - Number(older.reading_value)
            : null;
        return { ...r, _swap: swap, _consumption: consumption };
    });

    const inlineInputStyle = { width: '100%', minWidth: '110px', padding: '4px 6px', fontSize: '0.85rem' };
    const historyWritable = !!detailMeter && canWriteMeters(detailMeter.portfolio_id);
    const historyColumns = [
        {
            header: 'Datum',
            accessor: 'reading_date',
            render: r => editingReadingId === r.id
                ? <input type="date" max={localToday()} style={inlineInputStyle} value={readingEdit.date} onChange={(e) => setReadingEdit({ ...readingEdit, date: e.target.value })} />
                : fmtDate(r.reading_date)
        },
        {
            header: 'Wert',
            accessor: 'reading_value',
            align: 'right',
            render: r => editingReadingId === r.id
                ? <input type="number" step="any" min="0" style={{ ...inlineInputStyle, textAlign: 'right' }} value={readingEdit.value} onChange={(e) => setReadingEdit({ ...readingEdit, value: e.target.value })} />
                : <span style={{ fontWeight: 600 }}>{formatReading(r.reading_value, detailMeter?.unit)}</span>
        },
        {
            header: 'Verbrauch',
            accessor: '_consumption',
            align: 'right',
            render: r => {
                if (r._swap) return <Badge variant="blue">Zählerwechsel</Badge>;
                if (r._consumption == null) return '-';
                if (r._consumption < 0) {
                    return <span style={{ color: 'var(--danger-color)', fontWeight: 500 }} title="Stand kleiner als die vorherige Ablesung">{formatReading(r._consumption, detailMeter?.unit)}</span>;
                }
                return formatReading(r._consumption, detailMeter?.unit);
            }
        },
        {
            header: 'Notiz',
            accessor: 'note',
            render: r => editingReadingId === r.id
                ? <input type="text" style={inlineInputStyle} value={readingEdit.note} onChange={(e) => setReadingEdit({ ...readingEdit, note: e.target.value })} />
                : (r.note || '-')
        },
        // Bearbeiten/Löschen von Ständen nur mit Schreibrecht „Zähler“
        ...(!historyWritable ? [] : [{
            header: '',
            accessor: 'actions',
            align: 'right',
            render: r => editingReadingId === r.id ? (
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Button size="sm" onClick={() => handleSaveReadingEdit(r)} disabled={historyBusy}>{historyBusy ? 'Speichern…' : 'Speichern'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingReadingId(null)} disabled={historyBusy}>Abbrechen</Button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" icon={Edit2} title="Stand bearbeiten" onClick={() => handleStartEditReading(r)} disabled={historyBusy || editingReadingId !== null} />
                    <Button size="sm" variant="ghost" icon={Trash2} title="Stand löschen" onClick={() => handleDeleteReading(r)} disabled={historyBusy || editingReadingId !== null} />
                </div>
            )
        }])
    ];

    const readingUnit = readingMeter?.unit || '';

    return (
        <div>
            {isSaving && <LoadingOverlay message="Wird gespeichert..." />}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Zähler</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verwalten Sie Ihre Zähler und erfassen Sie Stände.</p>
                </div>
                {canCreateMeters && <Button icon={Plus} onClick={handleOpenAdd}>Zähler hinzufügen</Button>}
            </div>

            {loadError && (
                <div style={{
                    marginBottom: 'var(--spacing-lg)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--danger-color)',
                    backgroundColor: 'rgba(239, 68, 68, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    fontSize: '0.875rem'
                }}>
                    <span style={{ flex: 1, minWidth: '200px' }}>Daten konnten nicht vollständig geladen werden. {loadError}</span>
                    <Button variant="secondary" size="sm" onClick={fetchData}>Erneut laden</Button>
                </div>
            )}

            {/* Filter Bar */}
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-md)', alignItems: 'end' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Immobilie</label>
                        <div style={{ position: 'relative' }}>
                            <select
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    appearance: 'none',
                                    backgroundColor: 'var(--surface-color)'
                                }}
                                value={filters.propertyId}
                                onChange={(e) => setFilters({ ...filters, propertyId: e.target.value })}
                            >
                                <option value="">Alle Immobilien</option>
                                {properties.map(p => (
                                    <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>
                                ))}
                            </select>
                            <Filter size={16} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#9CA3AF' }} />
                        </div>
                    </div>

                    <div style={{ flex: 1, minWidth: '150px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Zählertyp</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={filters.meterType}
                            onChange={(e) => setFilters({ ...filters, meterType: e.target.value })}
                        >
                            <option value="all">Alle Typen</option>
                            <option value="Strom">Strom</option>
                            <option value="Kaltwasser">Kaltwasser</option>
                            <option value="Warmwasser">Warmwasser</option>
                            <option value="Gas">Gas</option>
                            <option value="Wärmemengen">Wärmemengen</option>
                            <option value="Sonstiges">Sonstiges</option>
                        </select>
                    </div>

                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Suche</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                placeholder="Nr, Name, Versorger..."
                                className="padded-left-icon"
                                style={{
                                    width: '100%',
                                    padding: '0.5rem 0.5rem 0.5rem 2rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    outline: 'none'
                                }}
                                value={filters.search}
                                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            />
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                        </div>
                    </div>
                </div>
            </div>

            <Card>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
                        <Loader2 className="animate-spin" />
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <Table columns={columns} data={filteredMeters} />
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {filteredMeters.map((row) => (
                                <div key={row.id} style={{
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: 'var(--surface-color)',
                                    position: 'relative'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{
                                                padding: '4px',
                                                borderRadius: '4px',
                                                backgroundColor: 'var(--background-color)',
                                                display: 'flex',
                                                color: 'var(--text-secondary)'
                                            }}>
                                                {getIcon(row.meter_type)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{row.meter_type}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{row.meter_number}</div>
                                            </div>
                                        </div>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                            {formatReading(row.last_reading_value, row.unit)}
                                        </div>
                                    </div>

                                    <div style={{ marginBottom: '12px', fontSize: '0.9rem' }}>
                                        <div style={{ fontWeight: 500 }}>{formatPropName(row)}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                            {row.unit_ref ? `Einheit: ${row.unit_ref.unit_name}` : `Gebäudezähler`}
                                        </div>
                                        {row.last_reading_date && (
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                Stand vom: {fmtDate(row.last_reading_date)}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                        {renderActionMenu(row)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {filteredMeters.length === 0 && !loadError && (
                            <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', padding: 'var(--spacing-lg) 0', margin: 0 }}>
                                {meters.length === 0 ? 'Noch keine Zähler angelegt.' : 'Keine Zähler für die gewählten Filter.'}
                            </p>
                        )}
                    </>
                )}
            </Card>

            {/* --- ADD / EDIT MODAL --- */}
            <Modal
                isOpen={isMeterModalOpen}
                onClose={() => setIsMeterModalOpen(false)}
                title={editingMeter ? 'Zähler bearbeiten' : 'Neuen Zähler anlegen'}
                maxWidth="800px"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsMeterModalOpen(false)} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleSaveMeter} disabled={isSaving}>{isSaving ? 'Speichern…' : 'Speichern'}</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.property_id}
                            onChange={(e) => setMeterForm({ ...meterForm, property_id: e.target.value, unit_id: '' })}
                        >
                            <option value="">Bitte wählen...</option>
                            {/* Nur Objekte aus Portfolios mit Schreibrecht „Zähler“ (die aktuelle Zuordnung bleibt wählbar) */}
                            {properties.filter(p => canWriteMeters(p.portfolio_id) || p.id === meterForm.property_id).map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit (Optional)</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.unit_id}
                            onChange={(e) => setMeterForm({ ...meterForm, unit_id: e.target.value })}
                            disabled={!meterForm.property_id}
                        >
                            <option value="">Keine (Gebäudezähler)</option>
                            {units.map(u => (
                                <option key={u.id} value={u.id}>{u.unit_name}{u.floor ? ` (${u.floor})` : ''}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Zählernummer *"
                        value={meterForm.meter_number}
                        onChange={(e) => setMeterForm({ ...meterForm, meter_number: e.target.value })}
                    />
                    <Input
                        label="Zählername (z.B. Hauptzähler)"
                        value={meterForm.meter_name}
                        onChange={(e) => setMeterForm({ ...meterForm, meter_name: e.target.value })}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Zählertyp *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.meter_type}
                            onChange={(e) => setMeterForm({ ...meterForm, meter_type: e.target.value })}
                        >
                            <option value="Strom">Strom</option>
                            <option value="Kaltwasser">Kaltwasser</option>
                            <option value="Warmwasser">Warmwasser</option>
                            <option value="Gas">Gas</option>
                            <option value="Wärmemengen">Wärmemengen</option>
                            <option value="Sonstiges">Sonstiges</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.unit}
                            onChange={(e) => setMeterForm({ ...meterForm, unit: e.target.value })}
                        >
                            <option value="kWh">kWh</option>
                            <option value="Wh">Wh</option>
                            <option value="m³">m³</option>
                            <option value="Liter">Liter</option>
                            <option value="sonstiges">sonstiges</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Versorger"
                        value={meterForm.supplier}
                        onChange={(e) => setMeterForm({ ...meterForm, supplier: e.target.value })}
                    />
                    <Input
                        label="Vertragsnummer"
                        value={meterForm.contract_number}
                        onChange={(e) => setMeterForm({ ...meterForm, contract_number: e.target.value })}
                    />
                </div>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Lage im Objekt (z.B. Keller, Wohnung)"
                        value={meterForm.location}
                        onChange={(e) => setMeterForm({ ...meterForm, location: e.target.value })}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Notizen</label>
                    <textarea
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            minHeight: '80px',
                            resize: 'vertical'
                        }}
                        value={meterForm.notes}
                        onChange={(e) => setMeterForm({ ...meterForm, notes: e.target.value })}
                    />
                </div>
            </Modal>

            {/* --- READING MODAL --- */}
            <Modal
                isOpen={isReadingModalOpen}
                onClose={() => setIsReadingModalOpen(false)}
                title="Zählerstand erfassen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsReadingModalOpen(false)} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleSaveReading} disabled={isSaving}>{isSaving ? 'Speichern…' : 'Speichern'}</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <strong>{readingMeter?.meter_type} Zähler {readingMeter?.meter_number}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Aktueller Stand: {formatReading(readingMeter?.last_reading_value, readingUnit)}
                        {readingMeter?.last_reading_date && ` (vom ${fmtDate(readingMeter.last_reading_date)})`}
                    </div>
                </div>
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={!!readingForm.isSwap}
                            onChange={(e) => setReadingForm({ ...readingForm, isSwap: e.target.checked })}
                        />
                        Zählerwechsel (Zähler wurde getauscht)
                    </label>
                    {readingForm.isSwap && (
                        <>
                            <Input
                                label={`Endstand alter Zähler (${readingUnit}, optional)`}
                                type="number"
                                step="any"
                                min="0"
                                value={readingForm.oldFinalValue}
                                onChange={(e) => setReadingForm({ ...readingForm, oldFinalValue: e.target.value })}
                            />
                            <Input
                                label="Neue Zählernummer (optional)"
                                value={readingForm.newMeterNumber}
                                onChange={(e) => setReadingForm({ ...readingForm, newMeterNumber: e.target.value })}
                            />
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                                Der Verbrauch wird ab dem Anfangsstand des neuen Zählers neu berechnet. Eine neue Zählernummer wird am Zähler übernommen und der Wechsel in den Notizen vermerkt.
                            </p>
                        </>
                    )}
                    <Input
                        label={readingForm.isSwap ? `Anfangsstand neuer Zähler (${readingUnit}) *` : `Neuer Zählerstand (${readingUnit}) *`}
                        type="number"
                        step="any"
                        min="0"
                        value={readingForm.value}
                        onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })}
                    />
                    <Input
                        label="Ablesedatum *"
                        type="date"
                        max={localToday()}
                        value={readingForm.date}
                        onChange={(e) => setReadingForm({ ...readingForm, date: e.target.value })}
                    />
                    <Input
                        label="Notiz (optional)"
                        value={readingForm.note}
                        onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })}
                    />
                </div>
            </Modal>

            {/* --- DETAIL MODAL --- */}
            <Modal
                isOpen={isDetailModalOpen}
                onClose={handleCloseDetail}
                title="Zähler Details & Historie"
                maxWidth="800px"
                footer={<Button variant="secondary" onClick={handleCloseDetail}>Schließen</Button>}
            >
                {detailMeter && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                        {/* Master Data */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', backgroundColor: 'var(--background-color)', borderRadius: '8px' }}>
                            <div>
                                <small style={{ color: '#6B7280' }}>Zählernummer</small>
                                <div style={{ fontWeight: 600 }}>{detailMeter.meter_number}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Typ</small>
                                <div>{detailMeter.meter_type} ({detailMeter.unit})</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Immobilie</small>
                                <div>{formatPropName({ property: detailMeter.property })}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Lage</small>
                                <div>{detailMeter.location || '-'}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Versorger</small>
                                <div>{detailMeter.supplier || '-'}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Vertrags-Nr.</small>
                                <div>{detailMeter.contract_number || '-'}</div>
                            </div>
                        </div>

                        {/* History Table */}
                        <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Ablesehistorie</h3>
                            {historyError ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', color: 'var(--danger-color)', fontSize: '0.9rem' }}>
                                    <span style={{ flex: 1 }}>Die Historie konnte nicht geladen werden. {historyError}</span>
                                    <Button variant="secondary" size="sm" onClick={() => loadHistory(detailMeter.id, historyLimit)}>Erneut laden</Button>
                                </div>
                            ) : loadingHistory && readingsHistory.length === 0 ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader2 className="animate-spin" /></div>
                            ) : readingsHistory.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einträge vorhanden.</p>
                            ) : (
                                <>
                                    <Table data={historyRows} columns={historyColumns} />
                                    {historyHasMore && (
                                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--spacing-md)' }}>
                                            <Button variant="secondary" size="sm" onClick={handleLoadMoreHistory} disabled={loadingHistory}>
                                                {loadingHistory ? 'Lade…' : 'Ältere Einträge laden'}
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Meters;
