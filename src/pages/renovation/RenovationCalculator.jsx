import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calculator, Plus, Search, Trash2, Loader2, Building2,
    ArrowRight, Tag
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);

const TYPE_LABELS = {
    buy_and_hold: { label: 'Buy & Hold', color: '#0ea5e9', bg: '#e0f2fe' },
    fix_and_flip: { label: 'Fix & Flip', color: '#f59e0b', bg: '#fef3c7' },
};

const RenovationCalculator = () => {
    const { user } = useAuth();
    const { isMobile } = useViewMode();
    const navigate = useNavigate();

    const [calculations, setCalculations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (user) fetchCalcs();
    }, [user]);

    const fetchCalcs = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('renovation_calculations')
                .select(`
                    *,
                    property:properties(street, house_number, city),
                    unit:units(unit_name)
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setCalculations(data || []);
        } catch (err) {
            console.error('Error fetching calculations:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('Kalkulation endgültig löschen?')) return;
        await supabase.from('renovation_calculations').delete().eq('id', id);
        fetchCalcs();
    };

    const enriched = useMemo(() => {
        return calculations.map(c => {
            const propertyLabel = c.property ? `${c.property.street} ${c.property.house_number || ''}, ${c.property.city}` : null;
            const unitLabel = c.unit?.unit_name || null;
            return { ...c, total: Number(c.total_cost || 0), propertyLabel, unitLabel };
        });
    }, [calculations]);

    const filtered = useMemo(() => {
        if (!searchTerm) return enriched;
        const s = searchTerm.toLowerCase();
        return enriched.filter(c => (c.name + (c.propertyLabel || '')).toLowerCase().includes(s));
    }, [enriched, searchTerm]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" size={28} /></div>;

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
            {filtered.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '60px 20px',
                    color: 'var(--text-secondary)', fontSize: '0.9rem',
                }}>
                    <Calculator size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                    <p>Noch keine Kalkulationen erstellt.</p>
                    <Button icon={Plus} onClick={() => navigate('/renovation/calculator/new')} style={{ marginTop: '16px' }}>
                        Neue Kalkulation
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
                                        <button
                                            onClick={(e) => handleDelete(c.id, e)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <ArrowRight size={16} color="var(--text-secondary)" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )
            }
        </div >
    );
};

export default RenovationCalculator;
