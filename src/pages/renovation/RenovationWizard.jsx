import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronLeft, ChevronRight, Building2, Wrench, Calendar,
    CheckCircle2, Loader2, HardHat, Plus, ChevronDown, AlertTriangle, Settings as SettingsIcon
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { translateError } from '../../lib/errorTranslator';
import { fmtEUR0, round2, formatDateDE } from '../../components/renovation/renovationUtils';

const STEPS = [
    { label: 'Objekt', icon: Building2 },
    { label: 'Gewerke', icon: Wrench },
    { label: 'Details', icon: Calendar },
    { label: 'Erstellen', icon: CheckCircle2 },
];

const RenovationWizard = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const navigate = useNavigate();

    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // Step 1: Objekt
    const [properties, setProperties] = useState([]);
    const [propertiesError, setPropertiesError] = useState(null);
    const [units, setUnits] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState('');
    const [selectedUnit, setSelectedUnit] = useState('');

    // Step 2: Gewerke – expanded / selected subtrades with budget + contact
    const [tradeTemplates, setTradeTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templatesError, setTemplatesError] = useState(null);
    // Vorlagen stammen vom Eigentümer des gewählten Objekts (bei geteilten Portfolios),
    // sonst bzw. ersatzweise vom eigenen Konto. requested = angefragt, used = tatsächlich geladen.
    const [templateSource, setTemplateSource] = useState({ requested: null, used: null });
    const [selectedTrades, setSelectedTrades] = useState([]); // trade IDs
    const [expandedTrade, setExpandedTrade] = useState(null);
    // Map: subtrade template id -> { selected: bool, budget_soll: number, contact_id: string }
    const [subtradeConfig, setSubtradeConfig] = useState({});

    // Step 3: Details
    const [projectName, setProjectName] = useState('');
    const [nameIsAuto, setNameIsAuto] = useState(false);
    const [targetEndDate, setTargetEndDate] = useState('');

    // Contacts (Dienstleister/Handwerker only)
    const [contacts, setContacts] = useState([]);
    const [showContactModal, setShowContactModal] = useState(false);
    const [contactForSubtrade, setContactForSubtrade] = useState(null); // subtrade id to assign after creation
    const [newContact, setNewContact] = useState({ contact_type: 'vendor', name: '', email: '', phone: '', street: '', zip: '', city: '' });

    // Eigentümer eines Objekts (Portfolio-Eigentümer; Fallback: Ersteller des Objekts / eigenes Konto)
    const ownerOf = (prop) => prop?.portfolio?.user_id || prop?.user_id || user.id;
    // Konto, dem die angelegten Projektdaten gehören (user_id): der Portfolio-Eigentümer, damit
    // Projekt, Gewerke, Meilensteine und Rechnungen nicht am Konto eines Teammitglieds hängen
    // (ON DELETE CASCADE). Die Datenbank lässt als user_id das eigene Konto oder den
    // Portfolio-Eigentümer zu (rls_user_ok); ohne lesbares Portfolio bleibt es das eigene Konto.
    // Den Ersteller eines Projekts hält die Datenbank in renovation_projects.created_by fest.
    const dataOwnerOf = (prop) => prop?.portfolio?.user_id || user.id;

    /* ─── Gewerke-Vorlagen laden ────── */
    const loadTemplates = async (ownerId) => {
        const query = (uid) => supabase.from('renovation_trades').select('*, subtrades:renovation_subtrades(*)').eq('user_id', uid).order('sort_order');
        let res = await query(ownerId);
        let usedOwner = ownerId;
        // Keine (lesbaren) Vorlagen des Eigentümers → eigene Vorlagen verwenden
        if (ownerId !== user.id && (res.error || (res.data || []).length === 0)) {
            res = await query(user.id);
            usedOwner = user.id;
        }
        if (res.error) {
            console.error('Error loading trade templates:', res.error);
            setTemplatesError(translateError(res.error));
            setTradeTemplates([]);
        } else {
            setTemplatesError(null);
            setTradeTemplates((res.data || []).map(t => ({ ...t, subtrades: (t.subtrades || []).sort((a, b) => a.sort_order - b.sort_order) })));
        }
        setTemplateSource({ requested: ownerId, used: usedOwner });
        setTemplatesLoading(false);
    };

    /* ─── Kontakte: eigene + die des Objekt-Eigentümers (RLS entscheidet) ────── */
    const loadContacts = async (ownerId) => {
        const ids = [...new Set([user.id, ownerId].filter(Boolean))];
        const { data, error } = await supabase.from('contacts').select('id, name, phone, email, contact_type').in('user_id', ids).eq('contact_type', 'vendor').order('name');
        if (error) { console.error('Error loading contacts:', error); return; }
        setContacts(data || []);
    };

    const fetchData = async () => {
        let q = supabase.from('properties').select('id, street, house_number, city, zip, user_id, portfolio:portfolios(user_id)');
        if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
        const propRes = await q.order('street');
        if (propRes.error) {
            console.error('Error loading properties:', propRes.error);
            setPropertiesError(translateError(propRes.error));
            setProperties([]);
        } else {
            setPropertiesError(null);
            setProperties(propRes.data || []);
        }
        await Promise.all([loadTemplates(user.id), loadContacts(user.id)]);
        // Do NOT pre-select trades. Nach Neuladen (z. B. Portfolio-Wechsel) passen Objekt und
        // Vorlagen nicht mehr zusammen → Auswahl zurücksetzen und bei Schritt 1 beginnen.
        setSelectedProperty('');
        setSelectedUnit('');
        if (nameIsAuto) { setProjectName(''); setNameIsAuto(false); }
        setSelectedTrades([]);
        setSubtradeConfig({});
        setExpandedTrade(null);
        setStep(0);
        setLoading(false);
    };

    useEffect(() => { if (user) fetchData(); }, [user, selectedPortfolioID]);

    // Load units when property changes
    useEffect(() => {
        if (!selectedProperty) { setUnits([]); return; }
        const go = async () => {
            const { data, error } = await supabase.from('units').select('id, unit_name').eq('property_id', selectedProperty).order('unit_name');
            if (error) console.error('Error loading units:', error);
            setUnits(data || []);
        };
        go();
    }, [selectedProperty]);

    /* ─── Objekt wählen: Projektname vorbelegen, Vorlagen des Eigentümers laden ────── */
    const handlePropertyChange = async (propId) => {
        setSelectedProperty(propId);
        setSelectedUnit('');
        const prop = properties.find(p => p.id === propId);
        // Automatisch erzeugten Namen bei Objektwechsel neu bilden, manuell geänderten behalten
        if (prop && (!projectName || nameIsAuto)) {
            setProjectName(`Sanierung ${prop.street} ${prop.house_number || ''}`.trim());
            setNameIsAuto(true);
        } else if (!prop && nameIsAuto) {
            setProjectName('');
        }
        const owner = prop ? ownerOf(prop) : user.id;
        if (owner !== templateSource.requested) {
            // Andere Vorlagen → bisherige Auswahl passt nicht mehr
            setSelectedTrades([]);
            setSubtradeConfig({});
            setExpandedTrade(null);
            setTemplatesLoading(true);
            await Promise.all([loadTemplates(owner), loadContacts(owner)]);
        }
    };

    /* ─── Trade toggle ────── */
    // Beide States getrennt und jeweils funktional aktualisieren (keine Seiteneffekte im Updater)
    const toggleTrade = (id) => {
        if (selectedTrades.includes(id)) {
            // Deselect trade → deselect all its subtrades
            const trade = tradeTemplates.find(t => t.id === id);
            const subIds = (trade?.subtrades || []).map(st => st.id);
            setSubtradeConfig(prev => {
                const next = { ...prev };
                subIds.forEach(sid => { delete next[sid]; });
                return next;
            });
            setSelectedTrades(prev => prev.filter(x => x !== id));
            setExpandedTrade(prev => (prev === id ? null : prev));
        } else {
            setSelectedTrades(prev => (prev.includes(id) ? prev : [...prev, id]));
            setExpandedTrade(id);
        }
    };

    /* ─── Subtrade config ────── */
    const toggleSubtrade = (subId) => {
        setSubtradeConfig(prev => {
            const cur = prev[subId];
            if (cur?.selected) {
                const { [subId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [subId]: { selected: true, budget_soll: cur?.budget_soll || 0, contact_id: cur?.contact_id || '' } };
        });
    };

    const updateSubtradeField = (subId, field, value) => {
        setSubtradeConfig(prev => ({
            ...prev,
            [subId]: { ...prev[subId], [field]: value },
        }));
    };

    /* ─── Create new contact ────── */
    const openNewContact = (forSubtradeId) => {
        setContactForSubtrade(forSubtradeId);
        setNewContact({ contact_type: 'vendor', name: '', email: '', phone: '', street: '', zip: '', city: '' });
        setShowContactModal(true);
    };

    const saveNewContact = async () => {
        if (!newContact.name) return alert('Name ist erforderlich.');
        const { data, error } = await supabase.from('contacts').insert({
            user_id: user.id,
            name: newContact.name,
            contact_type: newContact.contact_type || 'vendor',
            email: newContact.email || null,
            phone: newContact.phone || null,
            street: newContact.street || null,
            zip: newContact.zip || null,
            city: newContact.city || null,
        }).select().single();
        if (error) { alert('Fehler: ' + translateError(error)); return; }
        // Add to local contacts list
        setContacts(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        // Assign to subtrade if applicable
        if (contactForSubtrade && data) {
            updateSubtradeField(contactForSubtrade, 'contact_id', data.id);
        }
        setShowContactModal(false);
    };

    /* ─── Computed ────── */
    const totalBudget = useMemo(() => {
        return Object.values(subtradeConfig).reduce((sum, cfg) => sum + (cfg.selected ? Number(cfg.budget_soll || 0) : 0), 0);
    }, [subtradeConfig]);

    const selectedSubtradeCount = useMemo(() => {
        return Object.values(subtradeConfig).filter(c => c.selected).length;
    }, [subtradeConfig]);

    // Budget und Rechnungen hängen an Untergewerken → jedes gewählte Gewerk braucht mindestens eins
    const tradesWithoutSubtrade = selectedTrades
        .map(tid => tradeTemplates.find(t => t.id === tid))
        .filter(t => t && !(t.subtrades || []).some(st => subtradeConfig[st.id]?.selected));
    const hasInvalidBudget = Object.values(subtradeConfig).some(c => {
        if (!c.selected) return false;
        const n = Number(c.budget_soll || 0);
        return !Number.isFinite(n) || n < 0;
    });

    const canNext = () => {
        if (step === 0) return !!selectedProperty && !templatesLoading;
        if (step === 1) return selectedTrades.length > 0 && tradesWithoutSubtrade.length === 0 && !hasInvalidBudget;
        if (step === 2) return !!projectName.trim();
        return true;
    };

    /* ─── Create Project ────── */
    // Alle Teile werden mit Fehlerprüfung angelegt (Gewerke, Untergewerke und Meilensteine jeweils
    // gesammelt in einem Insert). Schlägt ein Schritt fehl, wird das angelegte Projekt wieder
    // gelöscht (abhängige Zeilen per ON DELETE CASCADE), damit kein unvollständiges Projekt bleibt.
    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        let projectId = null;
        try {
            const ownerForTemplates = templateSource.used || user.id;
            // Meilenstein-Vorlagen zuerst laden – schlägt das fehl, wird gar nichts angelegt
            const { data: msData, error: msErr } = await supabase.from('renovation_milestone_templates').select('*').eq('user_id', ownerForTemplates).order('sort_order');
            if (msErr) throw msErr;
            const milestoneTemplates = msData || [];
            const dataOwner = dataOwnerOf(properties.find(p => p.id === selectedProperty));

            const { data: project, error: projErr } = await supabase.from('renovation_projects').insert({
                user_id: dataOwner,
                property_id: selectedProperty,
                unit_id: selectedUnit || null,
                name: projectName.trim(),
                target_end_date: targetEndDate || null,
                budget_buffer_percent: 0,
                status: 'active',
            }).select('id').single();
            if (projErr) throw projErr;
            projectId = project.id;

            const tradePlan = selectedTrades
                .map((tid, i) => ({ tmpl: tradeTemplates.find(t => t.id === tid), sort_order: i }))
                .filter(x => x.tmpl);

            if (tradePlan.length > 0) {
                const { data: insertedTrades, error: ptErr } = await supabase.from('renovation_project_trades').insert(
                    tradePlan.map(x => ({ project_id: projectId, user_id: dataOwner, name: x.tmpl.name, sort_order: x.sort_order, status: 'open' }))
                ).select('id, sort_order');
                if (ptErr) throw ptErr;
                if ((insertedTrades || []).length !== tradePlan.length) throw new Error('Nicht alle Gewerke konnten angelegt werden.');
                const tradeIdBySort = new Map(insertedTrades.map(r => [r.sort_order, r.id]));

                const subtradeRows = [];
                const milestoneRows = [];
                tradePlan.forEach(x => {
                    const ptId = tradeIdBySort.get(x.sort_order);
                    if (!ptId) throw new Error('Gewerk-Zuordnung fehlgeschlagen.');
                    // Only insert selected subtrades with their config
                    const selectedSubs = (x.tmpl.subtrades || []).filter(st => subtradeConfig[st.id]?.selected);
                    selectedSubs.forEach((st, j) => {
                        const cfg = subtradeConfig[st.id] || {};
                        subtradeRows.push({
                            project_trade_id: ptId, project_id: projectId, user_id: dataOwner,
                            name: st.name, sort_order: j,
                            budget_soll: round2(cfg.budget_soll),
                            responsible_contact_id: cfg.contact_id || null,
                        });
                    });
                    milestoneTemplates.forEach((m, k) => {
                        milestoneRows.push({
                            project_trade_id: ptId, user_id: dataOwner,
                            name: m.name, sort_order: k,
                            is_completion_trigger: !!m.is_completion_trigger,
                        });
                    });
                });

                if (subtradeRows.length > 0) {
                    const { error: stErr } = await supabase.from('renovation_project_subtrades').insert(subtradeRows);
                    if (stErr) throw stErr;
                }
                if (milestoneRows.length > 0) {
                    const { error: mErr } = await supabase.from('renovation_milestones').insert(milestoneRows);
                    if (mErr) throw mErr;
                }
            }

            navigate(`/renovation/${projectId}`);
        } catch (err) {
            console.error('Create project error:', err);
            let msg = 'Fehler beim Erstellen: ' + translateError(err);
            if (projectId) {
                const { error: delErr } = await supabase.from('renovation_projects').delete().eq('id', projectId);
                msg += delErr
                    ? '\n\nDas unvollständig angelegte Projekt konnte nicht automatisch entfernt werden. Bitte in der Projektübersicht löschen und neu anlegen.'
                    : '\n\nDas unvollständig angelegte Projekt wurde wieder entfernt. Bitte erneut versuchen.';
            }
            alert(msg);
        } finally {
            setCreating(false);
        }
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    const selectedPropObj = properties.find(p => p.id === selectedProperty);

    return (
        <div style={{ maxWidth: '780px', margin: '0 auto' }}>
            {/* Back */}
            <button onClick={() => navigate('/renovation')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
                <ChevronLeft size={16} /> Zurück zur Übersicht
            </button>

            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HardHat size={24} color="#f59e0b" /> Neues Sanierungsprojekt
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '24px' }}>
                Schritt {step + 1} von {STEPS.length}: {STEPS[step].label}
            </p>

            {/* Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '28px' }}>
                {STEPS.map((s, i) => (
                    <React.Fragment key={i}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: i <= step ? '#0ea5e9' : 'var(--border-color)',
                            color: i <= step ? '#fff' : 'var(--text-secondary)',
                            fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.3s',
                        }}>
                            {React.createElement(s.icon, { size: 16 })}
                        </div>
                        {i < STEPS.length - 1 && <div style={{ flex: 1, height: '2px', background: i < step ? '#0ea5e9' : 'var(--border-color)', transition: 'all 0.3s' }} />}
                    </React.Fragment>
                ))}
            </div>

            {/* Step Content */}
            <Card style={{ marginBottom: '20px' }}>
                {/* ═══ STEP 1: OBJEKT ═══ */}
                {step === 0 && (
                    <div>
                        <h3 style={{ fontWeight: 700, marginBottom: '12px' }}>Immobilie wählen</h3>
                        {propertiesError && (
                            <div style={errorBoxStyle}>
                                <AlertTriangle size={15} />
                                <span style={{ flex: 1 }}>Immobilien konnten nicht geladen werden: {propertiesError}</span>
                                <Button size="sm" variant="secondary" onClick={fetchData}>Erneut laden</Button>
                            </div>
                        )}
                        <select value={selectedProperty} onChange={e => handlePropertyChange(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.9rem', background: 'var(--surface-color)', marginBottom: '12px' }}>
                            <option value="">— Immobilie wählen —</option>
                            {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.zip} {p.city}</option>)}
                        </select>
                        {units.length > 0 && (
                            <>
                                <h3 style={{ fontWeight: 700, marginBottom: '8px', marginTop: '16px' }}>Einheit (optional)</h3>
                                <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)}
                                    style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.9rem', background: 'var(--surface-color)' }}>
                                    <option value="">Gesamtes Objekt</option>
                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                            </>
                        )}
                    </div>
                )}

                {/* ═══ STEP 2: GEWERKE MIT UNTERGEWERKE, BUDGET, VERANTWORTLICHER ═══ */}
                {step === 1 && (
                    <div>
                        <h3 style={{ fontWeight: 700, marginBottom: '6px' }}>Gewerke & Untergewerke auswählen</h3>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Wähle die Gewerke und deren Untergewerke. Setze Budget und Dienstleister/Handwerker.
                        </p>

                        {templatesLoading && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}><Loader2 className="animate-spin" size={22} /></div>
                        )}

                        {!templatesLoading && templatesError && (
                            <div style={errorBoxStyle}>
                                <AlertTriangle size={15} />
                                <span style={{ flex: 1 }}>Gewerke-Vorlagen konnten nicht geladen werden: {templatesError}</span>
                                <Button size="sm" variant="secondary" onClick={() => { setTemplatesLoading(true); loadTemplates(templateSource.requested || user.id); }}>Erneut laden</Button>
                            </div>
                        )}

                        {!templatesLoading && !templatesError && tradeTemplates.length === 0 && (
                            <div style={{ padding: '20px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                                <Wrench size={28} style={{ opacity: 0.35, marginBottom: '8px' }} />
                                <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Noch keine Gewerke-Vorlagen vorhanden</p>
                                <p style={{ marginBottom: '14px' }}>Lade in den Einstellungen des Sanierungsmanagers den Standard-Katalog oder lege eigene Gewerke an.</p>
                                <Button size="sm" icon={SettingsIcon} onClick={() => navigate('/renovation?tab=settings')}>Zu den Einstellungen</Button>
                            </div>
                        )}

                        {!templatesLoading && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {tradeTemplates.map(t => {
                                    const isSelected = selectedTrades.includes(t.id);
                                    const isExpanded = expandedTrade === t.id;
                                    const tradeSubCount = (t.subtrades || []).filter(st => subtradeConfig[st.id]?.selected).length;
                                    const tradeBudget = (t.subtrades || []).reduce((s, st) => s + (subtradeConfig[st.id]?.selected ? Number(subtradeConfig[st.id]?.budget_soll || 0) : 0), 0);

                                    return (
                                        <div key={t.id} style={{ border: isSelected ? '2px solid #0ea5e9' : '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', transition: 'all 0.15s' }}>
                                            {/* Trade Header */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: isSelected ? '#e0f2fe' : 'var(--surface-color)', cursor: 'pointer' }}
                                                onClick={() => { if (!isSelected) { toggleTrade(t.id); } else { setExpandedTrade(isExpanded ? null : t.id); } }}>
                                                {/* Klick auf die Checkbox darf nicht zusätzlich den Zeilen-Handler auslösen */}
                                                <input type="checkbox" checked={isSelected}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={() => toggleTrade(t.id)}
                                                    style={{ width: '18px', height: '18px', accentColor: '#0ea5e9', cursor: 'pointer' }} />
                                                <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>{t.name}</span>
                                                {isSelected && tradeSubCount > 0 && (
                                                    <span style={{ fontSize: '0.72rem', color: '#0ea5e9', fontWeight: 600 }}>{tradeSubCount} Untergewerke • {fmtEUR0(tradeBudget)}</span>
                                                )}
                                                {isSelected && tradeSubCount === 0 && (
                                                    <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>Untergewerk wählen</span>
                                                )}
                                                {isSelected && <ChevronDown size={16} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-secondary)' }} />}
                                            </div>

                                            {/* Subtrades (expanded) */}
                                            {isSelected && isExpanded && (
                                                <div style={{ padding: '8px 14px 14px', background: 'var(--background-color)', borderTop: '1px solid var(--border-color)' }}>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '8px' }}>Untergewerke</div>
                                                    {(t.subtrades || []).length === 0 && (
                                                        <p style={{ fontSize: '0.8rem', color: '#b45309' }}>Für dieses Gewerk sind keine Untergewerke hinterlegt. Bitte in den Einstellungen ergänzen oder das Gewerk abwählen.</p>
                                                    )}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {(t.subtrades || []).map(st => {
                                                            const cfg = subtradeConfig[st.id];
                                                            const isSel = cfg?.selected;
                                                            const budgetInvalid = isSel && (Number(cfg.budget_soll || 0) < 0 || !Number.isFinite(Number(cfg.budget_soll || 0)));
                                                            return (
                                                                <div key={st.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: isSel ? '10px 12px' : '8px 12px', background: 'var(--surface-color)', transition: 'all 0.15s' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <input type="checkbox" checked={!!isSel} onChange={() => toggleSubtrade(st.id)}
                                                                            style={{ width: '16px', height: '16px', accentColor: '#0ea5e9', cursor: 'pointer' }} />
                                                                        <span style={{ fontWeight: 500, fontSize: '0.85rem', flex: 1 }}>{st.name}</span>
                                                                    </div>
                                                                    {isSel && (
                                                                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', marginLeft: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                                            <div style={{ minWidth: '120px' }}>
                                                                                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Budget Soll (€)</label>
                                                                                <input type="number" min="0" step="0.01" value={cfg.budget_soll || ''} onChange={e => updateSubtradeField(st.id, 'budget_soll', e.target.value)}
                                                                                    placeholder="0"
                                                                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${budgetInvalid ? '#dc2626' : 'var(--border-color)'}`, fontSize: '0.82rem', outline: 'none' }} />
                                                                            </div>
                                                                            <div style={{ flex: 1, minWidth: '160px' }}>
                                                                                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Dienstleister/Handwerker</label>
                                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                                    <select value={cfg.contact_id || ''} onChange={e => updateSubtradeField(st.id, 'contact_id', e.target.value)}
                                                                                        style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--surface-color)' }}>
                                                                                        <option value="">— Nicht zugewiesen —</option>
                                                                                        {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                                    </select>
                                                                                    <button onClick={() => openNewContact(st.id)} title="Neuen Kontakt anlegen"
                                                                                        style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#0ea5e9' }}>
                                                                                        <Plus size={14} />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {selectedTrades.length > 0 && (
                            <div style={{ marginTop: '16px', padding: '12px 14px', background: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <span><strong>{selectedTrades.length}</strong> Gewerke, <strong>{selectedSubtradeCount}</strong> Untergewerke gewählt</span>
                                <span style={{ fontWeight: 700, color: '#0ea5e9' }}>Budget: {fmtEUR0(totalBudget)}</span>
                            </div>
                        )}
                        {tradesWithoutSubtrade.length > 0 && (
                            <p style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '10px', fontSize: '0.8rem', color: '#b45309' }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                                Bitte für jedes gewählte Gewerk mindestens ein Untergewerk auswählen (Budget und Rechnungen werden je Untergewerk erfasst): {tradesWithoutSubtrade.map(t => t.name).join(', ')}
                            </p>
                        )}
                        {hasInvalidBudget && (
                            <p style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '0.8rem', color: '#dc2626' }}>
                                <AlertTriangle size={14} /> Budgets dürfen nicht negativ sein.
                            </p>
                        )}
                    </div>
                )}

                {/* ═══ STEP 3: DETAILS (kein Puffer) ═══ */}
                {step === 2 && (
                    <div>
                        <h3 style={{ fontWeight: 700, marginBottom: '12px' }}>Projektdetails</h3>
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Projektname</label>
                            <input value={projectName} onChange={e => { setProjectName(e.target.value); setNameIsAuto(false); }}
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.9rem', outline: 'none' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Ziel-Enddatum (optional)</label>
                            <input type="date" value={targetEndDate} onChange={e => setTargetEndDate(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.9rem' }} />
                        </div>
                    </div>
                )}

                {/* ═══ STEP 4: ZUSAMMENFASSUNG ═══ */}
                {step === 3 && (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <CheckCircle2 size={48} color="#16a34a" style={{ marginBottom: '12px' }} />
                        <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '8px' }}>Zusammenfassung</h3>
                        <div style={{ textAlign: 'left', maxWidth: '440px', margin: '0 auto', fontSize: '0.9rem', lineHeight: '2' }}>
                            <div><strong>Name:</strong> {projectName}</div>
                            <div><strong>Objekt:</strong> {selectedPropObj?.street} {selectedPropObj?.house_number}</div>
                            {selectedUnit && <div><strong>Einheit:</strong> {units.find(u => u.id === selectedUnit)?.unit_name}</div>}
                            <div><strong>Gewerke:</strong> {selectedTrades.length}</div>
                            <div><strong>Untergewerke:</strong> {selectedSubtradeCount}</div>
                            <div><strong>Budget gesamt:</strong> <span style={{ color: '#0ea5e9', fontWeight: 700 }}>{fmtEUR0(totalBudget)}</span></div>
                            {targetEndDate && <div><strong>Ziel:</strong> {formatDateDE(targetEndDate)}</div>}
                        </div>
                    </div>
                )}
            </Card>

            {/* Navigation Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button variant="secondary" onClick={() => step > 0 ? setStep(step - 1) : navigate('/renovation')} icon={ChevronLeft} disabled={creating}>
                    {step === 0 ? 'Abbrechen' : 'Zurück'}
                </Button>
                {step < STEPS.length - 1 ? (
                    <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
                        Weiter <ChevronRight size={16} style={{ marginLeft: '4px' }} />
                    </Button>
                ) : (
                    <Button onClick={handleCreate} disabled={creating}>
                        {creating ? <><Loader2 className="animate-spin" size={16} style={{ marginRight: '6px' }} /> Erstelle...</> : 'Projekt erstellen'}
                    </Button>
                )}
            </div>

            {/* New Contact Modal */}
            <Modal isOpen={showContactModal} onClose={() => setShowContactModal(false)} title="Neuen Kontakt anlegen"
                footer={<><Button variant="secondary" onClick={() => setShowContactModal(false)}>Abbrechen</Button><Button onClick={saveNewContact}>Speichern & Zuweisen</Button></>}>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Typ</label>
                    <select
                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--surface-color)' }}
                        value={newContact.contact_type}
                        onChange={e => setNewContact({ ...newContact, contact_type: e.target.value })}
                    >
                        <option value="other">Sonstiges</option>
                        <option value="vendor">Dienstleister / Handwerker</option>
                        <option value="tenant">Mieter</option>
                        <option value="guest">Gast</option>
                    </select>
                </div>
                <Input label="Name / Firma" placeholder="Muster GmbH" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="E-Mail" type="email" placeholder="info@..." value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
                    <Input label="Telefon" placeholder="+49..." value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} />
                </div>
                <Input label="Straße & Nr." placeholder="" value={newContact.street} onChange={e => setNewContact({ ...newContact, street: e.target.value })} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input label="PLZ" placeholder="" value={newContact.zip} onChange={e => setNewContact({ ...newContact, zip: e.target.value })} />
                    <Input label="Ort" placeholder="" value={newContact.city} onChange={e => setNewContact({ ...newContact, city: e.target.value })} />
                </div>
            </Modal>
        </div>
    );
};

const errorBoxStyle = {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '12px',
    borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#b91c1c', fontSize: '0.85rem', flexWrap: 'wrap',
};

export default RenovationWizard;
