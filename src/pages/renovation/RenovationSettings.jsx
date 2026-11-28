import React, { useState, useEffect, useRef } from 'react';
import {
    Plus, Trash2, ChevronDown, ChevronRight,
    Loader2, Milestone, Wrench, AlertCircle, RefreshCw
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { translateError } from '../../lib/errorTranslator';
import { STANDARD_POSITION_KEYS } from './calcEngine';

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

const UNIT_OPTIONS = ['Stk.', 'm²', 'm', 'lfm.', 'm³', 'psch.', 'h', 'Wo.', 'je Einheit'];

/* ─── Helper: generate simple unique id for position entries ─── */
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/* ─── Helper: Positionen aus JSONB normalisieren (Array, jede Position mit id) ─── */
const normalizePositions = (raw) => {
    let list = raw;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = []; }
    }
    if (!Array.isArray(list)) return [];
    return list.map(p => (p && p.id ? p : { ...(p || {}), id: uid() }));
};

/* ─── Helper: stabilen Schlüssel für Standardpositionen ergänzen (vor einer Änderung,
       damit eine Umbenennung die Zuordnung in der Kalkulation nicht verliert) ─── */
const withStandardKeys = (positions) => positions.map(p => {
    if (p.key) return p;
    const key = STANDARD_POSITION_KEYS[(p.name || '').trim()];
    return key ? { ...p, key } : p;
});

/* ─── Helper: nächste freie Sortiernummer (keine Duplikate nach Löschungen) ─── */
const nextSortOrder = (items) => items.reduce((max, it) => Math.max(max, Number(it.sort_order) || 0), -1) + 1;

const RenovationSettings = () => {
    const { user } = useAuth();
    const [activeSettingsTab, setActiveSettingsTab] = useState('trades');
    const [trades, setTrades] = useState([]);
    const [milestones, setMilestones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [expandedTrade, setExpandedTrade] = useState(null);
    const [expandedSubtrade, setExpandedSubtrade] = useState(null);

    // Aktueller Stand der Gewerke (synchron), damit aufeinanderfolgende Änderungen
    // immer auf dem neuesten Positions-Array aufbauen und sich nicht überschreiben.
    const tradesRef = useRef([]);
    // Speicher-Warteschlange je Untergewerk: Schreibvorgänge laufen strikt nacheinander.
    const saveQueueRef = useRef({});

    const applyTrades = (next) => {
        tradesRef.current = next;
        setTrades(next);
    };

    useEffect(() => {
        if (user) loadSettings();
    }, [user]);

    /* ─── Load ─── */
    const loadSettings = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            // Laufende Positions-Speicherungen abwarten, sonst könnte ein veralteter Stand geladen
            // werden, auf dem die nächste Änderung aufbaut (und die gespeicherte überschreibt)
            await Promise.all(Object.values(saveQueueRef.current));
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

            if (tradesRes.error) throw tradesRes.error;
            if (milestonesRes.error) throw milestonesRes.error;

            const tradesData = (tradesRes.data || []).map(t => ({
                ...t,
                subtrades: [...(t.subtrades || [])]
                    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                    .map(st => ({ ...st, positions: normalizePositions(st.positions) })),
            }));

            applyTrades(tradesData);
            setMilestones(milestonesRes.data || []);
        } catch (err) {
            console.error('Settings load error:', err);
            setLoadError(translateError(err));
        } finally {
            setLoading(false);
        }
    };

    /* ─── Fehler melden und den gespeicherten Stand neu laden (setzt Eingabefelder zurück) ─── */
    const reportError = async (prefix, err) => {
        console.error(prefix, err);
        alert(`${prefix}: ${translateError(err)}\n\nDie Einstellungen werden neu geladen.`);
        await Promise.all(Object.values(saveQueueRef.current));
        loadSettings();
    };

    /* ─── Reset to Standard Catalog ─── */
    const resetToStandards = async () => {
        if (!window.confirm('Alle Gewerke, Untergewerke und Positionen werden durch den Standard-Katalog ersetzt. Eigene Preise gehen dabei verloren. Fortfahren?')) return;
        setLoading(true);
        let insertedTradeIds = [];
        try {
            // 1. Bestehende Gewerke merken (werden erst nach erfolgreichem Neuanlegen entfernt)
            const { data: oldRows, error: oldErr } = await supabase
                .from('renovation_trades').select('id').eq('user_id', user.id);
            if (oldErr) throw oldErr;
            const oldIds = (oldRows || []).map(r => r.id);

            // 2. Standard-Gewerke in einem Schritt anlegen
            const { data: newTrades, error: tradeErr } = await supabase.from('renovation_trades')
                .insert(DEFAULT_TRADES.map((t, i) => ({ user_id: user.id, name: t.name, sort_order: i })))
                .select('id, sort_order');
            if (tradeErr) throw tradeErr;
            insertedTradeIds = (newTrades || []).map(t => t.id);
            const tradeIdBySort = Object.fromEntries((newTrades || []).map(t => [t.sort_order, t.id]));

            // 3. Alle Untergewerke (Positionen als JSONB mit stabilem Schlüssel) in einem Schritt anlegen
            const subRows = [];
            DEFAULT_TRADES.forEach((t, i) => {
                const tradeId = tradeIdBySort[i];
                if (!tradeId) throw new Error('Gewerk konnte nicht angelegt werden.');
                (t.subs || []).forEach((st, j) => {
                    subRows.push({
                        trade_id: tradeId,
                        user_id: user.id,
                        name: st.name,
                        sort_order: j,
                        positions: (st.positions || []).map(p => ({
                            id: uid(), key: STANDARD_POSITION_KEYS[p.name], name: p.name, unit: p.unit, price: p.price
                        })),
                    });
                });
            });
            const { error: subErr } = await supabase.from('renovation_subtrades').insert(subRows);
            if (subErr) throw subErr;
            insertedTradeIds = [];

            // 4. Erst jetzt den alten Katalog entfernen (Untergewerke per Kaskade)
            if (oldIds.length > 0) {
                const { error: delErr } = await supabase.from('renovation_trades').delete().in('id', oldIds);
                if (delErr) {
                    console.error('Reset cleanup error:', delErr);
                    alert('Der Standard-Katalog wurde angelegt, der bisherige Katalog konnte aber nicht entfernt werden: '
                        + translateError(delErr) + '\nBitte die doppelten Gewerke manuell löschen.');
                    await loadSettings();
                    return;
                }
            }

            await loadSettings();
            alert('Standard-Katalog erfolgreich geladen!');
        } catch (err) {
            console.error('Reset error:', err);
            // Teilweise angelegten Standard-Katalog wieder entfernen – der bisherige Katalog bleibt unverändert
            if (insertedTradeIds.length > 0) {
                await supabase.from('renovation_trades').delete().in('id', insertedTradeIds);
            }
            alert('Standard-Katalog konnte nicht geladen werden: ' + translateError(err) + '\nDer bisherige Katalog ist unverändert.');
            await loadSettings();
        } finally {
            setLoading(false);
        }
    };

    /* ─── Trade CRUD ─── */
    const addTrade = async () => {
        const { error } = await supabase.from('renovation_trades')
            .insert({ user_id: user.id, name: 'Neues Gewerk', sort_order: nextSortOrder(tradesRef.current) });
        if (error) { reportError('Gewerk konnte nicht angelegt werden', error); return; }
        loadSettings();
    };
    const updateTrade = async (id, rawName) => {
        const name = (rawName || '').trim();
        const current = tradesRef.current.find(t => t.id === id);
        if (!current || current.name === name) return;
        if (!name) { alert('Der Name des Gewerks darf nicht leer sein.'); loadSettings(); return; }
        const { error } = await supabase.from('renovation_trades').update({ name }).eq('id', id);
        if (error) { reportError('Gewerk konnte nicht umbenannt werden', error); return; }
        applyTrades(tradesRef.current.map(t => (t.id === id ? { ...t, name } : t)));
    };
    const deleteTrade = async (id) => {
        if (!window.confirm('Gewerk und alle Untergewerke löschen?')) return;
        const { error } = await supabase.from('renovation_trades').delete().eq('id', id);
        if (error) { reportError('Gewerk konnte nicht gelöscht werden', error); return; }
        loadSettings();
    };

    /* ─── Subtrade CRUD ─── */
    const findSubtrade = (subtradeId) => {
        for (const t of tradesRef.current) {
            const st = (t.subtrades || []).find(s => s.id === subtradeId);
            if (st) return st;
        }
        return null;
    };
    const updateSubtradeLocal = (subtradeId, changes) => {
        applyTrades(tradesRef.current.map(t => ((t.subtrades || []).some(s => s.id === subtradeId)
            ? { ...t, subtrades: t.subtrades.map(s => (s.id === subtradeId ? { ...s, ...changes } : s)) }
            : t)));
    };

    const addSubtrade = async (tradeId) => {
        const trade = tradesRef.current.find(t => t.id === tradeId);
        const { error } = await supabase.from('renovation_subtrades').insert({
            trade_id: tradeId, user_id: user.id, name: 'Neues Untergewerk',
            sort_order: nextSortOrder(trade?.subtrades || []), positions: []
        });
        if (error) { reportError('Untergewerk konnte nicht angelegt werden', error); return; }
        loadSettings();
    };
    const updateSubtradeName = async (id, rawName) => {
        const name = (rawName || '').trim();
        const current = findSubtrade(id);
        if (!current || current.name === name) return;
        if (!name) { alert('Der Name des Untergewerks darf nicht leer sein.'); loadSettings(); return; }
        const { error } = await supabase.from('renovation_subtrades').update({ name }).eq('id', id);
        if (error) { reportError('Untergewerk konnte nicht umbenannt werden', error); return; }
        updateSubtradeLocal(id, { name });
    };
    const deleteSubtrade = async (id) => {
        if (!window.confirm('Untergewerk und alle Positionen löschen?')) return;
        const { error } = await supabase.from('renovation_subtrades').delete().eq('id', id);
        if (error) { reportError('Untergewerk konnte nicht gelöscht werden', error); return; }
        loadSettings();
    };

    /* ─── Position CRUD (JSONB in subtrade) ───
       Jede Änderung baut auf dem aktuellen lokalen Stand auf (tradesRef), aktualisiert
       ihn sofort und speichert das komplette Array über eine Warteschlange je Untergewerk. */
    const savePositions = (subtradeId, positions) => {
        const previous = saveQueueRef.current[subtradeId] || Promise.resolve(true);
        const run = previous.then(async () => {
            const { error } = await supabase.from('renovation_subtrades')
                .update({ positions })
                .eq('id', subtradeId);
            if (error) throw error;
            return true;
        });
        const handled = run.catch(err => {
            reportError('Positionen konnten nicht gespeichert werden', err);
            return false;
        });
        saveQueueRef.current[subtradeId] = handled;
        return handled;
    };

    const changePositions = (subtradeId, mutate) => {
        const st = findSubtrade(subtradeId);
        if (!st) return Promise.resolve(false);
        const before = withStandardKeys(st.positions || []);
        const next = mutate(before);
        if (!next) return Promise.resolve(true);
        updateSubtradeLocal(subtradeId, { positions: next });
        return savePositions(subtradeId, next);
    };

    const addPosition = (subtradeId) => changePositions(subtradeId, positions => [
        ...positions, { id: uid(), name: 'Neue Position', unit: 'Stk.', price: 0 }
    ]);

    const updatePosition = (subtradeId, posId, field, value) => changePositions(subtradeId, positions => {
        const current = positions.find(p => p.id === posId);
        if (!current || current[field] === value) return null; // keine Änderung → nichts speichern
        return positions.map(p => (p.id === posId ? { ...p, [field]: value } : p));
    });

    // Rückfrage wie bei Gewerk/Untergewerk – ein Fehlklick würde den Katalogpreis sofort entfernen
    const deletePosition = (subtradeId, posId) => {
        if (!window.confirm('Position löschen?')) return;
        changePositions(subtradeId, positions => positions.filter(p => p.id !== posId));
    };

    /* ─── Milestone CRUD ─── */
    const addMilestone = async () => {
        const { error } = await supabase.from('renovation_milestone_templates').insert({
            user_id: user.id, name: 'Neuer Meilenstein',
            sort_order: nextSortOrder(milestones), is_completion_trigger: false
        });
        if (error) { reportError('Meilenstein konnte nicht angelegt werden', error); return; }
        loadSettings();
    };
    const updateMilestone = async (id, updates) => {
        const current = milestones.find(m => m.id === id);
        if (current && Object.keys(updates).every(k => current[k] === updates[k])) return;
        if ('name' in updates && !(updates.name || '').trim()) {
            alert('Der Name des Meilensteins darf nicht leer sein.');
            loadSettings();
            return;
        }
        const clean = 'name' in updates ? { ...updates, name: updates.name.trim() } : updates;
        const { error } = await supabase.from('renovation_milestone_templates').update(clean).eq('id', id);
        if (error) { reportError('Meilenstein konnte nicht gespeichert werden', error); return; }
        setMilestones(prev => prev.map(m => (m.id === id ? { ...m, ...clean } : m)));
    };
    const deleteMilestone = async (id) => {
        if (!window.confirm('Meilenstein-Vorlage löschen?')) return;
        const { error } = await supabase.from('renovation_milestone_templates').delete().eq('id', id);
        if (error) { reportError('Meilenstein konnte nicht gelöscht werden', error); return; }
        loadSettings();
    };

    /* ─── Render ─── */

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" /></div>;

    // Ladefehler: nichts anbieten, was den (vorhandenen) Katalog überschreiben könnte
    if (loadError) {
        return (
            <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', color: '#991B1B' }}>
                <h4 style={{ fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={20} /> Einstellungen konnten nicht geladen werden
                </h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>{loadError}</p>
                <Button size="sm" icon={RefreshCw} onClick={loadSettings}>Erneut laden</Button>
            </div>
        );
    }

    return (
        <div>
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
                                                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 90px 28px', gap: '8px', marginBottom: '6px' }}>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Position</span>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Einheit</span>
                                                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'right' }}>EP (€)</span>
                                                                    <span></span>
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                {positions.map(pos => (
                                                                    <div key={pos.id} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 90px 28px', gap: '8px', alignItems: 'center' }}>
                                                                        <input
                                                                            defaultValue={pos.name}
                                                                            onBlur={e => {
                                                                                const name = e.target.value.trim();
                                                                                if (!name) { e.target.value = pos.name; return; } // leerer Name → alten Namen behalten
                                                                                updatePosition(st.id, pos.id, 'name', name);
                                                                            }}
                                                                            style={{ width: '100%', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px 6px', fontSize: '0.82rem', outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                        />
                                                                        <select
                                                                            defaultValue={pos.unit || 'Stk.'}
                                                                            onChange={e => updatePosition(st.id, pos.id, 'unit', e.target.value)}
                                                                            style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px 4px', fontSize: '0.78rem', outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                        >
                                                                            {[...UNIT_OPTIONS, ...(pos.unit && !UNIT_OPTIONS.includes(pos.unit) ? [pos.unit] : [])].map(u => <option key={u} value={u}>{u}</option>)}
                                                                        </select>
                                                                        <input
                                                                            type="number" step="0.01" min="0"
                                                                            defaultValue={pos.price || ''}
                                                                            onBlur={e => {
                                                                                const v = Number(e.target.value);
                                                                                // Keine negativen/ungültigen Preise, auf Cent gerundet
                                                                                const price = Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
                                                                                if (e.target.value !== '' && Number(e.target.value) !== price) e.target.value = price || '';
                                                                                updatePosition(st.id, pos.id, 'price', price);
                                                                            }}
                                                                            style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '5px', fontSize: '0.82rem', outline: 'none', textAlign: 'right', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                                                                        />
                                                                        <button onClick={() => deletePosition(st.id, pos.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}>
                                                                            <Trash2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <button
                                                                onClick={() => addPosition(st.id)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', marginTop: '8px' }}
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
                                <input
                                    defaultValue={m.name}
                                    onBlur={e => updateMilestone(m.id, { name: e.target.value })}
                                    style={{ flex: 1, border: 'none', background: 'transparent', fontWeight: 600, fontSize: '0.88rem', outline: 'none' }}
                                />
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: m.is_completion_trigger ? '#16a34a' : 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!m.is_completion_trigger}
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
