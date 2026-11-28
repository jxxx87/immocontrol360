import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import { Plus, Printer, Edit2, Download, Loader2, X, FileText, MoreVertical, Eye, Lock, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';
import { useAuth } from '../context/AuthContext';
import {
    printInvoice,
    downloadInvoicePdf,
    issueInvoice,
    createCreditNote,
    getInvoiceStatus,
    getInvoiceMissingFields,
    getCreditNoteReference,
    formatDateDE,
    INVOICE_STATUS,
    INVOICE_STATUS_LABELS
} from '../lib/invoiceDocument';

const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const fmt = (v) => r2(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_BADGE_VARIANT = {
    draft: 'warning',
    issued: 'success',
    credited: 'default',
    credit_note: 'blue'
};

const StatusBadge = ({ row }) => {
    const status = getInvoiceStatus(row);
    return <Badge variant={STATUS_BADGE_VARIANT[status] || 'default'}>{INVOICE_STATUS_LABELS[status] || status}</Badge>;
};

const menuButtonStyle = (danger) => ({
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 12px', width: '100%', textAlign: 'left',
    border: 'none', background: 'none', cursor: 'pointer',
    fontSize: '0.875rem', color: danger ? 'var(--danger-color)' : 'var(--text-primary)',
    borderRadius: '4px', transition: 'background 0.2s'
});

// items: [{ key, label, icon, onClick, divider?, danger? }]
const ActionMenu = ({ items }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = React.useRef(null);
    const contentRef = React.useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);

            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            if (menuRef.current) {
                const rect = menuRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed',
                    top: `${rect.bottom + 5}px`,
                    left: `${Math.max(8, rect.right - 230)}px`,
                    zIndex: 9999
                });
            }
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '230px',
                overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px' }}>
                {items.map(item => (
                    <React.Fragment key={item.key}>
                        {item.divider && <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />}
                        <button
                            // Klick-Handler läuft synchron (wichtig für das Druckfenster / Pop-up-Blocker)
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); item.onClick(); }}
                            style={menuButtonStyle(item.danger)}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {item.icon && <item.icon size={16} />} {item.label}
                        </button>
                    </React.Fragment>
                ))}
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

const PAGE_SIZE = 1000;

const Invoices = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const perm = usePermission();
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loadWarning, setLoadWarning] = useState(null);
    const [busyMessage, setBusyMessage] = useState(null);
    const [units, setUnits] = useState([]);
    const [properties, setProperties] = useState([]);

    // Filter State
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo] = useState('');
    const [filterUnit, setFilterUnit] = useState('');
    const [filterSearch, setFilterSearch] = useState('');

    const hasPortfolioSelection = !!selectedPortfolioID && selectedPortfolioID !== 'all';

    // Schreibrecht „Finanzen" im Portfolio der Rechnung (Freigaben); die Datenbank prüft zusätzlich per RLS
    const canWriteInvoices = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite('finanzen', portfolioId) : perm.canWrite('finanzen');
    };
    const canCreateInvoice = canWriteInvoices(hasPortfolioSelection ? selectedPortfolioID : null);
    const READ_ONLY_NOTICE = 'Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Rechnungen können nur mit Schreibrecht „Finanzen“ ausgestellt oder storniert werden.';

    // Alle Rechnungen seitenweise laden (sonst schneidet das Server-Zeilenlimit ältere Rechnungen still ab);
    // Portfolio-Filter serverseitig.
    const fetchAllInvoices = async () => {
        let all = [];
        for (let from = 0, guard = 0; guard < 200; guard++, from += PAGE_SIZE) {
            let query = supabase
                .from('invoices')
                .select(`*, contact:contacts(name)`)
                .order('invoice_date', { ascending: false })
                .order('id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);
            if (hasPortfolioSelection) query = query.eq('portfolio_id', selectedPortfolioID);
            const { data, error } = await query;
            if (error) throw error;
            all = all.concat(data || []);
            if (!data || data.length < PAGE_SIZE) break;
        }
        return all;
    };

    const fetchInvoices = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            setLoadWarning(null);
            const [invData, unitRes, propRes] = await Promise.all([
                fetchAllInvoices(),
                supabase.from('units').select('id, unit_name, property_id, is_vacation_rental').eq('is_vacation_rental', true),
                supabase.from('properties').select('id, street, house_number, city, portfolio_id')
            ]);

            // Neueste zuerst; bei gleichem Datum nach Nummer
            invData.sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''))
                || String(b.invoice_number || '').localeCompare(String(a.invoice_number || ''), 'de', { numeric: true }));
            setInvoices(invData);
            setUnits(unitRes.data || []);
            setProperties(propRes.data || []);
            if (unitRes.error || propRes.error) {
                setLoadWarning('Objektdaten konnten nicht vollständig geladen werden – die Spalte „Objekt / Wohnung" ist evtl. unvollständig.');
            }
        } catch (error) {
            console.error('Error fetching invoices:', error);
            setInvoices([]);
            setLoadError('Rechnungen konnten nicht geladen werden: ' + (error?.message || 'Unbekannter Fehler'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchInvoices();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, selectedPortfolioID]);

    // Rechnungen, zu denen bereits ein eigener Gutschrift-Beleg existiert
    const creditedWithDocument = useMemo(() => {
        const ids = new Set();
        invoices.forEach(inv => {
            if (getInvoiceStatus(inv) === INVOICE_STATUS.CREDIT_NOTE) {
                const ref = getCreditNoteReference(inv);
                if (ref?.id) ids.add(ref.id);
            }
        });
        return ids;
    }, [invoices]);

    // ===== FILTERED DATA =====
    const filteredInvoices = useMemo(() => {
        let result = [...invoices];

        if (filterFrom) {
            result = result.filter(i => i.invoice_date >= filterFrom);
        }
        if (filterTo) {
            result = result.filter(i => i.invoice_date <= filterTo);
        }
        if (filterUnit) {
            result = result.filter(i => i.unit_id === filterUnit);
        }
        if (filterSearch) {
            const q = filterSearch.toLowerCase();
            result = result.filter(i => {
                const fields = [
                    i.invoice_number,
                    i.recipient_name,
                    i.sender_name,
                    i.contact?.name,
                    INVOICE_STATUS_LABELS[getInvoiceStatus(i)],
                    ...(i.positions || []).map(p => p.description)
                ].filter(Boolean).join(' ').toLowerCase();
                return fields.includes(q);
            });
        }

        return result;
    }, [invoices, filterFrom, filterTo, filterUnit, filterSearch]);

    const hasFilters = filterFrom || filterTo || filterUnit || filterSearch;

    const clearFilters = () => {
        setFilterFrom('');
        setFilterTo('');
        setFilterUnit('');
        setFilterSearch('');
    };

    // ===== PRINT / PDF (gemeinsames Rechnungs-Modul; Belegart ausschließlich aus dem Status) =====
    const handlePrint = (invoice, { legacyCredit = false } = {}) => {
        // printInvoice öffnet das Fenster synchron, bevor Vorlagen geladen werden
        printInvoice(invoice, { user, portfolios, legacyCredit }).catch(err => {
            console.error(err);
            alert('Druck-Fehler: ' + (err.message || err));
        });
    };

    const handlePDF = async (invoice, { legacyCredit = false } = {}) => {
        setBusyMessage('PDF wird erstellt…');
        try {
            await downloadInvoicePdf(invoice, { user, portfolios, legacyCredit });
        } catch (error) {
            console.error(error);
            alert('PDF-Fehler: ' + (error.message || error));
        } finally {
            setBusyMessage(null);
        }
    };

    // ===== AUSSTELLEN (Entwurf -> festgeschrieben) =====
    const handleIssue = async (invoice) => {
        if (!canWriteInvoices(invoice.portfolio_id)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        const portfolio = portfolios.find(p => p.id === invoice.portfolio_id);
        const missing = getInvoiceMissingFields(invoice, portfolio);
        const msg = (missing.length
            ? `Achtung, es fehlen Angaben:\n- ${missing.join('\n- ')}\n\nFehlende Angaben werden im Dokument rot markiert.\n\n`
            : '')
            + `Rechnung Nr. ${invoice.invoice_number} jetzt ausstellen? Sie wird damit festgeschrieben und kann nicht mehr bearbeitet werden; Korrekturen sind nur noch über eine Gutschrift möglich.`;
        if (!window.confirm(msg)) return;
        setBusyMessage('Rechnung wird ausgestellt…');
        try {
            const updated = await issueInvoice(invoice.id);
            setInvoices(prev => prev.map(inv => (inv.id === invoice.id ? { ...inv, ...updated } : inv)));
        } catch (error) {
            console.error('Error issuing invoice:', error);
            alert('Fehler: ' + (error.message || error));
        } finally {
            setBusyMessage(null);
        }
    };

    // ===== GUTSCHRIFT / STORNO (eigener Beleg, Original bleibt unverändert) =====
    const handleCredit = async (invoice) => {
        if (!canWriteInvoices(invoice.portfolio_id)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        if (getInvoiceStatus(invoice) !== INVOICE_STATUS.ISSUED) {
            alert('Eine Gutschrift kann nur zu einer ausgestellten Rechnung erstellt werden.');
            return;
        }
        const ok = window.confirm(
            `Zu Rechnung Nr. ${invoice.invoice_number} wird eine Gutschrift (Storno) über ${fmt(-(Number(invoice.gross_amount) || 0))} € `
            + 'mit eigener, fortlaufender Nummer und heutigem Datum erstellt. Die Rechnung selbst bleibt unverändert und wird als storniert gekennzeichnet.\n\nFortfahren?'
        );
        if (!ok) return;

        setBusyMessage('Gutschrift wird erstellt…');
        let creditNote = null;
        try {
            creditNote = await createCreditNote(invoice);
            setInvoices(prev => [creditNote, ...prev.map(inv => (inv.id === invoice.id ? { ...inv, status: INVOICE_STATUS.CREDITED } : inv))]);
        } catch (error) {
            console.error('Error crediting invoice:', error);
            alert('Fehler: ' + (error.message || error));
            setBusyMessage(null);
            return;
        }
        setBusyMessage('PDF wird erstellt…');
        try {
            await downloadInvoicePdf(creditNote, { user, portfolios });
        } catch (pdfError) {
            console.error(pdfError);
            alert(`Die Gutschrift Nr. ${creditNote.invoice_number} wurde erstellt, das PDF konnte aber nicht erzeugt werden: ${pdfError.message || pdfError}\nSie können es über das Menü erneut herunterladen.`);
        } finally {
            setBusyMessage(null);
        }
    };

    const getMenuItems = (row) => {
        const status = getInvoiceStatus(row);
        const writable = canWriteInvoices(row.portfolio_id);
        if (status === INVOICE_STATUS.DRAFT && !writable) {
            // Freigabe nur zum Lesen: ansehen und Vorschau, kein Bearbeiten/Ausstellen
            return [
                { key: 'view', label: 'Ansehen', icon: Eye, onClick: () => navigate(`/invoices/edit/${row.id}`) },
                { key: 'print', label: 'Vorschau drucken (Entwurf)', icon: Printer, onClick: () => handlePrint(row), divider: true },
                { key: 'pdf', label: 'Vorschau als PDF (Entwurf)', icon: Download, onClick: () => handlePDF(row) }
            ];
        }
        if (status === INVOICE_STATUS.DRAFT) {
            return [
                { key: 'edit', label: 'Bearbeiten', icon: Edit2, onClick: () => navigate(`/invoices/edit/${row.id}`) },
                { key: 'issue', label: 'Ausstellen (festschreiben)', icon: Lock, onClick: () => handleIssue(row) },
                { key: 'print', label: 'Vorschau drucken (Entwurf)', icon: Printer, onClick: () => handlePrint(row), divider: true },
                { key: 'pdf', label: 'Vorschau als PDF (Entwurf)', icon: Download, onClick: () => handlePDF(row) }
            ];
        }
        const items = [
            { key: 'view', label: 'Ansehen', icon: Eye, onClick: () => navigate(`/invoices/edit/${row.id}`) },
            { key: 'print', label: 'Drucken', icon: Printer, onClick: () => handlePrint(row) },
            { key: 'pdf', label: 'Download PDF', icon: Download, onClick: () => handlePDF(row) }
        ];
        if (status === INVOICE_STATUS.ISSUED && writable) {
            items.push({ key: 'credit', label: 'Gutschrift / Storno erstellen', icon: FileText, onClick: () => handleCredit(row), divider: true });
        }
        if (status === INVOICE_STATUS.CREDITED && !creditedWithDocument.has(row.id)) {
            // Altbestand: Gutschrift wurde früher nur als Status geführt
            items.push({ key: 'legacy-print', label: 'Gutschrift (alt) drucken', icon: Printer, onClick: () => handlePrint(row, { legacyCredit: true }), divider: true });
            items.push({ key: 'legacy-pdf', label: 'Gutschrift (alt) als PDF', icon: Download, onClick: () => handlePDF(row, { legacyCredit: true }) });
        }
        return items;
    };

    const columns = [
        { header: 'Rechnungs-Nr.', accessor: 'invoice_number', render: (row) => <span style={{ fontWeight: 600 }}>{row.invoice_number}</span> },
        {
            header: 'Datum',
            accessor: 'invoice_date',
            render: (row) => formatDateDE(row.invoice_date) || '-'
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => <StatusBadge row={row} />
        },
        {
            header: 'Empfänger',
            accessor: 'recipient_name',
            render: (row) => row.recipient_name || row.contact?.name || '-'
        },
        {
            header: 'Objekt / Wohnung',
            accessor: 'unit_id',
            render: (row) => {
                const unit = units.find(u => u.id === row.unit_id);
                const property = properties.find(p => p.id === unit?.property_id);

                if (!unit) return '-';

                return (
                    <div>
                        <div style={{ fontWeight: 500 }}>{unit.unit_name}</div>
                        {property && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{property.street}, {property.city}</div>}
                    </div>
                );
            }
        },
        {
            header: 'Brutto',
            accessor: 'gross_amount',
            align: 'right',
            render: (row) => <span style={{ fontWeight: 600 }}>{fmt(row.gross_amount || 0)} €</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionMenu items={getMenuItems(row)} />
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            {busyMessage && <LoadingOverlay message={busyMessage} />}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Rechnungen Fewo</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Rechnungen</p>
                </div>
                {canCreateInvoice && <Button icon={Plus} onClick={() => navigate('/invoices/new')}>Neue Rechnung</Button>}
            </div>

            {loadError && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', marginBottom: 'var(--spacing-lg)', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c', fontSize: '0.875rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={16} /> {loadError}</span>
                    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchInvoices}>Erneut laden</Button>
                </div>
            )}
            {loadWarning && !loadError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', marginBottom: 'var(--spacing-lg)', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: '0.85rem' }}>
                    <AlertTriangle size={16} /> {loadWarning}
                </div>
            )}

            {/* Filters */}
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                        <Input label="Von" type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                        <Input label="Bis" type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 200px', marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500, fontSize: '0.875rem' }}>Objekt</label>
                        <select
                            value={filterUnit}
                            onChange={e => setFilterUnit(e.target.value)}
                            style={{
                                width: '100%', padding: '0.5rem 0.75rem',
                                borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                fontSize: '0.875rem'
                            }}
                        >
                            <option value="">Alle Objekte</option>
                            {units.map(u => {
                                const prop = properties.find(p => p.id === u.property_id);
                                return <option key={u.id} value={u.id}>{u.unit_name}{prop ? ` – ${prop.street}` : ''}</option>;
                            })}
                        </select>
                    </div>
                    <div style={{ flex: '2 1 300px' }}>
                        <Input
                            label="Suche"
                            placeholder="Name, Rechnungsnummer, Objekt..."
                            value={filterSearch}
                            onChange={e => setFilterSearch(e.target.value)}
                        />
                    </div>
                    {hasFilters && (
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>Filter zurücksetzen</Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Table */}
            <Card>
                {filteredInvoices.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {loadError ? 'Keine Daten verfügbar.' : (hasFilters ? 'Keine Rechnungen für die gewählten Filter gefunden.' : 'Keine Rechnungen gefunden.')}
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <Table
                                columns={columns}
                                data={filteredInvoices}
                                getRowStyle={(row) => getInvoiceStatus(row) === INVOICE_STATUS.CREDITED ? { color: 'var(--text-secondary)', textDecoration: 'line-through' } : {}}
                            />
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {filteredInvoices.map((row) => {
                                const isCredited = getInvoiceStatus(row) === INVOICE_STATUS.CREDITED;
                                const unit = units.find(u => u.id === row.unit_id);
                                const property = properties.find(p => p.id === unit?.property_id);

                                return (
                                    <div key={row.id} style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                        backgroundColor: 'var(--surface-color)',
                                        position: 'relative',
                                        opacity: isCredited ? 0.7 : 1
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem', textDecoration: isCredited ? 'line-through' : 'none' }}>
                                                    {row.invoice_number}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                                                    {formatDateDE(row.invoice_date) || '-'} <StatusBadge row={row} />
                                                </div>
                                            </div>
                                            <div style={{ fontWeight: 700, fontSize: '1rem', color: isCredited ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                                {fmt(row.gross_amount || 0)} €
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '12px', fontSize: '0.9rem' }}>
                                            <div style={{ fontWeight: 500 }}>{row.recipient_name || row.contact?.name || '-'}</div>
                                            {(unit || property) && (
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    {unit?.unit_name} {property ? `• ${property.street}` : ''}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                            <ActionMenu items={getMenuItems(row)} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
};

export default Invoices;
