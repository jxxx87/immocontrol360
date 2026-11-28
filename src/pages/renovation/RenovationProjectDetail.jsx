import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ChevronLeft, ChevronDown, ChevronRight, Building2, Calendar,
    Loader2, Plus, Trash2, CheckCircle2, Circle,
    DollarSign, TrendingUp, AlertTriangle, BarChart3, Milestone
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import GanttChart from '../../components/renovation/GanttChart';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePermission } from '../../context/PermissionContext';
import { useViewMode } from '../../context/ViewModeContext';
import { translateError } from '../../lib/errorTranslator';
import {
    fmtEUR, round2, localDateStr, parseLocalDate, formatDateDE, assertWrite
} from '../../components/renovation/renovationUtils';

const STATUS_MAP = {
    planned: { label: 'Geplant', color: '#64748b', bg: '#f1f5f9' },
    active: { label: 'Aktiv', color: '#0ea5e9', bg: '#e0f2fe' },
    completed: { label: 'Abgeschlossen', color: '#16a34a', bg: '#dcfce7' },
    archived: { label: 'Archiviert', color: '#9ca3af', bg: '#f3f4f6' },
};

const TRADE_STATUS = {
    open: { label: 'Offen', color: '#64748b', bg: '#f1f5f9' },
    in_progress: { label: 'In Arbeit', color: '#f59e0b', bg: '#fef3c7' },
    completed: { label: 'Fertig', color: '#16a34a', bg: '#dcfce7' },
};

// Plausibilitätsgrenze für einzelne Rechnungsbeträge (darüber Rückfrage)
const INVOICE_CONFIRM_LIMIT = 1000000;

// Supabase-Filter "Spalte = Wert" bzw. "Spalte IS NULL" (für Vergleich-und-Tausch-Updates)
const eqOrNull = (query, column, value) => (value === null || value === undefined ? query.is(column, null) : query.eq(column, value));

/**
 * Betrag zu properties.total_investment_cost addieren (negativ = zurückbuchen).
 * Vergleich-und-Tausch: geschrieben wird nur, wenn der Wert seit dem Lesen unverändert ist,
 * damit sich zwei gleichzeitige Buchungen (zwei Tabs/Nutzer) nicht gegenseitig überschreiben.
 */
const addToPropertyInvestment = async (propertyId, delta) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        const { data: prop, error } = await supabase.from('properties').select('total_investment_cost').eq('id', propertyId).single();
        if (error) throw error;
        const oldVal = prop?.total_investment_cost ?? null;
        const newVal = round2(Number(oldVal || 0) + delta);
        const { data: upd, error: updErr } = await eqOrNull(
            supabase.from('properties').update({ total_investment_cost: newVal }).eq('id', propertyId),
            'total_investment_cost', oldVal
        ).select('id');
        if (updErr) throw updErr;
        if (upd && upd.length > 0) return newVal;
        // Keine Zeile geändert: gleichzeitig geändert (erneut versuchen) oder keine Schreibberechtigung
        const { data: again, error: againErr } = await supabase.from('properties').select('total_investment_cost').eq('id', propertyId).single();
        if (againErr) throw againErr;
        if ((again?.total_investment_cost ?? null) === oldVal) {
            throw new Error('Die Gesamtinvestitionskosten der Immobilie konnten nicht geändert werden (keine Schreibberechtigung für die Immobilie).');
        }
    }
    throw new Error('Die Gesamtinvestitionskosten der Immobilie wurden gleichzeitig geändert. Bitte erneut versuchen.');
};

const RenovationProjectDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const perm = usePermission();
    const { isMobile } = useViewMode();

    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [refreshError, setRefreshError] = useState(null);
    const [expandedTrade, setExpandedTrade] = useState(null);
    const [contacts, setContacts] = useState([]);
    const [activeView, setActiveView] = useState('cockpit');
    const [gikModal, setGikModal] = useState(false);
    const [gikInfo, setGikInfo] = useState({ loading: false, propertyCost: null, ist: null });
    const [gikBusy, setGikBusy] = useState(false);
    const [statusBusy, setStatusBusy] = useState(false);

    // Invoice modal
    const [invoiceModal, setInvoiceModal] = useState(null); // { subtradeId }
    const [invoiceForm, setInvoiceForm] = useState({ amount: '', date: '', note: '' });
    const [invoiceSaving, setInvoiceSaving] = useState(false);

    // Budget edit
    const [editBudget, setEditBudget] = useState(null); // { subtradeId, value }
    const budgetSavingRef = useRef(false);

    // Untergewerk nachtragen (je Gewerk)
    const [newSubtradeNames, setNewSubtradeNames] = useState({});

    const hasProjectRef = useRef(false);

    // Lädt das Projekt. Der Lade-Spinner erscheint nur beim ersten Laden; Aktualisierungen
    // nach Änderungen laufen im Hintergrund (kein Flackern, Scrollposition bleibt erhalten).
    const fetchProject = async () => {
        const { data, error } = await supabase
            .from('renovation_projects')
            .select(`
                *,
                property:properties(street, house_number, city, zip, user_id, portfolio_id, portfolio:portfolios(user_id)),
                unit:units(unit_name),
                trades:renovation_project_trades(
                    *, milestones:renovation_milestones(*),
                    subtrades:renovation_project_subtrades(
                        *, invoices:renovation_invoices(*),
                        contact:contacts(name)
                    )
                )
            `)
            .eq('id', id).single();
        if (error || !data) {
            console.error(error);
            const msg = translateError(error || 'Projekt nicht gefunden.');
            if (hasProjectRef.current) setRefreshError(msg);
            else setLoadError(msg);
            setLoading(false);
            return;
        }
        // Sort
        data.trades = (data.trades || []).sort((a, b) => a.sort_order - b.sort_order);
        data.trades.forEach(t => {
            t.subtrades = (t.subtrades || []).sort((a, b) => a.sort_order - b.sort_order);
            t.milestones = (t.milestones || []).sort((a, b) => a.sort_order - b.sort_order);
            t.subtrades.forEach(st => {
                st.invoices = (st.invoices || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
            });
        });
        hasProjectRef.current = true;
        setProject(data);
        setLoadError(null);
        setRefreshError(null);
        setLoading(false);
    };

    useEffect(() => { if (user && id) fetchProject(); }, [user, id]);

    // Kontakte (Verantwortliche): eigene + die des Objekt-Eigentümers (bei geteilten Portfolios);
    // was davon sichtbar ist, entscheidet die RLS.
    const ownerId = project?.property?.portfolio?.user_id || project?.property?.user_id || null;
    // user_id neuer Zeilen (Untergewerke, Rechnungen): der Portfolio-Eigentümer bzw. der Eigentümer
    // des Projekts – nicht das Konto eines Teammitglieds (ON DELETE CASCADE). Beide lässt die
    // Datenbank zu (rls_user_ok 'renovation_project'); den Ersteller einer Rechnung hält sie in
    // renovation_invoices.created_by fest.
    const dataOwnerId = project?.property?.portfolio?.user_id || project?.user_id || user?.id;
    useEffect(() => {
        if (!user) return;
        const ids = [...new Set([user.id, ownerId].filter(Boolean))];
        supabase.from('contacts').select('id, name').in('user_id', ids).order('name').then(({ data, error }) => {
            if (error) { console.error('Error loading contacts:', error); return; }
            setContacts(data || []);
        });
    }, [user, ownerId]);

    // Neue DB-Spalte renovation_projects.gik_transferred_amount (bereits in die GIK übernommener
    // Betrag) wird nur genutzt, wenn sie vorhanden ist – sonst bisheriges Verhalten mit Warnhinweis.
    const hasGikTracking = !!project && Object.prototype.hasOwnProperty.call(project, 'gik_transferred_amount');

    // Schreibrecht wie die RLS: Projekt selbst (Status, Ziel-Datum, Abschluss) braucht Schreibrecht
    // „Immobilien“ oder „Investorportal“ am Objekt; Gewerke, Meilensteine, Untergewerke und Rechnungen
    // zusätzlich für das Konto, dem das Projekt gehört (has_renovation_project_access).
    // Solange die Freigaben laden, nicht sperren – die Datenbank prüft ohnehin.
    const projectPortfolioId = project?.property?.portfolio_id || null;
    const canEditProject = !perm || perm.loadingPermissions || (!!projectPortfolioId
        && (perm.canWrite('immobilien', projectPortfolioId) || perm.canWrite('investorportal', projectPortfolioId)));
    const canEdit = canEditProject || (!!project && project.user_id === user?.id);
    const gikTransferred = hasGikTracking ? round2(project.gik_transferred_amount) : 0;

    /* ─── Computed Stats ─────── */
    const stats = useMemo(() => {
        if (!project) return {};
        let budgetSoll = 0, istBezahlt = 0, totalMs = 0, doneMs = 0, totalTrades = project.trades?.length || 0, doneTrades = 0;
        (project.trades || []).forEach(t => {
            if (t.status === 'completed') doneTrades++;
            (t.subtrades || []).forEach(st => {
                budgetSoll += Number(st.budget_soll || 0);
                (st.invoices || []).forEach(inv => { istBezahlt += Number(inv.amount || 0); });
            });
            (t.milestones || []).forEach(m => { totalMs++; if (m.is_completed) doneMs++; });
        });
        budgetSoll = round2(budgetSoll);
        istBezahlt = round2(istBezahlt);
        const progress = totalMs > 0 ? Math.round((doneMs / totalMs) * 100) : 0;
        const overBudget = istBezahlt > budgetSoll && budgetSoll > 0;
        const remaining = round2(budgetSoll - istBezahlt);
        return { budgetSoll, istBezahlt, progress, overBudget, remaining, totalTrades, doneTrades, totalMs, doneMs };
    }, [project]);

    /* ─── Gemeinsame Ausführung von Änderungen: Fehler anzeigen, danach im Hintergrund neu laden ─── */
    const runAction = async (fn, errorPrefix) => {
        try {
            await fn();
            return true;
        } catch (err) {
            alert(`${errorPrefix}: ${translateError(err)}`);
            return false;
        } finally {
            fetchProject();
        }
    };

    /* ─── Milestone Toggle ─────── */
    const toggleMilestone = (milestone) => runAction(async () => {
        const is_completed = !milestone.is_completed;
        assertWrite(await supabase.from('renovation_milestones').update({
            is_completed, completed_at: is_completed ? new Date().toISOString() : null,
        }).eq('id', milestone.id).select('id'), 'Meilenstein speichern');

        // If completion trigger → set trade status to completed
        if (is_completed && milestone.is_completion_trigger) {
            assertWrite(await supabase.from('renovation_project_trades').update({ status: 'completed' }).eq('id', milestone.project_trade_id).select('id'), 'Gewerk-Status speichern');
        }

        // Abschluss-Meilenstein zurückgenommen: Gewerk wieder „In Arbeit“, sofern kein anderer
        // abgehakter Abschluss-Meilenstein im Gewerk bleibt. Nur wenn das Gewerk noch „Fertig“ ist
        // (ein inzwischen von Hand gesetzter Status bleibt unverändert).
        if (!is_completed && milestone.is_completion_trigger) {
            const trade = (project?.trades || []).find(t => t.id === milestone.project_trade_id);
            const otherTriggerDone = (trade?.milestones || []).some(m => m.id !== milestone.id && m.is_completion_trigger && m.is_completed);
            if (trade?.status === 'completed' && !otherTriggerDone) {
                const { error: tradeErr } = await supabase.from('renovation_project_trades')
                    .update({ status: 'in_progress' }).eq('id', milestone.project_trade_id).eq('status', 'completed');
                if (tradeErr) throw tradeErr;
            }
        }
    }, 'Fehler beim Speichern des Meilensteins');

    /* ─── Trade status ─────── */
    const updateTradeStatus = (tradeId, status) => runAction(async () => {
        assertWrite(await supabase.from('renovation_project_trades').update({ status }).eq('id', tradeId).select('id'), 'Gewerk-Status speichern');
    }, 'Fehler beim Speichern des Gewerk-Status');

    /* ─── GIK-Dialog öffnen: aktuelle Werte frisch laden ─────── */
    const openGikModal = async () => {
        setGikModal(true);
        setGikInfo({ loading: true, propertyCost: null, ist: null });
        const [propRes, invRes] = await Promise.all([
            supabase.from('properties').select('total_investment_cost').eq('id', project.property_id).single(),
            supabase.from('renovation_invoices').select('amount').eq('project_id', id),
        ]);
        setGikInfo({
            loading: false,
            propertyCost: propRes.error ? null : round2(propRes.data?.total_investment_cost),
            ist: invRes.error ? stats.istBezahlt : round2((invRes.data || []).reduce((s, inv) => s + Number(inv.amount || 0), 0)),
        });
    };

    /* ─── Project status ─────── */
    const updateProjectStatus = async (status) => {
        if (status === 'completed') {
            openGikModal();
            return;
        }
        if (statusBusy) return;
        setStatusBusy(true);
        await runAction(async () => {
            assertWrite(await supabase.from('renovation_projects').update({ status }).eq('id', id).select('id'), 'Projektstatus speichern');
        }, 'Fehler beim Speichern des Projektstatus');
        setStatusBusy(false);
    };

    /* ─── GIK: Projekt abschliessen & Kosten uebernehmen ─────── */
    const completeProjectWithGIK = async (writeToProperty) => {
        if (gikBusy || !project) return;
        setGikBusy(true);
        const prevStatus = project.status;
        try {
            if (!writeToProperty) {
                assertWrite(await supabase.from('renovation_projects').update({ status: 'completed' }).eq('id', id).select('id'), 'Projekt abschließen');
            } else {
                // Ist-Summe frisch aus der Datenbank (nicht aus dem evtl. veralteten Seitenstand)
                const { data: invs, error: invErr } = await supabase.from('renovation_invoices').select('amount').eq('project_id', id);
                if (invErr) throw invErr;
                const ist = round2((invs || []).reduce((s, inv) => s + Number(inv.amount || 0), 0));

                if (hasGikTracking) {
                    const { data: fresh, error: freshErr } = await supabase.from('renovation_projects').select('gik_transferred_amount').eq('id', id).single();
                    if (freshErr) throw freshErr;
                    const oldTransferred = fresh?.gik_transferred_amount ?? null;
                    const delta = round2(ist - round2(oldTransferred));
                    // 1. Übernahme am Projekt vermerken – nur wenn seit dem Lesen unverändert, damit ein
                    //    zweiter Tab/Nutzer denselben Betrag nicht noch einmal bucht.
                    const { data: claimed, error: claimErr } = await eqOrNull(
                        supabase.from('renovation_projects').update({ status: 'completed', gik_transferred_amount: ist }).eq('id', id),
                        'gik_transferred_amount', oldTransferred
                    ).select('id');
                    if (claimErr) throw claimErr;
                    if (!claimed?.length) throw new Error('Das Projekt wurde zwischenzeitlich geändert oder Sie haben keine Schreibberechtigung. Bitte Seite neu laden und erneut versuchen.');
                    // 2. Nur die Differenz zur bisherigen Übernahme auf die Immobilie buchen
                    if (delta !== 0) {
                        try {
                            await addToPropertyInvestment(project.property_id, delta);
                        } catch (bookErr) {
                            // Vermerk zurücknehmen, damit Projekt und Immobilie zusammenpassen
                            // (alten Wert unverändert zurückschreiben – auch NULL = "unbekannt")
                            const { error: revertErr } = await supabase.from('renovation_projects')
                                .update({ status: prevStatus, gik_transferred_amount: oldTransferred })
                                .eq('id', id);
                            if (revertErr) {
                                console.error('GIK claim revert failed:', revertErr);
                                throw new Error(`Die Buchung auf die Immobilie ist fehlgeschlagen (${translateError(bookErr)}), und der Übernahme-Vermerk am Projekt konnte nicht zurückgenommen werden. Bitte Projektstatus und Gesamtinvestitionskosten der Immobilie prüfen.`);
                            }
                            throw bookErr;
                        }
                    }
                } else {
                    // Bisheriger Datenbank-Stand ohne Übernahme-Vermerk: komplette Ist-Summe buchen
                    // (der Dialog weist auf die mögliche Doppelbuchung hin).
                    if (ist !== 0) await addToPropertyInvestment(project.property_id, ist);
                    const res = await supabase.from('renovation_projects').update({ status: 'completed' }).eq('id', id).select('id');
                    if (res.error || !res.data?.length) {
                        if (ist !== 0) {
                            try {
                                await addToPropertyInvestment(project.property_id, -ist);
                            } catch (revertErr) {
                                console.error('GIK revert failed:', revertErr);
                                throw new Error(`Der Projektstatus konnte nicht gespeichert werden, und die bereits gebuchten ${fmtEUR(ist)} konnten nicht von der Immobilie zurückgebucht werden. Bitte die Gesamtinvestitionskosten der Immobilie prüfen.`);
                            }
                        }
                        assertWrite(res, 'Projekt abschließen');
                    }
                }
            }
            setGikModal(false);
        } catch (err) {
            alert('Fehler beim Abschließen: ' + translateError(err));
        } finally {
            setGikBusy(false);
            fetchProject();
        }
    };

    /* ─── Trade date update (Übernahme beim Verlassen des Feldes) ─────── */
    const commitTradeDate = (trade, field, value, inputEl) => {
        const oldValue = trade[field] || '';
        const newValue = value || '';
        if (newValue === oldValue) return;
        if (newValue && !parseLocalDate(newValue)) {
            alert('Bitte ein gültiges Datum eingeben.');
            if (inputEl) inputEl.value = oldValue;
            return;
        }
        const next = { start_date: trade.start_date || '', end_date: trade.end_date || '', [field]: newValue };
        if (next.start_date && next.end_date && next.end_date < next.start_date) {
            alert('Das Enddatum darf nicht vor dem Startdatum liegen.');
            if (inputEl) inputEl.value = oldValue;
            return;
        }
        runAction(async () => {
            assertWrite(await supabase.from('renovation_project_trades').update({ [field]: newValue || null }).eq('id', trade.id).select('id'), 'Zeitraum speichern');
        }, 'Fehler beim Speichern des Zeitraums').then(ok => {
            // Bei Fehler wieder den gespeicherten Wert anzeigen
            if (!ok && inputEl) inputEl.value = oldValue;
        });
    };

    /* ─── Ziel-Datum (Soll) ─────── */
    const commitTargetDate = (value, inputEl) => {
        const oldValue = project.target_end_date || '';
        const newValue = value || '';
        if (newValue === oldValue) return;
        if (newValue && !parseLocalDate(newValue)) {
            alert('Bitte ein gültiges Datum eingeben.');
            if (inputEl) inputEl.value = oldValue;
            return;
        }
        runAction(async () => {
            assertWrite(await supabase.from('renovation_projects').update({ target_end_date: newValue || null }).eq('id', project.id).select('id'), 'Ziel-Datum speichern');
        }, 'Fehler beim Speichern des Ziel-Datums').then(ok => {
            if (!ok && inputEl) inputEl.value = oldValue;
        });
    };

    /* ─── Budget inline ─────── */
    const saveBudget = async (subtradeId, value) => {
        if (budgetSavingRef.current) return; // Enter + Blur nicht doppelt speichern
        budgetSavingRef.current = true;
        const raw = String(value ?? '').trim().replace(',', '.');
        const amount = raw === '' ? 0 : round2(parseFloat(raw));
        setEditBudget(null);
        if (!Number.isFinite(amount) || amount < 0) {
            alert('Bitte ein gültiges Budget (0 oder größer) eingeben.');
            budgetSavingRef.current = false;
            return;
        }
        await runAction(async () => {
            assertWrite(await supabase.from('renovation_project_subtrades').update({ budget_soll: amount }).eq('id', subtradeId).select('id'), 'Budget speichern');
        }, 'Fehler beim Speichern des Budgets');
        budgetSavingRef.current = false;
    };

    /* ─── Untergewerk nachtragen ─────── */
    const addSubtrade = (trade) => {
        const name = (newSubtradeNames[trade.id] || '').trim();
        if (!name) return;
        const nextSort = (trade.subtrades || []).reduce((max, s) => Math.max(max, Number(s.sort_order) || 0), -1) + 1;
        runAction(async () => {
            assertWrite(await supabase.from('renovation_project_subtrades').insert({
                project_trade_id: trade.id, project_id: id, user_id: dataOwnerId,
                name, sort_order: nextSort, budget_soll: 0,
            }).select('id'), 'Untergewerk anlegen');
            setNewSubtradeNames(prev => ({ ...prev, [trade.id]: '' }));
        }, 'Fehler beim Anlegen des Untergewerks');
    };

    /* ─── Invoice CRUD ─────── */
    const addInvoice = async () => {
        if (!invoiceModal || invoiceSaving) return;
        const raw = String(invoiceForm.amount ?? '').trim().replace(',', '.');
        const amount = round2(parseFloat(raw));
        if (!raw || !Number.isFinite(amount) || amount <= 0) {
            alert('Bitte einen gültigen Rechnungsbetrag größer 0 eingeben.');
            return;
        }
        if (amount >= INVOICE_CONFIRM_LIMIT && !window.confirm(`Der Betrag ${fmtEUR(amount)} ist ungewöhnlich hoch. Trotzdem speichern?`)) return;
        // Abgeschlossenes/archiviertes Projekt: neue Kosten fehlen in den GIK, bis erneut abgeschlossen wird
        if ((project?.status === 'completed' || project?.status === 'archived')
            && !window.confirm(`${invoiceGikHint}\n\nRechnung trotzdem speichern?`)) return;
        const date = invoiceForm.date || localDateStr();
        if (!parseLocalDate(date)) {
            alert('Bitte ein gültiges Rechnungsdatum eingeben.');
            return;
        }
        setInvoiceSaving(true);
        const ok = await runAction(async () => {
            assertWrite(await supabase.from('renovation_invoices').insert({
                project_subtrade_id: invoiceModal.subtradeId,
                project_id: id,
                user_id: dataOwnerId,
                amount,
                date,
                note: invoiceForm.note?.trim() || null,
            }).select('id'), 'Rechnung speichern');
        }, 'Fehler beim Speichern der Rechnung');
        setInvoiceSaving(false);
        if (ok) {
            setInvoiceModal(null);
            setInvoiceForm({ amount: '', date: '', note: '' });
        }
    };

    // Hinweis für Rechnungen in abgeschlossenen/archivierten Projekten (Erfassen-Dialog und Rückfrage)
    const invoiceGikHint = hasGikTracking
        ? 'Hinweis: Das Projekt ist bereits abgeschlossen bzw. archiviert. Die Rechnung wird erst beim erneuten Abschließen des Projekts („Reaktivieren“, dann „Abschließen“) in die Gesamtinvestitionskosten (GIK) der Immobilie übernommen.'
        : 'Hinweis: Das Projekt ist bereits abgeschlossen bzw. archiviert. Eine bereits erfolgte Übernahme in die Gesamtinvestitionskosten (GIK) der Immobilie wird um diese Rechnung nicht automatisch ergänzt.';

    const deleteInvoice = (inv) => {
        let msg = `Rechnung über ${fmtEUR(inv.amount)} vom ${formatDateDE(inv.date)}${inv.note ? ` („${inv.note}")` : ''} wirklich löschen?\nDies kann nicht rückgängig gemacht werden.`;
        if (project.status === 'completed' || project.status === 'archived') {
            msg += hasGikTracking
                ? '\n\nHinweis: Eine bereits in die Gesamtinvestitionskosten (GIK) übernommene Summe wird erst beim erneuten Abschließen des Projekts korrigiert.'
                : '\n\nHinweis: Eine bereits erfolgte Übernahme in die Gesamtinvestitionskosten (GIK) der Immobilie wird nicht automatisch korrigiert.';
        }
        if (!window.confirm(msg)) return;
        runAction(async () => {
            assertWrite(await supabase.from('renovation_invoices').delete().eq('id', inv.id).select('id'), 'Rechnung löschen');
        }, 'Fehler beim Löschen der Rechnung');
    };

    /* ─── Responsible contact ─────── */
    const updateResponsible = (subtradeId, contactId) => runAction(async () => {
        assertWrite(await supabase.from('renovation_project_subtrades').update({ responsible_contact_id: contactId || null }).eq('id', subtradeId).select('id'), 'Verantwortlichen speichern');
    }, 'Fehler beim Speichern des Verantwortlichen');

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;
    if (!project) {
        return (
            <div style={{ maxWidth: '560px', margin: '40px auto', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#b91c1c' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '8px' }}>
                    <AlertTriangle size={18} /> Projekt konnte nicht geladen werden
                </div>
                <p style={{ fontSize: '0.88rem', marginBottom: '16px' }}>{loadError || 'Unbekannter Fehler.'}</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button size="sm" onClick={() => { setLoading(true); fetchProject(); }}>Erneut laden</Button>
                    <Button size="sm" variant="secondary" onClick={() => navigate('/renovation')}>Zur Übersicht</Button>
                </div>
            </div>
        );
    }

    const st = STATUS_MAP[project.status] || STATUS_MAP.planned;
    const isClosed = project.status === 'completed' || project.status === 'archived';

    // Werte für den GIK-Dialog
    const gikIst = gikInfo.ist ?? stats.istBezahlt;
    const gikDelta = hasGikTracking ? round2(gikIst - gikTransferred) : gikIst;

    return (
        <div>
            {/* Back */}
            <button onClick={() => navigate('/renovation')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                <ChevronLeft size={16} /> Übersicht
            </button>

            {refreshError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', marginBottom: '12px', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c', fontSize: '0.82rem', flexWrap: 'wrap' }}>
                    <AlertTriangle size={15} />
                    <span style={{ flex: 1 }}>Aktualisieren fehlgeschlagen – angezeigt wird der zuletzt geladene Stand: {refreshError}</span>
                    <Button size="sm" variant="secondary" onClick={fetchProject}>Erneut laden</Button>
                </div>
            )}

            {!canEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', marginBottom: '12px', borderRadius: 'var(--radius-md)', background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.3)', color: '#0284c7', fontSize: '0.82rem', flexWrap: 'wrap' }}>
                    <AlertTriangle size={15} />
                    <span style={{ flex: 1 }}>Nur Leserecht: Für dieses Projekt haben Sie kein Schreibrecht („Immobilien“ bzw. „Investorportal“). Status, Budget, Meilensteine, Zeiträume und Rechnungen sind nicht änderbar.</span>
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {project.name}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 12px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                    </h1>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={14} /> {project.property?.street} {project.property?.house_number}, {project.property?.city}</span>
                        {project.unit?.unit_name && <span>• {project.unit.unit_name}</span>}
                        {project.target_end_date && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> Ziel: {formatDateDE(project.target_end_date)}</span>}
                    </div>
                </div>
                {/* Status-Aktionen abhängig vom aktuellen Status */}
                {canEditProject && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {!isClosed && <Button size="sm" onClick={() => updateProjectStatus('completed')} disabled={statusBusy} style={{ background: '#16a34a' }}>Abschließen</Button>}
                        {isClosed && <Button variant="secondary" size="sm" onClick={() => updateProjectStatus('active')} disabled={statusBusy}>Reaktivieren</Button>}
                        {project.status !== 'archived' && <Button variant="secondary" size="sm" onClick={() => updateProjectStatus('archived')} disabled={statusBusy}>Archivieren</Button>}
                    </div>
                )}
            </div>

            {/* View Tabs: Cockpit / Gantt */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                {[{ key: 'cockpit', label: 'Cockpit' }, { key: 'gantt', label: 'Bauzeitenplan' }].map(v => (
                    <button key={v.key} onClick={() => setActiveView(v.key)}
                        style={{
                            padding: isMobile ? '8px 12px' : '10px 20px', fontSize: '0.85rem', fontWeight: 600,
                            border: 'none', background: 'none', cursor: 'pointer',
                            color: activeView === v.key ? '#0ea5e9' : 'var(--text-secondary)',
                            borderBottom: activeView === v.key ? '2px solid #0ea5e9' : '2px solid transparent',
                            marginBottom: '-1px', transition: 'all 0.2s',
                        }}>
                        {v.label}
                    </button>
                ))}
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                {[
                    { label: 'Budget (Soll)', value: fmtEUR(stats.budgetSoll), icon: DollarSign, color: '#0ea5e9' },
                    { label: 'Ist bezahlt', value: fmtEUR(stats.istBezahlt), icon: TrendingUp, color: stats.overBudget ? '#dc2626' : '#16a34a' },
                    { label: 'Verbleibend', value: fmtEUR(stats.remaining), icon: BarChart3, color: stats.remaining < 0 ? '#dc2626' : '#64748b' },
                    { label: 'Fortschritt', value: `${stats.progress}%`, icon: CheckCircle2, color: stats.progress === 100 ? '#16a34a' : '#f59e0b' },
                ].map((kpi, i) => (
                    <div key={i} style={{ background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '6px' }}>
                            {React.createElement(kpi.icon, { size: 14, color: kpi.color })} {kpi.label}
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            {/* Progress Bar */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    <span>{stats.doneMs}/{stats.totalMs} Meilensteine</span>
                    <span>{stats.doneTrades}/{stats.totalTrades} Gewerke abgeschlossen</span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border-color)' }}>
                    <div style={{ height: '100%', borderRadius: '3px', width: `${stats.progress}%`, background: stats.progress === 100 ? '#16a34a' : 'linear-gradient(90deg, #0ea5e9, #06b6d4)', transition: 'width 0.4s' }} />
                </div>
            </div>

            {/* ═══ BAUZEITENPLAN VIEW ═══ */}
            {activeView === 'gantt' && (
                <div style={{ marginBottom: '28px' }}>
                    {/* Ziel-Datum Soll / Ist */}
                    {(() => {
                        const zielSoll = project.target_end_date || null;
                        const tradeEndDates = (project.trades || []).map(t => t.end_date).filter(Boolean);
                        const zielIst = tradeEndDates.length > 0 ? [...tradeEndDates].sort().pop() : null;
                        const isOverdue = zielSoll && zielIst && zielIst > zielSoll;
                        return (
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(2, 200px)', gap: '12px', marginBottom: '20px' }}>
                                <div style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '4px' }}>Ziel-Datum (Soll)</div>
                                    <input
                                        key={`target-${zielSoll || ''}`}
                                        type="date"
                                        defaultValue={zielSoll || ''}
                                        disabled={!canEditProject}
                                        onBlur={e => commitTargetDate(e.target.value, e.target)}
                                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0ea5e9', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', outline: 'none', width: '100%' }}
                                    />
                                </div>
                                <div style={{ background: 'var(--surface-color)', border: `1px solid ${isOverdue ? '#dc2626' : 'var(--border-color)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '4px' }}>Ziel-Datum (Ist)</div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isOverdue ? '#dc2626' : '#16a34a' }}>{formatDateDE(zielIst)}</div>
                                </div>
                            </div>
                        );
                    })()}
                    <GanttChart
                        trades={project.trades || []}
                        onTradeClick={(tradeId) => { setActiveView('cockpit'); setExpandedTrade(tradeId); }}
                        isMobile={isMobile}
                    />
                    <div style={{ marginTop: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>{canEdit ? 'Zeiträume bearbeiten' : 'Zeiträume'}</h3>
                        {canEdit && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>Änderungen werden beim Verlassen des Datumsfelds gespeichert.</p>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {(project.trades || []).map(t => {
                                const invalid = t.start_date && t.end_date && t.end_date < t.start_date;
                                return (
                                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', border: `1px solid ${invalid ? '#dc2626' : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.85rem', minWidth: '140px' }}>{t.name}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Start:</label>
                                            <input type="date" key={`${t.id}-start-${t.start_date || ''}`} defaultValue={t.start_date || ''}
                                                disabled={!canEdit}
                                                onBlur={e => commitTradeDate(t, 'start_date', e.target.value, e.target)}
                                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }} />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ende:</label>
                                            <input type="date" key={`${t.id}-end-${t.end_date || ''}`} defaultValue={t.end_date || ''} min={t.start_date || undefined}
                                                disabled={!canEdit}
                                                onBlur={e => commitTradeDate(t, 'end_date', e.target.value, e.target)}
                                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }} />
                                        </div>
                                        {invalid && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>
                                                <AlertTriangle size={13} /> Ende liegt vor Start
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ COCKPIT VIEW ═══ */}
            {activeView === 'cockpit' && (<>
                {/* Gewerke Accordion */}
                <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '12px' }}>Gewerke</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(project.trades || []).map(trade => {
                        const isExpanded = expandedTrade === trade.id;
                        const tst = TRADE_STATUS[trade.status] || TRADE_STATUS.open;
                        let tradeSoll = 0, tradeIst = 0;
                        (trade.subtrades || []).forEach(st => {
                            tradeSoll += Number(st.budget_soll || 0);
                            (st.invoices || []).forEach(inv => { tradeIst += Number(inv.amount || 0); });
                        });
                        return (
                            <div key={trade.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                                {/* Trade Header */}
                                <div
                                    onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', cursor: 'pointer', background: 'var(--background-color)' }}
                                >
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <span style={{ fontWeight: 700, flex: 1 }}>{trade.name}</span>
                                    <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, background: tst.bg, color: tst.color }}>{tst.label}</span>
                                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{fmtEUR(tradeIst)} / {fmtEUR(tradeSoll)}</span>
                                </div>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                                        {/* Milestones */}
                                        <div style={{ marginBottom: '16px' }}>
                                            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Milestone size={14} /> Meilensteine
                                            </h4>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                {(trade.milestones || []).length === 0 && (
                                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Keine Meilensteine angelegt.</span>
                                                )}
                                                {(trade.milestones || []).map(m => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => toggleMilestone(m)}
                                                        disabled={!canEdit}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '5px',
                                                            padding: '6px 12px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600, cursor: canEdit ? 'pointer' : 'default',
                                                            background: m.is_completed ? '#dcfce7' : 'var(--surface-color)',
                                                            color: m.is_completed ? '#16a34a' : 'var(--text-secondary)',
                                                            border: m.is_completed ? '1px solid #16a34a' : '1px solid var(--border-color)',
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        {m.is_completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                                                        {m.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Trade Status Buttons */}
                                        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                                            {Object.entries(TRADE_STATUS).map(([k, v]) => (
                                                <button key={k} onClick={() => updateTradeStatus(trade.id, k)}
                                                    disabled={!canEdit}
                                                    style={{
                                                        padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: canEdit ? 'pointer' : 'default',
                                                        background: trade.status === k ? v.bg : 'transparent',
                                                        color: trade.status === k ? v.color : 'var(--text-secondary)',
                                                        border: trade.status === k ? `1px solid ${v.color}` : '1px solid var(--border-color)',
                                                    }}>
                                                    {v.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Subtrades Table */}
                                        <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>Untergewerke & Budget</h4>
                                        {(trade.subtrades || []).length === 0 && (
                                            <p style={{ fontSize: '0.78rem', color: '#b45309', marginBottom: '8px' }}>
                                                {canEdit ? 'Noch keine Untergewerke – lege unten eines an, um Budget und Rechnungen zu erfassen.' : 'Noch keine Untergewerke.'}
                                            </p>
                                        )}
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Untergewerk</th>
                                                        <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Budget Soll</th>
                                                        <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Ist bezahlt</th>
                                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Verantwortlich</th>
                                                        <th style={{ textAlign: 'center', padding: '6px 8px' }}></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(trade.subtrades || []).map(st => {
                                                        const stIst = (st.invoices || []).reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
                                                        const over = stIst > Number(st.budget_soll || 0) && st.budget_soll > 0;
                                                        return (
                                                            <React.Fragment key={st.id}>
                                                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td style={{ padding: '8px', fontWeight: 600 }}>{st.name}</td>
                                                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                        {editBudget?.subtradeId === st.id ? (
                                                                            <input type="number" min="0" step="0.01" defaultValue={st.budget_soll}
                                                                                onBlur={e => saveBudget(st.id, e.target.value)}
                                                                                onKeyDown={e => e.key === 'Enter' && saveBudget(st.id, e.target.value)}
                                                                                autoFocus style={{ width: '100px', textAlign: 'right', padding: '4px', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                                                                        ) : (
                                                                            <span onClick={() => { if (canEdit) setEditBudget({ subtradeId: st.id }); }} style={{ cursor: canEdit ? 'pointer' : 'default' }} title={canEdit ? 'Klicken zum Bearbeiten' : undefined}>
                                                                                {fmtEUR(st.budget_soll)}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: over ? '#dc2626' : 'var(--text-primary)' }}>
                                                                        {fmtEUR(stIst)}
                                                                    </td>
                                                                    <td style={{ padding: '8px' }}>
                                                                        <select value={st.responsible_contact_id || ''} onChange={e => updateResponsible(st.id, e.target.value)} disabled={!canEdit}
                                                                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', background: 'var(--surface-color)', maxWidth: '130px' }}>
                                                                            <option value="">—</option>
                                                                            {/* Zugewiesener Kontakt bleibt sichtbar, auch wenn er nicht in der Liste ist */}
                                                                            {st.responsible_contact_id && !contacts.some(c => c.id === st.responsible_contact_id) && (
                                                                                <option value={st.responsible_contact_id}>{st.contact?.name || 'Zugewiesener Kontakt'}</option>
                                                                            )}
                                                                            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                        </select>
                                                                    </td>
                                                                    <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                        {canEdit && (
                                                                            <button onClick={() => { setInvoiceModal({ subtradeId: st.id }); setInvoiceForm({ amount: '', date: localDateStr(), note: '' }); }}
                                                                                style={{ background: 'none', border: '1px solid #0ea5e9', borderRadius: '4px', color: '#0ea5e9', fontSize: '0.72rem', padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                                                <Plus size={12} /> RE
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                                {/* Invoice sub-rows */}
                                                                {(st.invoices || []).map(inv => (
                                                                    <tr key={inv.id} style={{ background: 'var(--background-color)', fontSize: '0.78rem' }}>
                                                                        <td style={{ padding: '4px 8px 4px 28px', color: 'var(--text-secondary)' }}>
                                                                            RE {formatDateDE(inv.date)} {inv.note && `– ${inv.note}`}
                                                                        </td>
                                                                        <td></td>
                                                                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtEUR(inv.amount)}</td>
                                                                        <td></td>
                                                                        <td style={{ textAlign: 'center', padding: '4px' }}>
                                                                            {canEdit && (
                                                                                <button onClick={() => deleteInvoice(inv)} title="Rechnung löschen"
                                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}>
                                                                                    <Trash2 size={12} />
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Untergewerk nachtragen */}
                                        {canEdit && <div style={{ display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <input
                                                value={newSubtradeNames[trade.id] || ''}
                                                onChange={e => setNewSubtradeNames(prev => ({ ...prev, [trade.id]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') addSubtrade(trade); }}
                                                placeholder="Neues Untergewerk"
                                                style={{ flex: '1', minWidth: '160px', maxWidth: '280px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', background: 'var(--surface-color)' }}
                                            />
                                            <button
                                                onClick={() => addSubtrade(trade)}
                                                disabled={!(newSubtradeNames[trade.id] || '').trim()}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.78rem', color: '#0ea5e9', background: 'none', border: '1px dashed #0ea5e9', borderRadius: '6px', cursor: 'pointer' }}
                                            >
                                                <Plus size={12} /> Untergewerk
                                            </button>
                                        </div>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </>)}

            {/* Invoice Modal */}
            <Modal isOpen={!!invoiceModal} onClose={() => { if (!invoiceSaving) setInvoiceModal(null); }} title="Rechnung erfassen"
                footer={<><Button variant="secondary" onClick={() => setInvoiceModal(null)} disabled={invoiceSaving}>Abbrechen</Button><Button onClick={addInvoice} disabled={invoiceSaving}>{invoiceSaving ? <Loader2 size={16} className="animate-spin" /> : 'Speichern'}</Button></>}>
                {isClosed && (
                    <p style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '0.8rem', color: '#b45309', marginBottom: '12px', lineHeight: 1.5 }}>
                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                        {invoiceGikHint}
                    </p>
                )}
                <Input label="Betrag (€)" type="number" min="0.01" step="0.01" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} placeholder="0,00" />
                <Input label="Datum" type="date" value={invoiceForm.date} onChange={e => setInvoiceForm({ ...invoiceForm, date: e.target.value })} />
                <Input label="Notiz (optional)" value={invoiceForm.note} onChange={e => setInvoiceForm({ ...invoiceForm, note: e.target.value })} placeholder="z.B. Abschlagszahlung 1" />
            </Modal>

            {/* GIK Completion Modal */}
            <Modal isOpen={gikModal} onClose={() => { if (!gikBusy) setGikModal(false); }} title="Projekt abschließen"
                footer={
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={() => setGikModal(false)} disabled={gikBusy}>Abbrechen</Button>
                        <Button variant="secondary" onClick={() => completeProjectWithGIK(false)} disabled={gikBusy}>Ohne Übernahme</Button>
                        <Button onClick={() => completeProjectWithGIK(true)} disabled={gikBusy || gikInfo.loading} style={{ background: '#16a34a' }}>
                            {gikBusy ? <Loader2 size={16} className="animate-spin" /> : 'Kosten übernehmen'}
                        </Button>
                    </div>
                }>
                <div style={{ padding: '8px 0', fontSize: '0.92rem', lineHeight: 1.8 }}>
                    <p>Das Projekt <strong>{project?.name}</strong> wird als abgeschlossen markiert.</p>
                    <div style={{ background: 'var(--background-color)', borderRadius: 'var(--radius-md)', padding: '14px', margin: '14px 0', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>GIK-Übernahme (Gesamtinvestitionskosten)</div>
                        {gikInfo.loading ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}><Loader2 size={14} className="animate-spin" /> Aktuelle Werte werden geladen…</div>
                        ) : (
                            <>
                                <p style={{ fontSize: '0.88rem' }}>
                                    Sollen die Sanierungskosten {hasGikTracking && gikTransferred !== 0 ? 'seit der letzten Übernahme ' : ''}von <strong style={{ color: '#0ea5e9' }}>{fmtEUR(gikDelta)}</strong> zu den <strong>Gesamtinvestitionskosten</strong> der Immobilie addiert werden?
                                </p>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.6 }}>
                                    <div>Ist-Kosten des Projekts (Rechnungen): {fmtEUR(gikIst)}</div>
                                    {hasGikTracking && <div>Bereits übernommen: {fmtEUR(gikTransferred)}</div>}
                                    {gikInfo.propertyCost !== null && (
                                        <div>Gesamtinvestitionskosten der Immobilie aktuell: {fmtEUR(gikInfo.propertyCost)} → nach Übernahme: {fmtEUR(round2(gikInfo.propertyCost + gikDelta))}</div>
                                    )}
                                </div>
                                {/* Ohne Übernahme-Spalte bzw. bei unbekanntem Altstand (NULL) ist eine frühere Übernahme nicht erkennbar */}
                                {(!hasGikTracking || project.gik_transferred_amount === null) && (
                                    <p style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '0.78rem', color: '#b45309', marginTop: '8px', lineHeight: 1.5 }}>
                                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                                        Hinweis: Eine frühere Übernahme dieses Projekts wird nicht erkannt. Wurde das Projekt schon einmal abgeschlossen und übernommen, würde der Betrag erneut addiert – dann bitte „Ohne Übernahme" wählen.
                                    </p>
                                )}
                            </>
                        )}
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px' }}>Betrifft AfA-Berechnung und Cockpit-Wert im Investorportal.</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default RenovationProjectDetail;
