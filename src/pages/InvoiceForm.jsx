import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Plus,
    Trash2,
    Printer,
    Download,
    Check,
    Search,
    UserPlus,
    Loader2,
    Lock,
    AlertTriangle,
    Eye
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import Modal from '../components/ui/Modal';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import {
    printInvoice,
    downloadInvoicePdf,
    fetchNextInvoiceNumber,
    insertInvoiceWithNumber,
    issueInvoice,
    getInvoiceMissingFields,
    getInvoiceStatus,
    isInvoiceEditable,
    isInvoiceSmallBusiness,
    isSmallBusinessPortfolio,
    hasSmallBusinessColumn,
    toLocalDateString,
    parseLocalDate,
    computeTaxBreakdown,
    INVOICE_STATUS,
    INVOICE_STATUS_LABELS,
    VAT_RATE_OPTIONS,
    LEGACY_VAT_RATE,
    SMALL_BUSINESS_NOTE
} from '../lib/invoiceDocument';

const READ_ONLY_NOTICE = 'Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Rechnungen können nur mit Schreibrecht „Finanzen“ angelegt, geändert oder ausgestellt werden.';

// Helpers
const toNum = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v ?? '').trim();
    // Deutsches Format ("1.000,50") oder Zahl als Text ("155.76")
    const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (num) => Math.round((toNum(num) + Number.EPSILON) * 100) / 100;
const r4 = (num) => Math.round((toNum(num) + Number.EPSILON) * 10000) / 10000;
const fmt = (num) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num || 0);
const fmtEur = (num) => fmt(num) + ' €';
const fmtRate = (rate) => `${Number(rate).toLocaleString('de-DE')} %`;

// Betrag einer Position aus dem zuletzt eingegebenen Wert (Preis/Nacht, Netto oder Brutto) neu berechnen.
// Der Preis/Nacht wird ungerundet (4 Stellen) geführt, damit Netto beim erneuten Öffnen nicht um Cent abweicht.
const recalcItem = (item, nightsForItem, rate) => {
    const it = { ...item };
    const n = nightsForItem > 0 ? nightsForItem : 1;
    const r = toNum(rate);
    const basis = it.basis || 'net';
    if (basis === 'gross') {
        it.grossTotal = r2(it.grossTotal);
        it.netTotal = r2(it.grossTotal / (1 + r / 100));
        it.vat = r2(it.grossTotal - it.netTotal);
        it.pricePerNight = r4(it.netTotal / n);
    } else if (basis === 'ppn') {
        it.pricePerNight = r4(it.pricePerNight);
        it.netTotal = r2(n * it.pricePerNight);
        it.vat = r2(it.netTotal * r / 100);
        it.grossTotal = r2(it.netTotal + it.vat);
    } else {
        it.netTotal = r2(it.netTotal);
        it.vat = r2(it.netTotal * r / 100);
        it.grossTotal = r2(it.netTotal + it.vat);
        it.pricePerNight = r4(it.netTotal / n);
    }
    return it;
};

const InvoiceForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const editId = id;
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const perm = usePermission();
    const hasPortfolioSelection = !!selectedPortfolioID && selectedPortfolioID !== 'all';

    // Schreibrecht „Finanzen“ im Portfolio der Rechnung (Freigaben, wie Invoices.jsx); ohne Portfolio:
    // aktueller Bereich. Während die Rechte laden, optimistisch; die Datenbank prüft zusätzlich per RLS.
    const canWriteInvoices = useCallback((portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite('finanzen', portfolioId) : perm.canWrite('finanzen');
    }, [perm]);

    // State
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [successModal, setSuccessModal] = useState(false);
    const [savedInvoice, setSavedInvoice] = useState(null);
    const [loadedInvoice, setLoadedInvoice] = useState(null);

    // Form Data
    const [portfolios, setPortfolios] = useState([]);
    const [properties, setProperties] = useState([]);
    const [allUnits, setAllUnits] = useState([]);
    const [contacts, setContacts] = useState([]);

    const [senderPortfolioId, setSenderPortfolioId] = useState('');
    const [senderName, setSenderName] = useState('');
    const [senderStreet, setSenderStreet] = useState('');
    const [senderZip, setSenderZip] = useState('');
    const [senderCity, setSenderCity] = useState('');

    const [recipientContactId, setRecipientContactId] = useState(null);
    const [recipientName, setRecipientName] = useState('');
    const [recipientStreet, setRecipientStreet] = useState('');
    const [recipientZip, setRecipientZip] = useState('');
    const [recipientCity, setRecipientCity] = useState('');

    // Lokales Datum (toISOString wäre UTC -> zwischen 0 und 2 Uhr der Vortag)
    const [invoiceDate, setInvoiceDate] = useState(() => toLocalDateString());
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [numberError, setNumberError] = useState(null);
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [moveIn, setMoveIn] = useState('');
    const [moveOut, setMoveOut] = useState('');
    const [persons, setPersons] = useState(1);
    const [positions, setPositions] = useState([]);
    const [smallBusiness, setSmallBusiness] = useState(false);
    const [savingPortfolioFlag, setSavingPortfolioFlag] = useState(false);

    // Hat der Nutzer Anreise/Abreise/Personen/Einheit aktiv geändert? (Im Bearbeiten-Modus wird sonst nichts neu berechnet.)
    const stayTouchedRef = useRef(false);
    // Hat der Nutzer die Bezeichnung der Position 1 selbst geändert? (Dann nicht mehr automatisch überschreiben.)
    const manualDescRef = useRef(false);

    // Contact Picker State
    const [contactPickerOpen, setContactPickerOpen] = useState(false);
    const [contactSearch, setContactSearch] = useState('');

    const invoiceStatus = isEdit ? getInvoiceStatus(loadedInvoice) : INVOICE_STATUS.DRAFT;
    // Festgeschrieben (ausgestellt/storniert/Gutschrift) – unabhängig von Freigaben
    const lockedByStatus = isEdit && !!loadedInvoice && !isInvoiceEditable(loadedInvoice);
    // Lesemodus bei Freigabe ohne Schreibrecht „Finanzen“ für das Portfolio der Rechnung; bei Neuanlage
    // zählt der aktuelle Bereich (die Auswahl der Ferienwohnung zeigt nur beschreibbare Portfolios,
    // handleSave prüft das Portfolio der gewählten Wohnung)
    const noWriteAccess = isEdit
        ? !!loadedInvoice && !canWriteInvoices(loadedInvoice.portfolio_id || null)
        : !canWriteInvoices(hasPortfolioSelection ? selectedPortfolioID : null);
    const readOnly = lockedByStatus || noWriteAccess;

    // Derived
    const vacationUnits = useMemo(() => {
        let filtered = allUnits.filter(u => u.is_vacation_rental === true);

        if (hasPortfolioSelection) {
            const portfolioProps = properties.filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id);
            filtered = filtered.filter(u => portfolioProps.includes(u.property_id));
        }
        // Neuanlage nur für Ferienwohnungen aus Portfolios mit Schreibrecht „Finanzen“
        if (!isEdit) {
            const portfolioOf = new Map(properties.map(p => [p.id, p.portfolio_id]));
            filtered = filtered.filter(u => canWriteInvoices(portfolioOf.get(u.property_id) || null));
        }
        return filtered;
    }, [allUnits, properties, selectedPortfolioID, hasPortfolioSelection, isEdit, canWriteInvoices]);
    const selectedUnit = useMemo(() => allUnits.find(u => u.id === selectedUnitId), [allUnits, selectedUnitId]);
    const senderPortfolio = useMemo(() => portfolios.find(p => p.id === senderPortfolioId) || null, [portfolios, senderPortfolioId]);

    const nights = useMemo(() => {
        const start = parseLocalDate(moveIn);
        const end = parseLocalDate(moveOut);
        if (!start || !end) return 0;
        const diff = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
        return diff > 0 ? diff : 0;
    }, [moveIn, moveOut]);

    const unitAddress = useMemo(() => {
        if (!selectedUnit) return '';
        const prop = properties.find(p => p.id === selectedUnit.property_id);
        if (!prop) return '';
        return `${prop.street} ${prop.house_number || ''}, ${prop.zip || ''} ${prop.city || ''}`.replace(/\s+/g, ' ').trim();
    }, [selectedUnit, properties]);

    const effectiveRate = (p) => (smallBusiness ? 0 : (p.vatRate === null || p.vatRate === undefined ? 0 : toNum(p.vatRate)));
    const nightsFor = (p) => (p.isFirst ? (nights || 1) : 1);

    // ===== DATA FETCHING =====
    useEffect(() => {
        if (user) fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isEdit, editId, reloadKey]);

    const fetchData = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const [portRes, propRes, unitRes, contactRes] = await Promise.all([
                supabase.from('portfolios').select('*'),
                supabase.from('properties').select('*'),
                supabase.from('units').select('*'),
                supabase.from('contacts').select('*').order('name')
            ]);
            const firstError = portRes.error || propRes.error || unitRes.error || contactRes.error;
            if (firstError) throw firstError;

            const ports = portRes.data || [];
            const props = propRes.data || [];
            const units = unitRes.data || [];

            setPortfolios(ports);
            setProperties(props);
            setAllUnits(units);
            setContacts(contactRes.data || []);

            if (isEdit && editId) {
                const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', editId).maybeSingle();
                if (error) throw error;
                if (!inv) {
                    setLoadError('Die Rechnung wurde nicht gefunden oder Sie haben keinen Zugriff darauf.');
                    return;
                }
                setLoadedInvoice(inv);
                setSenderName(inv.sender_name || '');
                setSenderStreet(inv.sender_street || '');
                setSenderZip(inv.sender_zip || '');
                setSenderCity(inv.sender_city || '');
                setRecipientName(inv.recipient_name || '');
                setRecipientStreet(inv.recipient_street || '');
                setRecipientZip(inv.recipient_zip || '');
                setRecipientCity(inv.recipient_city || '');
                setRecipientContactId(inv.contact_id || null);
                setInvoiceDate(inv.invoice_date || '');
                setInvoiceNumber(inv.invoice_number || '');
                setSelectedUnitId(inv.unit_id || '');
                setMoveIn(inv.move_in || '');
                setMoveOut(inv.move_out || '');
                setPersons(inv.persons || 1);
                setSenderPortfolioId(inv.portfolio_id || '');

                const sb = isInvoiceSmallBusiness(inv);
                setSmallBusiness(sb);
                // Gespeicherte Beträge unverändert übernehmen (keine Neuberechnung beim Öffnen)
                const loadedPositions = Array.isArray(inv.positions) ? inv.positions : [];
                setPositions(loadedPositions.map((p, idx) => ({
                    ...p,
                    pos: p.pos ?? idx + 1,
                    isFirst: idx === 0 ? (p.isFirst ?? true) : !!p.isFirst,
                    vatRate: sb ? 0 : (p.vatRate ?? LEGACY_VAT_RATE),
                    basis: p.basis || ((idx === 0 || p.isFirst) && toNum(p.pricePerNight) > 0 ? 'ppn' : 'net')
                })));
                stayTouchedRef.current = false;
                manualDescRef.current = true; // gespeicherter Text bleibt, bis Aufenthaltsdaten aktiv geändert werden
            } else {
                // Absender aus dem aktuell gewählten Portfolio vorbelegen
                if (hasPortfolioSelection) {
                    const portfolio = ports.find(p => p.id === selectedPortfolioID);
                    if (portfolio) {
                        setSenderPortfolioId(portfolio.id);
                        setSenderName(portfolio.company_name || portfolio.name || '');
                        setSenderStreet(portfolio.street ? `${portfolio.street} ${portfolio.house_number || ''}`.trim() : '');
                        setSenderZip(portfolio.zip || '');
                        setSenderCity(portfolio.city || '');
                    }

                    const portProps = props.filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id);
                    const firstUnit = units.find(u => u.is_vacation_rental === true && portProps.includes(u.property_id));
                    if (firstUnit) {
                        setSelectedUnitId(firstUnit.id);
                    }
                }
            }
        } catch (err) {
            console.error('InvoiceForm load error:', err);
            setLoadError('Die Daten konnten nicht geladen werden: ' + (err?.message || 'Unbekannter Fehler') + '. Bitte versuchen Sie es erneut.');
        } finally {
            setLoading(false);
        }
    };

    // ===== AUTO-FILL SENDER FROM UNIT (nur Neuanlage, nur bei Wechsel der Einheit) =====
    const lastAutofillUnitRef = useRef(null);
    useEffect(() => {
        if (!selectedUnitId || isEdit || loading) return;
        if (lastAutofillUnitRef.current === selectedUnitId) return; // manuelle Absender-Änderungen nicht überschreiben

        const unit = allUnits.find(u => u.id === selectedUnitId);
        if (!unit) return;

        const property = properties.find(p => p.id === unit.property_id);
        if (!property) return;

        const portfolio = portfolios.find(p => p.id === property.portfolio_id);
        if (portfolio) {
            lastAutofillUnitRef.current = selectedUnitId;
            setSenderPortfolioId(portfolio.id);
            setSenderName(portfolio.company_name || portfolio.name || '');
            setSenderStreet(portfolio.street ? `${portfolio.street} ${portfolio.house_number || ''}`.trim() : '');
            setSenderZip(portfolio.zip || '');
            setSenderCity(portfolio.city || '');
        }
    }, [selectedUnitId, allUnits, properties, portfolios, isEdit, loading]);

    // Reset unit selection if portfolio changes and currently selected unit is no longer valid
    useEffect(() => {
        if (!isEdit && selectedUnitId && vacationUnits.length > 0 && !vacationUnits.find(u => u.id === selectedUnitId)) {
            setSelectedUnitId('');
        }
    }, [vacationUnits, selectedUnitId, isEdit]);

    // ===== INVOICE NUMBER (Vorschau; die endgültige Nummer wird erst beim Speichern vergeben) =====
    const invoiceYear = (invoiceDate || '').slice(0, 4);
    useEffect(() => {
        if (isEdit || loading) return;
        if (!senderPortfolioId) {
            setInvoiceNumber('');
            setNumberError(null);
            return;
        }
        let cancelled = false;
        fetchNextInvoiceNumber(senderPortfolioId, invoiceDate)
            .then(n => { if (!cancelled) { setInvoiceNumber(n); setNumberError(null); } })
            .catch(err => {
                console.error('Error generating invoice number:', err);
                if (!cancelled) { setInvoiceNumber(''); setNumberError('Nummer konnte nicht ermittelt werden – sie wird beim Speichern vergeben.'); }
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senderPortfolioId, invoiceYear, isEdit, loading]);

    // ===== KLEINUNTERNEHMER (Voreinstellung aus dem Portfolio, nur Neuanlage) =====
    const applySmallBusiness = (checked) => {
        setSmallBusiness(checked);
        setPositions(prev => prev.map(p => recalcItem(p, p.isFirst ? (nights || 1) : 1, checked ? 0 : (p.vatRate ?? 0))));
    };

    useEffect(() => {
        if (isEdit || loading) return;
        const preset = isSmallBusinessPortfolio(senderPortfolio);
        if (preset !== smallBusiness) applySmallBusiness(preset);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senderPortfolio, isEdit, loading]);

    // ===== POSITION 1 AUTO-SETUP =====
    useEffect(() => {
        if (positions.length === 0 && !isEdit && !loading) {
            setPositions([{
                pos: 1,
                description: '',
                pricePerNight: 0,
                netTotal: 0,
                vat: 0,
                grossTotal: 0,
                isFirst: true,
                vatRate: LEGACY_VAT_RATE, // Beherbergung (bisheriger Standardsatz), änderbar
                basis: 'ppn'
            }]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit, loading]);

    const buildFirstDescription = () => {
        const unitLabel = selectedUnit?.unit_name ? `Ferienwohnung ${selectedUnit.unit_name}` : 'Ferienwohnung';
        const addr = unitAddress ? ` (${unitAddress})` : '';
        const lines = [];

        if (nights > 0) {
            lines.push(`${nights} Übernachtung${nights > 1 ? 'en' : ''} in ${unitLabel}${addr}`);
        } else {
            lines.push(`Übernachtungen in ${unitLabel}${addr}`);
        }

        if (persons > 0) lines.push(`${persons} Person${persons > 1 ? 'en' : ''}`);
        return lines.join('\n');
    };

    // Bezeichnung der Position 1: bei Neuanlage automatisch; im Bearbeiten-Modus nur nach aktiver Änderung
    // von Anreise/Abreise/Personen/Einheit – und nie, wenn der Text von Hand angepasst wurde.
    useEffect(() => {
        if (loading || readOnly) return;
        if (isEdit && !stayTouchedRef.current) return;
        if (manualDescRef.current && !stayTouchedRef.current) return;
        if (positions.length > 0 && positions[0].isFirst) {
            const desc = buildFirstDescription();
            if (positions[0].description !== desc) {
                manualDescRef.current = false;
                setPositions(prev => {
                    if (!prev.length) return prev;
                    const updated = [...prev];
                    updated[0] = { ...updated[0], description: desc };
                    return updated;
                });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nights, unitAddress, persons, selectedUnitId, positions.length, loading]);

    // Nächte geändert (nur nach aktiver Änderung): Position 1 aus dem zuletzt eingegebenen Wert neu rechnen
    useEffect(() => {
        if (loading || readOnly || !stayTouchedRef.current) return;
        setPositions(prev => {
            if (!prev.length || !prev[0].isFirst) return prev;
            const updated = [...prev];
            updated[0] = recalcItem(updated[0], nights || 1, smallBusiness ? 0 : (updated[0].vatRate ?? 0));
            return updated;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nights]);

    const touchStay = () => { stayTouchedRef.current = true; };

    // ===== CALCULATIONS =====
    const updatePosition = (idx, field, value) => {
        const updated = [...positions];
        let item = { ...updated[idx] };

        if (field === 'description') {
            item.description = value;
            if (idx === 0) { manualDescRef.current = true; stayTouchedRef.current = false; }
        } else if (field === 'vatRate') {
            item.vatRate = value === '' || value === null ? null : Number(value);
            item = recalcItem(item, nightsFor(item), effectiveRate(item));
        } else {
            const numVal = toNum(value);
            if (field === 'pricePerNight') { item.pricePerNight = numVal; item.basis = 'ppn'; }
            else if (field === 'netTotal') { item.netTotal = numVal; item.basis = 'net'; }
            else if (field === 'grossTotal') { item.grossTotal = numVal; item.basis = 'gross'; }
            item = recalcItem(item, nightsFor(item), effectiveRate(item));
        }

        updated[idx] = item;
        setPositions(updated);
    };

    const addPosition = () => {
        setPositions([...positions, {
            pos: positions.length + 1,
            description: '',
            pricePerNight: 0,
            netTotal: 0,
            vat: 0,
            grossTotal: 0,
            isFirst: false,
            vatRate: null, // Steuersatz muss bewusst gewählt werden (bei § 19 UStG gilt ohnehin 0 %)
            basis: 'net'
        }]);
    };

    const removePosition = (idx) => {
        if (idx === 0) return;
        const updated = positions.filter((_, i) => i !== idx).map((p, i) => ({ ...p, pos: i + 1 }));
        setPositions(updated);
    };

    const totalNet = useMemo(() => r2(positions.reduce((s, p) => s + toNum(p.netTotal), 0)), [positions]);
    const totalVat = useMemo(() => r2(positions.reduce((s, p) => s + toNum(p.vat), 0)), [positions]);
    const totalGross = useMemo(() => r2(positions.reduce((s, p) => s + toNum(p.grossTotal), 0)), [positions]);
    const taxBreakdown = useMemo(
        () => computeTaxBreakdown(positions.map(p => ({ ...p, vatRate: smallBusiness ? 0 : (p.vatRate ?? 0) })), smallBusiness),
        [positions, smallBusiness]
    );
    const hasZeroRateWithoutExemption = !smallBusiness && positions.some(p => p.vatRate === 0 && (toNum(p.netTotal) !== 0 || p.description));

    // Positionen so, wie sie gespeichert/gedruckt werden (Steuersatz und § 19 eingefroren)
    const buildPositionsForSave = () => positions.map((p, i) => {
        const { smallBusiness: _sb, ...rest } = p;
        return {
            ...rest,
            pos: i + 1,
            vatRate: smallBusiness ? 0 : p.vatRate,
            ...(smallBusiness ? { smallBusiness: true } : {})
        };
    });

    // Aktueller Formularstand als Rechnungsobjekt (Vorschau, Pflichtangaben-Prüfung)
    const buildInvoiceFromState = () => ({
        ...(loadedInvoice || {}),
        portfolio_id: senderPortfolioId || null,
        unit_id: selectedUnitId || null,
        contact_id: recipientContactId || null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        sender_name: senderName,
        sender_street: senderStreet,
        sender_zip: senderZip,
        sender_city: senderCity,
        recipient_name: recipientName,
        recipient_street: recipientStreet,
        recipient_zip: recipientZip,
        recipient_city: recipientCity,
        move_in: moveIn || null,
        move_out: moveOut || null,
        persons: persons || 1,
        positions: buildPositionsForSave(),
        net_amount: totalNet,
        vat_amount: smallBusiness ? 0 : totalVat,
        gross_amount: totalGross,
        status: isEdit ? invoiceStatus : INVOICE_STATUS.DRAFT
    });

    const missingFields = useMemo(() => {
        if (loading || readOnly) return [];
        return getInvoiceMissingFields(buildInvoiceFromState(), senderPortfolio)
            .filter(f => isEdit || f !== 'Rechnungsnummer'); // bei Neuanlage wird die Nummer beim Speichern vergeben
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, readOnly, senderPortfolio, senderName, senderStreet, senderZip, senderCity, recipientName, recipientStreet, recipientZip, recipientCity, invoiceNumber, invoiceDate, moveIn, moveOut, isEdit]);

    // ===== CONTACTS =====
    const filteredContacts = useMemo(() => {
        if (!contactSearch) return contacts;
        const q = contactSearch.toLowerCase();
        return contacts.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.street || '').toLowerCase().includes(q) ||
            (c.city || '').toLowerCase().includes(q)
        );
    }, [contacts, contactSearch]);

    const selectContact = (contact) => {
        setRecipientName(contact.name || '');
        setRecipientStreet(contact.street || '');
        setRecipientZip(contact.zip || '');
        setRecipientCity(contact.city || '');
        setRecipientContactId(contact.id);
        setContactPickerOpen(false);
        setContactSearch('');
    };

    const saveAsContact = async () => {
        const name = recipientName.trim();
        if (!name) return alert('Bitte Name eingeben.');
        try {
            const fields = {
                name,
                street: recipientStreet,
                zip: recipientZip,
                city: recipientCity
            };

            // Nur eigene Gast-Kontakte zählen als Dublette (Mieter/Handwerker gleichen Namens bleiben unberührt)
            const { data: existingByName, error: findError } = await supabase
                .from('contacts')
                .select('id, name')
                .eq('user_id', user.id)
                .eq('contact_type', 'guest')
                .eq('name', name)
                .limit(1);
            if (findError) throw findError;

            const picked = contacts.find(c => c.id === recipientContactId);
            let targetId = (picked && picked.user_id === user.id && picked.contact_type === 'guest') ? picked.id : null;

            if (existingByName && existingByName.length > 0 && existingByName[0].id !== targetId) {
                if (!window.confirm(`Ein Gast-Kontakt mit dem Namen "${name}" existiert bereits. Möchten Sie diesen mit der eingegebenen Adresse aktualisieren?`)) return;
                targetId = existingByName[0].id;
            }

            if (targetId) {
                // Kontakt-Typ und Besitzer werden beim Aktualisieren nicht verändert
                const { data, error } = await supabase.from('contacts').update(fields).eq('id', targetId).select('id');
                if (error) throw error;
                if (!data || data.length === 0) throw new Error('Der Kontakt konnte nicht aktualisiert werden (keine Berechtigung).');
                setRecipientContactId(targetId);
                alert('Kontakt aktualisiert!');
            } else {
                const { data, error } = await supabase
                    .from('contacts')
                    .insert([{ ...fields, user_id: user.id, contact_type: 'guest' }])
                    .select()
                    .single();
                if (error) throw error;
                if (data) setRecipientContactId(data.id);
                alert(picked ? 'Neuer Gast-Kontakt angelegt (der ausgewählte Kontakt bleibt unverändert).' : 'Kontakt neu angelegt!');
            }
            const { data: refreshed, error: refreshError } = await supabase.from('contacts').select('*').order('name');
            if (!refreshError) setContacts(refreshed || []);
        } catch (err) {
            console.error('Error saving contact:', err);
            alert('Fehler: ' + (err.message || err));
        }
    };

    // ===== KLEINUNTERNEHMER ALS PORTFOLIO-STANDARD =====
    const canSavePortfolioFlag = !readOnly
        && hasSmallBusinessColumn(senderPortfolio)
        && senderPortfolio?.user_id === user?.id
        && isSmallBusinessPortfolio(senderPortfolio) !== smallBusiness;

    const savePortfolioFlag = async () => {
        if (!senderPortfolio) return;
        setSavingPortfolioFlag(true);
        try {
            const { data, error } = await supabase
                .from('portfolios')
                .update({ is_small_business: smallBusiness })
                .eq('id', senderPortfolio.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, das Portfolio zu ändern.');
            setPortfolios(prev => prev.map(p => (p.id === senderPortfolio.id ? { ...p, is_small_business: smallBusiness } : p)));
        } catch (err) {
            alert('Fehler: ' + (err.message || err));
        } finally {
            setSavingPortfolioFlag(false);
        }
    };

    // ===== PRINT / PDF =====
    const handlePrint = (data) => {
        if (!data) return;
        // Vorlagenbasierte Ausgabe über das gemeinsame Rechnungs-Modul; das Fenster öffnet synchron im Klick.
        printInvoice({ ...data, portfolio_id: data.portfolio_id || senderPortfolioId }, { user, portfolios })
            .catch(err => {
                console.error(err);
                alert('Druck-Fehler: ' + (err.message || err));
            });
    };

    const handlePDF = async (data) => {
        if (!data) return;
        setPdfGenerating(true);
        try {
            await downloadInvoicePdf({ ...data, portfolio_id: data.portfolio_id || senderPortfolioId }, { user, portfolios });
        } catch (error) {
            console.error(error);
            alert('PDF-Fehler: ' + (error.message || error));
        } finally {
            setPdfGenerating(false);
        }
    };

    // Entwurfsvorschau des aktuellen (auch ungespeicherten) Formularstands – mit Vermerk „ENTWURF"
    const handlePreview = () => handlePrint({ ...buildInvoiceFromState(), status: INVOICE_STATUS.DRAFT });

    // ===== AUSSTELLEN =====
    const handleIssue = async () => {
        if (!savedInvoice) return;
        if (!canWriteInvoices(savedInvoice.portfolio_id || null)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        const missing = getInvoiceMissingFields(savedInvoice, portfolios.find(p => p.id === savedInvoice.portfolio_id));
        const msg = (missing.length
            ? `Achtung, es fehlen Angaben:\n- ${missing.join('\n- ')}\n\nFehlende Angaben werden im Dokument rot markiert.\n\n`
            : '')
            + 'Mit dem Ausstellen wird die Rechnung festgeschrieben. Danach kann sie nicht mehr bearbeitet werden; Korrekturen sind nur noch über eine Gutschrift möglich. Jetzt ausstellen?';
        if (!window.confirm(msg)) return;
        setIssuing(true);
        try {
            const updated = await issueInvoice(savedInvoice.id);
            setSavedInvoice(updated);
        } catch (err) {
            alert('Fehler: ' + (err.message || err));
        } finally {
            setIssuing(false);
        }
    };

    // ===== VALIDATION =====
    const validate = () => {
        const errors = [];
        if (!senderPortfolioId) errors.push('Bitte eine Ferienwohnung wählen (sie bestimmt Portfolio und Rechnungssteller).');
        if (!senderName.trim()) errors.push('Absender fehlt.');
        if (!recipientName.trim()) errors.push('Empfänger fehlt.');
        if (!invoiceDate || !parseLocalDate(invoiceDate)) errors.push('Rechnungsdatum fehlt.');
        if (!moveIn || !moveOut) errors.push('Bitte Anreise und Abreise angeben (Leistungszeitraum ist Pflichtangabe).');
        else if (nights <= 0) errors.push('Die Abreise muss nach der Anreise liegen.');
        if (positions.length === 0) errors.push('Mindestens eine Position ist erforderlich.');
        positions.forEach((p, i) => {
            if (!String(p.description || '').trim()) errors.push(`Position ${i + 1}: Bezeichnung fehlt.`);
            if (!smallBusiness && (p.vatRate === null || p.vatRate === undefined || p.vatRate === '')) errors.push(`Position ${i + 1}: Bitte einen Steuersatz wählen.`);
        });
        if (totalGross <= 0) errors.push('Der Rechnungsbetrag muss größer als 0 € sein.');
        return errors;
    };

    // ===== SAVE =====
    const handleSave = async () => {
        if (readOnly) return;
        const errors = validate();
        if (errors.length) {
            alert('Bitte prüfen Sie folgende Angaben:\n- ' + errors.join('\n- '));
            return;
        }
        if (!canWriteInvoices(senderPortfolioId || null)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        setSaving(true);
        try {
            const savePositions = buildPositionsForSave();
            const rates = [...new Set(savePositions.map(p => Number(p.vatRate)))];
            const payload = {
                portfolio_id: senderPortfolioId,
                property_id: selectedUnit?.property_id || null,
                contact_id: recipientContactId || null,
                unit_id: selectedUnitId || null,
                invoice_date: invoiceDate,
                sender_name: senderName,
                sender_street: senderStreet,
                sender_zip: senderZip,
                sender_city: senderCity,
                recipient_name: recipientName,
                recipient_street: recipientStreet,
                recipient_zip: recipientZip,
                recipient_city: recipientCity,
                move_in: moveIn || null,
                move_out: moveOut || null,
                nights: nights || null,
                persons: persons || 1,
                positions: savePositions,
                vat_rate: rates.length === 1 ? rates[0] : null,
                net_amount: totalNet,
                vat_amount: smallBusiness ? 0 : totalVat,
                gross_amount: totalGross
            };

            let result;
            if (isEdit) {
                // Status, Nummer und Besitzer bleiben unverändert; nur Entwürfe dürfen geändert werden
                const { data, error } = await supabase
                    .from('invoices')
                    .update(payload)
                    .eq('id', editId)
                    .eq('status', INVOICE_STATUS.DRAFT)
                    .select();
                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error('Die Rechnung ist nicht mehr im Entwurf (bereits ausgestellt) oder Sie haben keine Berechtigung. Änderungen wurden nicht gespeichert.');
                }
                result = data[0];
                setLoadedInvoice(result);
            } else {
                // Besitzer ist der Portfolio-Eigentümer (auch wenn ein freigegebenes Teammitglied die Rechnung anlegt)
                result = await insertInvoiceWithNumber({
                    ...payload,
                    user_id: senderPortfolio?.user_id || user.id,
                    status: INVOICE_STATUS.DRAFT
                });
                setInvoiceNumber(result.invoice_number || '');
            }
            setSavedInvoice(result);
            setSuccessModal(true);
        } catch (err) {
            alert('Fehler: ' + (err.message || 'Die Rechnung konnte nicht gespeichert werden.'));
        } finally { setSaving(false); }
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    if (loadError) {
        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: 'var(--spacing-lg)' }}>
                    <button onClick={() => navigate('/invoices')} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                        <ArrowLeft size={20} />
                    </button>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700 }}>{isEdit ? 'Rechnung' : 'Rechnung erstellen'}</h1>
                </div>
                <Card>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', color: 'var(--danger-color, #dc2626)', marginBottom: '1rem' }}>
                        <AlertTriangle size={20} style={{ flexShrink: 0 }} />
                        <div>{loadError}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <Button variant="secondary" onClick={() => navigate('/invoices')}>Zur Rechnungsliste</Button>
                        <Button onClick={() => setReloadKey(k => k + 1)}>Erneut laden</Button>
                    </div>
                </Card>
            </div>
        );
    }

    // Premium Styles
    const selectStyle = {
        width: '100%',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        fontSize: '0.9rem',
        outline: 'none',
        backgroundColor: 'var(--surface-color)'
    };

    const labelStyle = {
        display: 'block',
        marginBottom: '6px',
        fontWeight: 500,
        fontSize: '0.875rem',
        color: 'var(--text-primary)'
    };

    const sectionTitle = {
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        marginBottom: '1rem'
    };

    const noticeStyle = (tone) => ({
        display: 'flex', gap: '10px', alignItems: 'flex-start',
        padding: '12px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.875rem',
        marginBottom: 'var(--spacing-lg)',
        background: tone === 'warn' ? 'rgba(245,158,11,0.08)' : 'rgba(14,165,233,0.06)',
        border: `1px solid ${tone === 'warn' ? 'rgba(245,158,11,0.3)' : 'rgba(14,165,233,0.25)'}`,
        color: tone === 'warn' ? '#92400e' : 'var(--text-primary)'
    });

    const savedStatus = savedInvoice ? getInvoiceStatus(savedInvoice) : null;
    const headerSubtitle = isEdit
        ? `Rechnungs-Nr. ${invoiceNumber || '–'} · ${INVOICE_STATUS_LABELS[invoiceStatus] || invoiceStatus}`
        : 'Neue Rechnung – die fortlaufende Nummer wird beim Speichern vergeben';

    return (
        <div style={{ position: 'relative' }}>
            {saving && <LoadingOverlay message="Rechnung wird gespeichert..." />}
            {pdfGenerating && <LoadingOverlay message="PDF wird erstellt..." />}

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: 'var(--spacing-lg)' }}>
                <button onClick={() => navigate('/invoices')} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>
                        {!isEdit ? 'Rechnung erstellen' : (readOnly ? (invoiceStatus === INVOICE_STATUS.CREDIT_NOTE ? 'Gutschrift ansehen' : 'Rechnung ansehen') : 'Rechnung bearbeiten')}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{headerSubtitle}</p>
                </div>
            </div>

            {noWriteAccess && !lockedByStatus && (
                <div style={noticeStyle('info')}>
                    <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nur lesen – Freigabe ohne Schreibrecht „Finanzen“</div>
                        <div>
                            {isEdit
                                ? 'Diesen Entwurf können Sie ansehen und als Vorschau drucken, aber nicht ändern oder ausstellen.'
                                : 'In diesem Portfolio können Sie keine Rechnungen anlegen. Bitte wählen Sie oben ein Portfolio, für das Sie Schreibrecht „Finanzen“ haben.'}
                        </div>
                        {isEdit && loadedInvoice && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                                <Button variant="secondary" size="sm" icon={Printer} onClick={() => handlePrint(loadedInvoice)}>Vorschau drucken (Entwurf)</Button>
                                <Button variant="secondary" size="sm" icon={Download} onClick={() => handlePDF(loadedInvoice)}>Vorschau als PDF (Entwurf)</Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {lockedByStatus && (
                <div style={noticeStyle('info')}>
                    <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            {invoiceStatus === INVOICE_STATUS.CREDIT_NOTE ? 'Gutschrift – festgeschrieben' : `Diese Rechnung ist ${invoiceStatus === INVOICE_STATUS.CREDITED ? 'storniert' : 'ausgestellt'} und festgeschrieben.`}
                        </div>
                        <div>
                            Ausgestellte Belege können nicht mehr geändert werden.
                            {invoiceStatus === INVOICE_STATUS.ISSUED && !noWriteAccess && ' Korrekturen erfolgen über „Gutschrift / Storno erstellen" in der Rechnungsliste; danach kann eine neue Rechnung erstellt werden.'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <Button variant="secondary" size="sm" icon={Printer} onClick={() => handlePrint(loadedInvoice)}>Drucken</Button>
                            <Button variant="secondary" size="sm" icon={Download} onClick={() => handlePDF(loadedInvoice)}>PDF</Button>
                        </div>
                    </div>
                </div>
            )}

            {!readOnly && missingFields.length > 0 && (
                <div style={noticeStyle('warn')}>
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Für eine ordnungsgemäße Rechnung (§ 14 UStG) fehlen noch Angaben:</div>
                        <ul style={{ margin: '0 0 0 1.1rem', padding: 0 }}>
                            {missingFields.map(f => <li key={f}>{f}</li>)}
                        </ul>
                        <div style={{ marginTop: 4, fontSize: '0.8rem' }}>Fehlende Angaben werden im Dokument rot markiert. Daten des Portfolios (Steuernummer, Bankverbindung) pflegen Sie in den Portfolio-Einstellungen.</div>
                    </div>
                </div>
            )}

            <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                {/* Main Layout */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}>
                    {/* LEFT: Sender */}
                    <Card>
                        <div style={sectionTitle}>Rechnungssteller</div>
                        <Input label="Name" value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Name oder Firma" />
                        <Input label="Straße & Nr." value={senderStreet} onChange={e => setSenderStreet(e.target.value)} placeholder="Straße und Hausnummer" />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                            <Input label="PLZ" value={senderZip} onChange={e => setSenderZip(e.target.value)} placeholder="PLZ" />
                            <Input label="Ort" value={senderCity} onChange={e => setSenderCity(e.target.value)} placeholder="Ort" />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.875rem', cursor: readOnly ? 'default' : 'pointer', marginTop: '4px' }}>
                            <input
                                type="checkbox"
                                checked={smallBusiness}
                                onChange={e => applySmallBusiness(e.target.checked)}
                                style={{ marginTop: 3 }}
                            />
                            <span>
                                Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer ausweisen)
                                {smallBusiness && <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Hinweis im Dokument: „{SMALL_BUSINESS_NOTE}"</span>}
                            </span>
                        </label>
                        {canSavePortfolioFlag && (
                            <button
                                type="button"
                                onClick={savePortfolioFlag}
                                disabled={savingPortfolioFlag}
                                style={{ marginTop: '6px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary-color)', fontSize: '0.8rem', textDecoration: 'underline' }}
                            >
                                {savingPortfolioFlag ? 'Wird gespeichert…' : 'Als Standard für dieses Portfolio speichern'}
                            </button>
                        )}
                    </Card>

                    {/* RIGHT: Date / Number / Unit */}
                    <Card>
                        <div style={sectionTitle}>Rechnungsdetails</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Rechnungsdatum" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label style={labelStyle}>{isEdit ? 'Rechnungsnummer' : 'Rechnungsnummer (vorläufig)'}</label>
                                <input
                                    type="text"
                                    value={invoiceNumber}
                                    readOnly
                                    placeholder={isEdit ? '' : 'wird beim Speichern vergeben'}
                                    style={{ ...selectStyle, backgroundColor: 'var(--background-color)', cursor: 'not-allowed', color: '#6b7280' }}
                                />
                                {numberError && !isEdit && <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 4 }}>{numberError}</div>}
                            </div>
                        </div>
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label style={labelStyle}>Ferienwohnung</label>
                            <select style={selectStyle} value={selectedUnitId} onChange={e => { touchStay(); setSelectedUnitId(e.target.value); }}>
                                <option value="">– Bitte wählen –</option>
                                {vacationUnits.map(u => {
                                    const prop = properties.find(p => p.id === u.property_id);
                                    const addr = prop ? `${prop.street} ${prop.house_number || ''}, ${prop.zip || ''} ${prop.city || ''} ` : '';
                                    return <option key={u.id} value={u.id}>{u.unit_name} – {addr}</option>;
                                })}
                                {isEdit && selectedUnitId && !vacationUnits.find(u => u.id === selectedUnitId) && selectedUnit && (
                                    <option value={selectedUnitId}>{selectedUnit.unit_name}</option>
                                )}
                            </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Anreise" type="date" value={moveIn} onChange={e => { touchStay(); setMoveIn(e.target.value); }} />
                            <Input label="Abreise" type="date" value={moveOut} onChange={e => { touchStay(); setMoveOut(e.target.value); }} />
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label style={labelStyle}>Nächte</label>
                                <input type="text" value={nights} readOnly style={{ ...selectStyle, backgroundColor: 'var(--background-color)', cursor: 'not-allowed', textAlign: 'center', fontWeight: 600 }} />
                            </div>
                        </div>
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label style={labelStyle}>Anzahl Personen</label>
                            <select style={selectStyle} value={persons} onChange={e => { touchStay(); setPersons(parseInt(e.target.value, 10)); }}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                        </div>
                    </Card>
                </div>

                {/* Recipient */}
                <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={sectionTitle}>Rechnungsempfänger</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Button variant="secondary" size="sm" icon={Search} onClick={() => setContactPickerOpen(true)}>Aus Kontakten</Button>
                            <Button variant="secondary" size="sm" icon={UserPlus} onClick={saveAsContact}>Als Kontakt speichern</Button>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)' }}>
                        <div>
                            <Input label="Name / Firma" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Name des Empfängers" />
                            <Input label="Straße & Nr." value={recipientStreet} onChange={e => setRecipientStreet(e.target.value)} placeholder="Straße" />
                        </div>
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                                <Input label="PLZ" value={recipientZip} onChange={e => setRecipientZip(e.target.value)} placeholder="PLZ" />
                                <Input label="Ort" value={recipientCity} onChange={e => setRecipientCity(e.target.value)} placeholder="Ort" />
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Positions */}
                <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={sectionTitle}>Positionen</div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '50px' }}>Pos.</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Bezeichnung</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Preis/Nacht (€)</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Netto (€)</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '110px' }}>USt-Satz</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '90px' }}>USt (€)</th>
                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Brutto (€)</th>
                                    <th style={{ width: '40px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {positions.map((p, idx) => (
                                    <tr key={idx} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600 }}>{p.pos}</td>
                                        <td style={{ padding: '10px 8px', position: 'relative' }}>
                                            <textarea
                                                value={p.description}
                                                onChange={e => updatePosition(idx, 'description', e.target.value)}
                                                rows={2}
                                                onFocus={e => {
                                                    e.target.rows = 5;
                                                    e.target.style.position = 'absolute';
                                                    e.target.style.zIndex = '20';
                                                    e.target.style.width = 'calc(100% + 300px)';
                                                    e.target.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
                                                    e.target.style.borderColor = 'var(--primary-color)';
                                                }}
                                                onBlur={e => {
                                                    e.target.rows = 2;
                                                    e.target.style.position = 'static';
                                                    e.target.style.zIndex = 'auto';
                                                    e.target.style.width = '100%';
                                                    e.target.style.boxShadow = 'none';
                                                    e.target.style.borderColor = 'var(--border-color)';
                                                }}
                                                style={{
                                                    width: '100%', padding: '8px 10px', borderRadius: '8px',
                                                    border: '1px solid var(--border-color)', resize: 'vertical',
                                                    fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
                                                    backgroundColor: 'var(--surface-color)',
                                                    transition: 'all 0.2s ease',
                                                    left: 0, top: 0
                                                }}
                                            />
                                        </td>
                                        <td style={{ padding: '10px 8px' }}>
                                            {p.isFirst ? (
                                                <CurrencyInput
                                                    allowDecimals
                                                    value={p.pricePerNight}
                                                    onChange={e => updatePosition(idx, 'pricePerNight', e.target.value)}
                                                    style={{ ...selectStyle, textAlign: 'right' }}
                                                />
                                            ) : (
                                                <div style={{ color: 'var(--text-disabled)', textAlign: 'right', fontSize: '0.8rem' }}>–</div>
                                            )}
                                        </td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <CurrencyInput
                                                allowDecimals
                                                value={p.netTotal}
                                                onChange={e => updatePosition(idx, 'netTotal', e.target.value)}
                                                style={{ ...selectStyle, textAlign: 'right' }}
                                            />
                                        </td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <select
                                                value={smallBusiness ? '0' : (p.vatRate === null || p.vatRate === undefined ? '' : String(p.vatRate))}
                                                onChange={e => updatePosition(idx, 'vatRate', e.target.value)}
                                                disabled={smallBusiness}
                                                style={{ ...selectStyle, padding: '8px', textAlign: 'right', borderColor: (!smallBusiness && (p.vatRate === null || p.vatRate === undefined)) ? '#f59e0b' : 'var(--border-color)' }}
                                            >
                                                <option value="">– wählen –</option>
                                                {VAT_RATE_OPTIONS.map(rate => <option key={rate} value={String(rate)}>{fmtRate(rate)}</option>)}
                                            </select>
                                        </td>
                                        <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            {smallBusiness ? '–' : `${fmt(p.vat)} €`}
                                        </td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <CurrencyInput
                                                allowDecimals
                                                value={p.grossTotal}
                                                onChange={e => updatePosition(idx, 'grossTotal', e.target.value)}
                                                style={{ ...selectStyle, textAlign: 'right', fontWeight: 600 }}
                                            />
                                        </td>
                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                            {!p.isFirst && (
                                                <button onClick={() => removePosition(idx)} style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                    <td colSpan={3} style={{ padding: '10px 8px' }}>
                                        <Button variant="secondary" size="sm" icon={Plus} onClick={addPosition}>Position hinzufügen</Button>
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtEur(totalNet)}</td>
                                    <td></td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{smallBusiness ? '–' : fmtEur(totalVat)}</td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, fontSize: '1.05rem' }}>{fmtEur(totalGross)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    {hasZeroRateWithoutExemption && (
                        <div style={{ ...noticeStyle('warn'), marginTop: 'var(--spacing-md)', marginBottom: 0 }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>Positionen mit 0 % USt: Bitte den Grund der Steuerbefreiung in der Bezeichnung angeben (Pflichtangabe nach § 14 Abs. 4 Nr. 8 UStG).</div>
                        </div>
                    )}
                </Card>
            </fieldset>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-xl)' }}>
                <Card style={{ minWidth: '320px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {smallBusiness ? (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{SMALL_BUSINESS_NOTE}</div>
                        ) : (
                            <>
                                {taxBreakdown.length > 1 && taxBreakdown.map(g => (
                                    <div key={`net-${g.rate}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        <span>Netto zu {fmtRate(g.rate)}</span><span>{fmtEur(g.net)}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Summe Netto</span><span>{fmtEur(totalNet)}</span></div>
                                {taxBreakdown.filter(g => g.rate > 0).map(g => (
                                    <div key={`vat-${g.rate}`} style={{ display: 'flex', justifyContent: 'space-between' }}><span>USt {fmtRate(g.rate)}</span><span>{fmtEur(g.vat)}</span></div>
                                ))}
                            </>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700, borderTop: '2px solid var(--primary-color)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                            <span>{smallBusiness ? 'Gesamtbetrag' : 'Gesamtsumme Brutto'}</span><span>{fmtEur(totalGross)}</span>
                        </div>
                        {!readOnly && (
                            <>
                                <Button icon={Check} onClick={handleSave} disabled={saving} style={{ marginTop: '1rem', width: '100%', padding: '12px' }}>
                                    {isEdit ? 'ENTWURF SPEICHERN' : 'RECHNUNG SPEICHERN'}
                                </Button>
                                <Button variant="secondary" icon={Eye} onClick={handlePreview} style={{ width: '100%' }}>Vorschau (Entwurf)</Button>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    Die Rechnung wird als Entwurf gespeichert und kann bis zum Ausstellen geändert werden.
                                </div>
                            </>
                        )}
                    </div>
                </Card>
            </div>

            {/* Modals */}
            <Modal isOpen={successModal} onClose={() => navigate('/invoices')} title="Gespeichert">
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                    {savedStatus === INVOICE_STATUS.DRAFT ? (
                        <>
                            <p style={{ marginBottom: '0.75rem' }}>
                                Die Rechnung <strong>{savedInvoice?.invoice_number}</strong> wurde als <strong>Entwurf</strong> gespeichert.
                            </p>
                            <p style={{ marginBottom: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                Mit „Ausstellen" wird sie festgeschrieben und kann danach gedruckt und versendet werden. Änderungen sind dann nur noch per Gutschrift möglich.
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <Button variant="secondary" icon={Eye} onClick={() => handlePrint(savedInvoice)}>Vorschau</Button>
                                <Button icon={issuing ? Loader2 : Lock} onClick={handleIssue} disabled={issuing}>Ausstellen</Button>
                                <Button variant="secondary" onClick={() => navigate('/invoices')}>Schließen</Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p style={{ marginBottom: '1.5rem' }}>
                                Die Rechnung <strong>{savedInvoice?.invoice_number}</strong> ist ausgestellt.
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <Button variant="secondary" icon={Printer} onClick={() => handlePrint(savedInvoice)}>Drucken</Button>
                                <Button variant="secondary" icon={Download} onClick={() => handlePDF(savedInvoice)}>PDF</Button>
                                <Button onClick={() => navigate('/invoices')}>Schließen</Button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            <Modal isOpen={contactPickerOpen} onClose={() => setContactPickerOpen(false)} title="Kontakt wählen">
                <Input icon={Search} placeholder="Name suchen..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
                <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '1rem' }}>
                    {filteredContacts.map(c => (
                        <div key={c.id} onClick={() => selectContact(c)} style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                            <div style={{ fontWeight: 600 }}>{c.name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.street}, {c.zip} {c.city}</div>
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
};

export default InvoiceForm;
