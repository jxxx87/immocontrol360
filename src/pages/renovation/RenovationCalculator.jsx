import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calculator, Plus, Search, Trash2, Loader2, Building2,
    ArrowRight, AlertCircle, RefreshCw
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { usePermission } from '../../context/PermissionContext';
import { useViewMode } from '../../context/ViewModeContext';
import { translateError } from '../../lib/errorTranslator';

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);

const TYPE_LABELS = {
    buy_and_hold: { label: 'Buy & Hold', color: '#0ea5e9', bg: '#e0f2fe' },
    fix_and_flip: { label: 'Fix & Flip', color: '#f59e0b', bg: '#fef3c7' },
};

const RenovationCalculator = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const perm = usePermission();
    const { isMobile } = useViewMode();
    const navigate = useNavigate();

    // Schreibrecht wie die RLS von renovation_calculations: mit Objekt Schreibrecht „Immobilien“
    // oder „Investorportal“ im Portfolio des Objekts, ohne Objekt nur das eigene Konto.
    // Solange die Freigaben laden, nicht sperren (die Datenbank prüft zusätzlich).
    const canWriteReno = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId
            ? perm.canWrite('immobilien', portfolioId) || perm.canWrite('investorportal', portfolioId)
            : perm.canWrite('immobilien') || perm.canWrite('investorportal');
    };
    const canEditCalc = (c) => {
        if (!c.property_id) return c.user_id === user?.id;
        const pid = c.property?.portfolio_id;
        return pid ? canWriteReno(pid) : !perm || perm.loadingPermissions;
    };
    const canCreateCalc = !selectedPortfolioID || canWriteReno(selectedPortfolioID);

    const [calculations, setCalculations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingId, setDeletingId] = useState(null);

    const fetchCalcs = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            // Nur die für die Liste benötigten Spalten (ohne building_config-JSONB).
            // Kein Filter auf user_id: die Zugriffsregeln der Datenbank liefern eigene
            // Kalkulationen und die freigegebener Objekte.
            const { data, error } = await supabase
                .from('renovation_calculations')
                .select(`
                    id, user_id, property_id, name, calc_type, total_cost, created_at,
                    property:properties(street, house_number, city, portfolio_id),
                    unit:units(unit_name)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setCalculations(data || []);
        } catch (err) {
            console.error('Error fetching calculations:', err);
            setLoadError(translateError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchCalcs();
    }, [user, fetchCalcs]);

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        const calc = calculations.find(c => c.id === id);
        if (calc && !canEditCalc(calc)) return;
        if (!window.confirm('Kalkulation endgültig löschen?')) return;
        setDeletingId(id);
        try {
            const { data, error } = await supabase
                .from('renovation_calculations')
                .delete()
                .eq('id', id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Die Kalkulation wurde nicht gelöscht (keine Berechtigung oder bereits entfernt).');
            }
            setCalculations(prev => prev.filter(c => c.id !== id));
        } catch (err) {
            console.error('Error deleting calculation:', err);
            alert('Kalkulation konnte nicht gelöscht werden: ' + translateError(err));
            fetchCalcs();
        } finally {
            setDeletingId(null);
        }
    };

    // Gewähltes Portfolio: dessen Kalkulationen plus eigene ohne Objekt (gehören zu keinem
    // Portfolio, z. B. nur mit einem Deal verknüpft – sie würden sonst nirgends erscheinen)
    const scopedCalculations = useMemo(() => {
        if (!selectedPortfolioID) return calculations;
        return calculations.filter(c => !c.property_id || c.property?.portfolio_id === selectedPortfolioID);
    }, [calculations, selectedPortfolioID]);

    const enriched = useMemo(() => {
        return scopedCalculations.map(c => {
            const propertyLabel = c.property ? `${c.property.street} ${c.property.house_number || ''}, ${c.property.city}` : null;
            const unitLabel = c.unit?.unit_name || null;
            return { ...c, total: Number(c.total_cost || 0), propertyLabel, unitLabel };
        });
    }, [scopedCalculations]);

    const filtered = useMemo(() => {
        if (!searchTerm) return enriched;
        const s = searchTerm.toLowerCase();
        return enriched.filter(c => ((c.name || '') + (c.propertyLabel || '')).toLowerCase().includes(s));
    }, [enriched, searchTerm]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" size={28} /></div>;

    if (loadError) {
        return (
            <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', color: '#991B1B' }}>
                <h4 style={{ fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={20} /> Kalkulationen konnten nicht geladen werden
                </h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>{loadError}</p>
                <Button size="sm" icon={RefreshCw} onClick={fetchCalcs}>Erneut laden</Button>
            </div>
        );
    }

    return (
        <div>
            {/* Filters */}
            <div style={{
                display: 'flex', gap: '10px', marginBottom: '16px',
                flexWrap: isMobile ? 'wrap' : 'nowrap',
            }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input
                        placeholder="Kalkulation suchen..."
                        className="padded-left-icon"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%', padding: '10px 10px 10px 34px',
                            borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--surface-color)', fontSize: '0.875rem', outline: 'none',
                        }}
                    />
                </div>
            </div>

            {/* List */}
            {enriched.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '60px 20px',
                    color: 'var(--text-secondary)', fontSize: '0.9rem',
                }}>
                    <Calculator size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                    <p>Noch keine Kalkulationen erstellt.</p>
                    {canCreateCalc && (
                        <Button icon={Plus} onClick={() => navigate('/renovation/calculator/new')} style={{ marginTop: '16px' }}>
                            Neue Kalkulation
                        </Button>
                    )}
                </div>
            ) : filtered.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '40px 20px',
                    color: 'var(--text-secondary)', fontSize: '0.9rem',
                }}>
                    <Search size={36} style={{ opacity: 0.3, marginBottom: '12px' }} />
                    <p>Keine Kalkulation passt zur Suche „{searchTerm}".</p>
                    <Button variant="secondary" onClick={() => setSearchTerm('')} style={{ marginTop: '12px' }}>
                        Suche zurücksetzen
                    </Button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filtered.map(c => {
                        const typeInfo = TYPE_LABELS[c.calc_type] || TYPE_LABELS.buy_and_hold;
                        return (
                            <div
                                key={c.id}
                                onClick={() => navigate(`/renovation/calculator/${c.id}`)}
                                style={{
                                    padding: '16px 18px', borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--surface-color)', cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#0ea5e9'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(14,165,233,0.08)'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                            <Calculator size={18} color="#0ea5e9" />
                                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{c.name}</span>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600,
                                                background: typeInfo.bg, color: typeInfo.color,
                                            }}>{typeInfo.label}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                                            {c.propertyLabel && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Building2 size={13} /> {c.propertyLabel}
                                                    {c.unitLabel && <span> · {c.unitLabel}</span>}
                                                </span>
                                            )}
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                Gesamt: {fmt(c.total)}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        {canEditCalc(c) && (
                                            <button
                                                onClick={(e) => handleDelete(c.id, e)}
                                                disabled={deletingId === c.id}
                                                title="Kalkulation löschen"
                                                style={{ background: 'none', border: 'none', cursor: deletingId === c.id ? 'wait' : 'pointer', color: 'var(--text-secondary)', padding: '4px' }}
                                            >
                                                {deletingId === c.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                            </button>
                                        )}
                                        <ArrowRight size={16} color="var(--text-secondary)" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default RenovationCalculator;
