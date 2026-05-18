import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, GripVertical, ChevronDown, ChevronRight,
    Loader2, Milestone, Wrench, AlertCircle, RefreshCw
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

/* ─── Default Trades, Untergewerke & Positionen ── */
const DEFAULT_TRADES = [
    {
        name: 'Rückbau & Entsorgung',
        subs: [
            {
                name: 'Abbruch', positions: [
                    { name: 'Nichttragende Innenwand abbrechen', unit: 'm²', price: 40 },
                    { name: 'Estrich abbrechen', unit: 'm²', price: 25 },
                    { name: 'Fliesen entfernen', unit: 'm²', price: 20 },
                    { name: 'Laminat/Vinyl/Parkett entfernen', unit: 'm²', price: 4 },
                    { name: 'Türdurchbruch herstellen', unit: 'Stk.', price: 350 },
                    { name: 'Tapeten entfernen', unit: 'm²', price: 7 },
                    { name: 'Innentür ausbauen', unit: 'Stk.', price: 60 },
                    { name: 'Holzdecke demontieren', unit: 'm²', price: 12 },
                ]
            },
            {
                name: 'Entsorgung', positions: [
                    { name: 'Bauschutt entsorgen', unit: 'm³', price: 180 },
                    { name: 'Innentür entsorgen', unit: 'Stk.', price: 10 },
                    { name: 'Bodenbelag entsorgen', unit: 'm²', price: 10 },
                ]
            },
        ]
    },
    {
        name: 'Rohbau',
        subs: [
            {
                name: 'Mauerwerk', positions: [
                    { name: 'Stahlträger einsetzen', unit: 'Stk.', price: 1200 },
                    { name: 'KS-Innenwand 11,5 cm', unit: 'm²', price: 85 },
                    { name: 'Betonsturz einsetzen', unit: 'Stk.', price: 150 },
                ]
            },
        ]
    },
    {
        name: 'Dach',
        subs: [
            {
                name: 'Dachstuhl/Zimmerarbeiten', positions: [
                    { name: 'Dachstuhl erneuern', unit: 'm²', price: 140 },
                    { name: 'Sparren austauschen', unit: 'm', price: 40 },
                    { name: 'Gaube herstellen', unit: 'Stk.', price: 6000 },
                ]
            },
            {
                name: 'Dacheindeckung und Abdichtung', positions: [
                    { name: 'Dachziegel neu eindecken inkl. Unterspannbahn', unit: 'm²', price: 105 },
                    { name: 'Flachdachabdichtung inkl. Dämmung', unit: 'm²', price: 300 },
                    { name: 'Dachfenster einbauen', unit: 'Stk.', price: 1200 },
                ]
            },
            {
                name: 'Klempnerarbeiten', positions: [
                    { name: 'Dachrinne montieren', unit: 'm', price: 35 },
                    { name: 'Fallrohr montieren', unit: 'm', price: 30 },
                    { name: 'Attikaabdeckung', unit: 'm', price: 60 },
                ]
            },
            {
                name: 'Dämmung', positions: [
                    { name: 'Dämmung Mineralwolle 20 cm', unit: 'm²', price: 35 },
                    { name: 'Dampfbremse', unit: 'm²', price: 13 },
                ]
            },
        ]
    },
    {
        name: 'Gerüst',
        subs: [
            {
                name: 'Gerüst', positions: [
                    { name: 'Gerüst stellen Fläche (4 Wo.)', unit: 'm²', price: 15 },
                    { name: 'Dachfangnetz (4 Wo.)', unit: 'lfm.', price: 10 },
                    { name: 'Standzeit (1 Wo.)', unit: 'Wo.', price: 10 },
                ]
            },
        ]
    },
    {
        name: 'Fassade',
        subs: [
            {
                name: 'WDVS', positions: [
                    { name: 'WDVS 16 cm', unit: 'm²', price: 170 },
                ]
            },
            {
                name: 'Außenputz und Anstrich', positions: [
                    { name: 'Fassadenputz neu', unit: 'm²', price: 35 },
                    { name: 'Fassadenanstrich', unit: 'm²', price: 18 },
                ]
            },
        ]
    },
    {
        name: 'Fenster/Türen',
        subs: [
            {
                name: 'Fensteraustausch', positions: [
                    { name: 'Kunststofffenster 3-fach', unit: 'm²', price: 450 },
                    { name: 'Fenster demontieren', unit: 'Stk.', price: 80 },
                    { name: 'RAL-Montage', unit: 'Stk.', price: 120 },
                ]
            },
            {
                name: 'Haustür und Nebentüren', positions: [
                    { name: 'Aluminium Haustür', unit: 'Stk.', price: 3200 },
                    { name: 'Nebeneingangstür', unit: 'Stk.', price: 1200 },
                ]
            },
            {
                name: 'Fensterbänke', positions: [
                    { name: 'Fensterbänke Alu', unit: 'lfm.', price: 65 },
                    { name: 'Innenfensterbänke Naturstein', unit: 'lfm.', price: 50 },
                ]
            },
        ]
    },
    {
        name: 'Sanitärinstallation',
        subs: [
            {
                name: 'Rohinstallation', positions: [
                    { name: 'Wasser-& Heizungsleitung verlegen', unit: 'm²', price: 85 },
                    { name: 'Abwasserleitung', unit: 'Stk.', price: 150 },
                    { name: 'Vorwandelement WC', unit: 'Stk.', price: 350 },
                    { name: 'Waschmaschinenanschluss', unit: 'Stk.', price: 150 },
                ]
            },
            {
                name: 'Endmontage', positions: [
                    { name: 'WC-Anlage komplett', unit: 'Stk.', price: 500 },
                    { name: 'Waschtischanlage', unit: 'Stk.', price: 400 },
                    { name: 'Duschanlage komplett', unit: 'Stk.', price: 1200 },
                    { name: 'Badewanne komplett', unit: 'Stk.', price: 1500 },
                ]
            },
        ]
    },
    {
        name: 'Heizung',
        subs: [
            {
                name: 'Wärmeerzeuger', positions: [
                    { name: 'Luft-Wärmepumpe', unit: 'Stk.', price: 20000 },
                    { name: 'Gastherme', unit: 'Stk.', price: 7500 },
                ]
            },
            {
                name: 'Heizflächen', positions: [
                    { name: 'Heizkörper', unit: 'Stk.', price: 500 },
                    { name: 'Fußbodenheizung', unit: 'm²', price: 50 },
                ]
            },
        ]
    },
    {
        name: 'Elektro',
        subs: [
            {
                name: 'Leitungen', positions: [
                    { name: 'NYM Leitung verlegen', unit: 'm²', price: 30 },
                ]
            },
            {
                name: 'Verteilung', positions: [
                    { name: 'Unterverteilung installieren', unit: 'Stk.', price: 1000 },
                    { name: 'Zählerschrank erneuern', unit: 'je Einheit', price: 2000 },
                ]
            },
            {
                name: 'Endmontage', positions: [
                    { name: 'Steckdose montieren', unit: 'Stk.', price: 40 },
                    { name: 'Netzwerkdose montieren', unit: 'Stk.', price: 75 },
                    { name: 'Schalter montieren', unit: 'Stk.', price: 50 },
                    { name: 'LED Deckenspot', unit: 'Stk.', price: 50 },
                    { name: 'Sprechanlage', unit: 'je Einheit', price: 200 },
                ]
            },
        ]
    },
    {
        name: 'Trockenbau',
        subs: [
            {
                name: 'Ständerwerk/Unterkonstruktion', positions: [
                    { name: 'Metallständerwand', unit: 'm²', price: 50 },
                    { name: 'Deckenabhängung', unit: 'm²', price: 40 },
                ]
            },
            {
                name: 'Beplankung', positions: [
                    { name: 'Einfach beplankt Wand', unit: 'm²', price: 18 },
                    { name: 'Zweifach beplankt Wand', unit: 'm²', price: 26 },
                    { name: 'Einfach beplankt Decke', unit: 'm²', price: 20 },
                    { name: 'Zweifach beplankt Decke', unit: 'm²', price: 32 },
                ]
            },
            {
                name: 'Bodensysteme', positions: [
                    { name: 'Trockenestrichsystem', unit: 'm²', price: 70 },
                ]
            },
        ]
    },
    {
        name: 'Estrich',
        subs: [
            {
                name: 'Zement- oder Fließestrich', positions: [
                    { name: 'Zementestrich', unit: 'm²', price: 25 },
                    { name: 'Fließestrich', unit: 'm²', price: 35 },
                ]
            },
        ]
    },
    {
        name: 'Innenputz',
        subs: [
            {
                name: 'Wand- und Deckenputz', positions: [
                    { name: 'Gipsputz', unit: 'm²', price: 18 },
                    { name: 'Kalkzementputz', unit: 'm²', price: 20 },
                    { name: 'Scheibenputz', unit: 'm²', price: 23 },
                ]
            },
            {
                name: 'Kellerdämmung', positions: [
                    { name: 'Dämmung PUR 10cm', unit: 'm²', price: 55 },
                ]
            },
        ]
    },
    {
        name: 'Fliesen',
        subs: [
            {
                name: 'Wand- und Bodenfliesen', positions: [
                    { name: 'Wandfliesen verlegen', unit: 'm²', price: 70 },
                    { name: 'Bodenfliesen verlegen', unit: 'm²', price: 80 },
                    { name: 'Sockel stellen', unit: 'lfm.', price: 16 },
                ]
            },
            {
                name: 'Abdichtung & Estrich', positions: [
                    { name: 'Abdichtung', unit: 'm²', price: 35 },
                    { name: 'Estrich Bodengleiche Dusche', unit: 'psch.', price: 300 },
                ]
            },
        ]
    },
    {
        name: 'Bodenbeläge',
        subs: [
            {
                name: 'Parkett, Laminat oder Vinyl', positions: [
                    { name: 'Laminat verlegen', unit: 'm²', price: 35 },
                    { name: 'Vinyl verlegen', unit: 'm²', price: 45 },
                    { name: 'Parkett verlegen', unit: 'm²', price: 80 },
                    { name: 'Sockelleisten MDF Weiß', unit: 'lfm.', price: 9 },
                    { name: 'Übergangsleiste', unit: 'Stk.', price: 25 },
                ]
            },
        ]
    },
    {
        name: 'Maler/Lackierer',
        subs: [
            {
                name: 'Spachtelarbeiten und Tapezieren', positions: [
                    { name: 'Q3 Spachtelung', unit: 'm²', price: 15 },
                    { name: 'Raufaser tapezieren', unit: 'm²', price: 15 },
                    { name: 'Malervlies tapezieren', unit: 'm²', price: 19 },
                ]
            },
            {
                name: 'Innenanstrich und Lackierarbeiten', positions: [
                    { name: 'Innenanstrich', unit: 'm²', price: 12 },
                    { name: 'Türen lackieren', unit: 'Stk.', price: 80 },
                ]
            },
        ]
    },
    {
        name: 'Tischler',
        subs: [
            {
                name: 'Innentüren', positions: [
                    { name: 'Innentür CPL', unit: 'Stk.', price: 400 },
                ]
            },
        ]
    },
    {
        name: 'Metallbau',
        subs: [
            {
                name: 'Anbaubalkone', positions: [
                    { name: 'Balkon-Stahlkonstruktion', unit: 'm²', price: 1000 },
                    { name: 'WPC Balkonbelag', unit: 'm²', price: 150 },
                    { name: 'Punktfundamente', unit: 'psch.', price: 350 },
                ]
            },
            {
                name: 'Edelstahlgeländer', positions: [
                    { name: 'Edelstahlgeländer (Stabfüllung)', unit: 'lfm.', price: 380 },
                ]
            },
        ]
    },
];

const DEFAULT_MILESTONES = [
    { name: 'Beauftragt', is_completion_trigger: false },
    { name: 'In Arbeit', is_completion_trigger: false },
    { name: 'Fertig', is_completion_trigger: false },
    { name: 'Abgenommen', is_completion_trigger: true },
];

const UNIT_OPTIONS = ['Stk.', 'm²', 'm', 'lfm.', 'm³', 'psch.', 'h', 'je Einheit'];

/* ─── Helper: generate simple unique id for position entries ─── */
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const RenovationSettings = ({ onSaved }) => {
    const { user } = useAuth();
    const [activeSettingsTab, setActiveSettingsTab] = useState('trades');
    const [trades, setTrades] = useState([]);
    const [milestones, setMilestones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedTrade, setExpandedTrade] = useState(null);
    const [expandedSubtrade, setExpandedSubtrade] = useState(null);
    const [needsMigration, setNeedsMigration] = useState(false);

    useEffect(() => {
        if (user) loadSettings();
    }, [user]);

    /* ─── Load ─── */
    const loadSettings = async () => {
        setLoading(true);
        try {
            const [tradesRes, milestonesRes] = await Promise.all([
                supabase.from('renovation_trades')
                    .select('*, subtrades:renovation_subtrades(*)')
                    .eq('user_id', user.id)
                    .order('sort_order'),
                supabase.from('renovation_milestone_templates')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('sort_order'),
            ]);

            let tradesData = tradesRes.data || [];
            let milestonesData = milestonesRes.data || [];

            // Sort subtrades
            tradesData.forEach(t => {
                t.subtrades = (t.subtrades || []).sort((a, b) => a.sort_order - b.sort_order);
                t.subtrades.forEach(st => {
                    // positions is now a JSONB column – parse if string, fallback to []
                    if (typeof st.positions === 'string') {
                        try { st.positions = JSON.parse(st.positions); } catch { st.positions = []; }
                    }
                    st.positions = st.positions || [];
                });
            });

            // Check if migration is needed: if subtrades exist but none have 'positions' key at all
            const allSubtrades = tradesData.flatMap(t => t.subtrades || []);
            if (allSubtrades.length > 0) {
                const firstSt = allSubtrades[0];
                // If the column doesn't exist, 'positions' won't be in the object at all
                if (!('positions' in firstSt)) {
                    setNeedsMigration(true);
                } else {
                    setNeedsMigration(false);
                }
            }

            setTrades(tradesData);
            setMilestones(milestonesData);
        } catch (err) {
            console.error('Settings load error:', err);
        } finally {
            setLoading(false);
        }
    };

    /* ─── Reset to Standard Catalog ─── */
    const resetToStandards = async () => {
        if (!window.confirm('Alle Gewerke, Untergewerke und Positionen werden durch den Standard-Katalog ersetzt. Fortfahren?')) return;
        setLoading(true);
        try {
            // Delete existing
            await supabase.from('renovation_trades').delete().eq('user_id', user.id);

            // Insert from defaults
            for (let i = 0; i < DEFAULT_TRADES.length; i++) {
                const t = DEFAULT_TRADES[i];
                const { data: trade, error: tradeErr } = await supabase.from('renovation_trades')
                    .insert({ user_id: user.id, name: t.name, sort_order: i })
                    .select().single();
                if (tradeErr) throw tradeErr;

                if (trade && t.subs) {
                    for (let j = 0; j < t.subs.length; j++) {
                        const st = t.subs[j];
                        // Positions are stored as JSONB array, with IDs generated here
                        const positionsJson = (st.positions || []).map(p => ({
                            id: uid(), name: p.name, unit: p.unit, price: p.price
                        }));

                        const { error: subErr } = await supabase.from('renovation_subtrades')
                            .insert({
                                trade_id: trade.id,
                                user_id: user.id,
                                name: st.name,
                                sort_order: j,
                                positions: positionsJson
                            });
                        if (subErr) throw subErr;
                    }
                }
            }

            await loadSettings();
            alert('Standard-Katalog erfolgreich geladen!');
        } catch (err) {
            console.error('Reset error:', err);
            if (err.message && err.message.includes('positions')) {
                setNeedsMigration(true);
                alert('Die Spalte "positions" fehlt in der Datenbank.\nBitte führe den angezeigten SQL-Befehl aus.');
            } else {
                alert('Fehler: ' + err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    /* ─── Trade CRUD ─── */
    const addTrade = async () => {
        await supabase.from('renovation_trades').insert({ user_id: user.id, name: 'Neues Gewerk', sort_order: trades.length });
        loadSettings();
    };
    const updateTrade = async (id, name) => {
        await supabase.from('renovation_trades').update({ name }).eq('id', id);
    };
    const deleteTrade = async (id) => {
        if (!window.confirm('Gewerk und alle Untergewerke löschen?')) return;
        await supabase.from('renovation_trades').delete().eq('id', id);
        loadSettings();
    };

    /* ─── Subtrade CRUD ─── */
    const addSubtrade = async (tradeId) => {
        const trade = trades.find(t => t.id === tradeId);
        const count = trade?.subtrades?.length || 0;
        await supabase.from('renovation_subtrades').insert({
            trade_id: tradeId, user_id: user.id, name: 'Neues Untergewerk',
            sort_order: count, positions: []
        });
        loadSettings();
    };
    const updateSubtradeName = async (id, name) => {
        await supabase.from('renovation_subtrades').update({ name }).eq('id', id);
    };
    const deleteSubtrade = async (id) => {
        if (!window.confirm('Untergewerk und alle Positionen löschen?')) return;
        await supabase.from('renovation_subtrades').delete().eq('id', id);
        loadSettings();
    };

    /* ─── Position CRUD (JSONB in subtrade) ─── */
    const savePositions = async (subtradeId, positions) => {
        const { error } = await supabase.from('renovation_subtrades')
            .update({ positions })
            .eq('id', subtradeId);
        if (error) {
            if (error.message && error.message.includes('positions')) {
                setNeedsMigration(true);
                alert('Die Spalte "positions" fehlt in der Datenbank.\nBitte führe den angezeigten SQL-Befehl aus.');
            }
            throw error;
        }
    };

    const addPosition = async (subtradeId, currentPositions) => {
        const newPos = [...(currentPositions || []), { id: uid(), name: 'Neue Position', unit: 'Stk.', price: 0 }];
        await savePositions(subtradeId, newPos);
        loadSettings();
    };

    const updatePosition = async (subtradeId, currentPositions, posId, field, value) => {
        const updated = currentPositions.map(p => p.id === posId ? { ...p, [field]: value } : p);
        await savePositions(subtradeId, updated);
    };

    const deletePosition = async (subtradeId, currentPositions, posId) => {
        const filtered = currentPositions.filter(p => p.id !== posId);
        await savePositions(subtradeId, filtered);
        loadSettings();
    };

    /* ─── Milestone CRUD ─── */
    const addMilestone = async () => {
        await supabase.from('renovation_milestone_templates').insert({
            user_id: user.id, name: 'Neuer Meilenstein',
            sort_order: milestones.length, is_completion_trigger: false
        });
        loadSettings();
    };
    const updateMilestone = async (id, updates) => {
        await supabase.from('renovation_milestone_templates').update(updates).eq('id', id);
        loadSettings();
    };
    const deleteMilestone = async (id) => {
        await supabase.from('renovation_milestone_templates').delete().eq('id', id);
        loadSettings();
    };

    /* ─── Render ─── */

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" /></div>;

    const migrationSQL = `ALTER TABLE renovation_subtrades\nADD COLUMN IF NOT EXISTS positions JSONB DEFAULT '[]'::jsonb;`;

    return (
        <div>
            {/* Migration Alert */}
            {needsMigration && (
                <div style={{ marginBottom: '20px', padding: '16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', color: '#991B1B' }}>
                    <h4 style={{ fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={20} /> Datenbank-Update erforderlich
                    </h4>
                    <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
                        Die Spalte für Positionen fehlt. Bitte führe diesen SQL-Befehl im Supabase Dashboard (SQL Editor) aus:
                    </p>
                    <div style={{ position: 'relative' }}>
                        <pre style={{ background: '#1F2937', color: '#E5E7EB', padding: '12px', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.6 }}>
                            {migrationSQL}
                        </pre>
                        <button
                            onClick={() => { navigator.clipboard.writeText(migrationSQL); alert('SQL kopiert!'); }}
                            style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 10px', background: '#374151', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                            Kopieren
                        </button>
                    </div>
                    <p style={{ fontSize: '0.85rem', marginTop: '12px' }}>
                        Danach diese Seite neu laden und auf <strong>„Standard-Katalog laden"</strong> klicken.
                    </p>
                </div>
            )}

            {/* Sub-Tabs + Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {[{ key: 'trades', label: 'Gewerke & Preise', icon: Wrench }, { key: 'milestones', label: 'Meilensteine', icon: Milestone }].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveSettingsTab(tab.key)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
                                borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                                background: activeSettingsTab === tab.key ? '#0ea5e9' : 'var(--surface-color)',
                                color: activeSettingsTab === tab.key ? '#fff' : 'var(--text-secondary)',
                                border: activeSettingsTab === tab.key ? 'none' : '1px solid var(--border-color)',
                                transition: 'all 0.15s',
                            }}
                        >
                            <tab.icon size={15} /> {tab.label}
                        </button>
                    ))}
                </div>
                {activeSettingsTab === 'trades' && (
                    <Button variant="ghost" size="sm" onClick={resetToStandards} icon={RefreshCw}>
                        Standard-Katalog laden
                    </Button>
                )}
            </div>

            {/* ════ TRADES ════ */}
            {activeSettingsTab === 'trades' && (
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>Gewerke & Positionen</h3>
                        <Button icon={Plus} size="sm" onClick={addTrade}>Gewerk</Button>
                    </div>

                    {trades.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                            <p style={{ marginBottom: '12px' }}>Keine Gewerke vorhanden.</p>
                            <Button onClick={resetToStandards} icon={RefreshCw}>Standard-Katalog laden</Button>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {trades.map(t => (
                            <div key={t.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                {/* ── Trade Row ── */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'var(--background-color)', borderBottom: expandedTrade === t.id ? '1px solid var(--border-color)' : 'none' }}>
                                    <GripVertical size={16} color="var(--text-secondary)" style={{ cursor: 'grab', flexShrink: 0 }} />
                                    <button onClick={() => setExpandedTrade(expandedTrade === t.id ? null : t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                        {expandedTrade === t.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                    <input
                                        defaultValue={t.name}
                                        onBlur={e => updateTrade(t.id, e.target.value)}
                                        style={{ flex: 1, border: 'none', background: 'transparent', fontWeight: 700, fontSize: '0.9rem', outline: 'none', color: 'var(--text-primary)' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                        {t.subtrades?.length || 0} UG
                                    </span>
                                    <button onClick={() => deleteTrade(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px' }}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                {/* ── Subtrades ── */}
                                {expandedTrade === t.id && (
                                    <div style={{ padding: '8px 12px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {(t.subtrades || []).map(st => {
                                            const positions = st.positions || [];
                                            const isExpanded = expandedSubtrade === st.id;
                                            return (
                                                <div key={st.id} style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                                                    {/* Subtrade Header */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', background: 'var(--surface-color)', borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none' }}>
                                                        <GripVertical size={14} color="var(--text-secondary)" style={{ cursor: 'grab', flexShrink: 0 }} />
                                                        <button onClick={() => setExpandedSubtrade(isExpanded ? null : st.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                        </button>
                                                        <input
                                                            defaultValue={st.name}
                                                            onBlur={e => updateSubtradeName(st.id, e.target.value)}
                                                            style={{ flex: 1, border: 'none', background: 'transparent', fontWeight: 600, fontSize: '0.85rem', outline: 'none', color: 'var(--text-primary)' }}
                                                        />
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                            {positions.length} Pos.
                                                        </span>
                                                        <button onClick={() => deleteSubtrade(st.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px' }}>
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>

                                                    {/* Positions Table */}
                                                    {isExpanded && (
                                                        <div style={{ padding: '8px 10px 10px 10px' }}>
                                                            {/* Column headers */}
                                                            {positions.length > 0 && (
                                                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 90px 28px', gap: '8px', marginBottom: '6px', paddingLeft: '20px' }}>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Position</span>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Einheit</span>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'right' }}>EP (€)</span>
                                                                    <span></span>
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                {positions.map(pos => (
                                                                    <div key={pos.id} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 90px 28px', gap: '8px', alignItems: 'center' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            <GripVertical size={12} color="var(--text-secondary)" style={{ cursor: 'grab', flexShrink: 0 }} />
                                                                            <input
                                                                                defaultValue={pos.name}
                                                                                onBlur={e => updatePosition(st.id, positions, pos.id, 'name', e.target.value)}
                                                                                style={{ width: '100%', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px 6px', fontSize: '0.82rem', outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                            />
                                                                        </div>
                                                                        <select
                                                                            defaultValue={pos.unit || 'Stk.'}
                                                                            onChange={e => updatePosition(st.id, positions, pos.id, 'unit', e.target.value)}
                                                                            style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px 4px', fontSize: '0.78rem', outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                        >
                                                                            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                                                        </select>
                                                                        <input
                                                                            type="number" step="0.01"
                                                                            defaultValue={pos.price || ''}
                                                                            onBlur={e => updatePosition(st.id, positions, pos.id, 'price', Number(e.target.value) || 0)}
                                                                            style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px', fontSize: '0.82rem', outline: 'none', textAlign: 'right', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                        />
                                                                        <button onClick={() => deletePosition(st.id, positions, pos.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}>
                                                                            <Trash2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <button
                                                                onClick={() => addPosition(st.id, positions)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', marginTop: '8px', marginLeft: '20px' }}
                                                            >
                                                                <Plus size={12} /> Position hinzufügen
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        <button
                                            onClick={() => addSubtrade(t.id)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', fontSize: '0.8rem', color: '#0ea5e9', background: 'none', border: '1px dashed #0ea5e9', borderRadius: '6px', cursor: 'pointer', alignSelf: 'start' }}
                                        >
                                            <Plus size={13} /> Untergewerk hinzufügen
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* ════ MILESTONES ════ */}
            {activeSettingsTab === 'milestones' && (
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>Meilenstein-Vorlagen</h3>
                        <Button icon={Plus} size="sm" onClick={addMilestone}>Meilenstein</Button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {milestones.map(m => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--background-color)' }}>
                                <GripVertical size={16} color="var(--text-secondary)" style={{ cursor: 'grab' }} />
                                <input
                                    defaultValue={m.name}
                                    onBlur={e => updateMilestone(m.id, { name: e.target.value })}
                                    style={{ flex: 1, border: 'none', background: 'transparent', fontWeight: 600, fontSize: '0.88rem', outline: 'none' }}
                                />
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: m.is_completion_trigger ? '#16a34a' : 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    <input
                                        type="checkbox"
                                        checked={m.is_completion_trigger}
                                        onChange={e => updateMilestone(m.id, { is_completion_trigger: e.target.checked })}
                                    />
                                    Abnahme-Trigger
                                </label>
                                <button onClick={() => deleteMilestone(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px' }}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

export default RenovationSettings;
