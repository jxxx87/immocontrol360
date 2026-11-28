import React, { useState, useMemo, useRef, useEffect } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Save, Info, ChevronLeft, ChevronRight, Calculator, FileText, Trash2, Loader2, Lock } from 'lucide-react';
import { generateClientPdf } from '../../lib/pdfGenerator';
import { usePdfTemplate } from '../../lib/usePdfTemplate';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '../../context/ViewModeContext';
import { supabase } from '../../lib/supabase';
import { translateError } from '../../lib/errorTranslator';
import { TRANSFER_TAX_RATES, TRANSFER_TAX_RATES_AS_OF } from './transferTaxRates';
// Rechenlogik gemeinsam mit dem Deal-Ranking im Investorportal
import { buildFixFlipInputs, sanitizeInitialData, computeFixFlip } from './fixFlipCalc';

const formatCurrency = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
const formatCurrency2 = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 100);

/* ─── Bewertung: monoton – mehr Marge und mehr Gewinn verschlechtern die Einstufung nie ─── */
const getBadge = (margin, profit) => {
    if (margin >= 20 && profit >= 50000) return <span style={{ backgroundColor: 'var(--success-color)', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>EXZELLENT</span>;
    if (margin >= 15 && profit >= 25000) return <span style={{ backgroundColor: 'var(--warning-color)', color: '#000', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>GUT</span>;
    return <span style={{ backgroundColor: 'var(--danger-color)', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>RISIKO</span>;
};

// onLeave(pfad): Navigation ohne Rückfrage (nach dem Speichern bzw. nach eigener Bestätigung);
// onDirtyChange(bool): meldet ungespeicherte Eingaben an das Investorportal (Rückfrage beim Verlassen);
// readOnly: Lesemodus ohne Schreibrecht – rechnen ja, speichern/löschen nein
const FixFlipCalculator = ({ initialData, onSave, onBack, onLeave, onDelete, onDirtyChange, readOnly = false, isSaving, dealId }) => {
    const navigate = useNavigate();
    const leave = (to) => (onLeave ? onLeave(to) : navigate(to));

    // Geladene Deal-Daten nur übernehmen, wenn sich ihr INHALT ändert (neuer/anderer Deal) –
    // nicht bei jedem Neu-Rendern des Elternteils mit einem neu erzeugten, gleichen Objekt.
    const initialKey = JSON.stringify(initialData || null);
    const [inputs, setInputs] = useState(() => buildFixFlipInputs(initialData));
    // Zuletzt geladener bzw. gespeicherter Stand (Vergleich für „ungespeicherte Eingaben“)
    const [savedKey, setSavedKey] = useState(() => JSON.stringify(buildFixFlipInputs(initialData)));
    const [appliedKey, setAppliedKey] = useState(initialKey);
    if (appliedKey !== initialKey) {
        setAppliedKey(initialKey);
        if (initialData) {
            const next = { ...inputs, ...sanitizeInitialData(initialData) };
            setInputs(next);
            setSavedKey(JSON.stringify(next));
        }
    }
    const dirty = !readOnly && JSON.stringify(inputs) !== savedKey;
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    // Beim Aushängen (Tab-/Seitenwechsel) gibt es nichts mehr zu schützen
    useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

    const [showTaxInfo, setShowTaxInfo] = useState(false);
    const [flipStep, setFlipStep] = useState(0);
    const [openingRenovation, setOpeningRenovation] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const { isMobile } = useViewMode();
    const pdfTemplate = usePdfTemplate('deal_kalkulation');
    const flipStepLabels = ['Investition', 'Haltekosten', 'Aufbereitung', 'Verkauf', 'Ergebnis'];
    const flipStepCount = flipStepLabels.length;

    const handleChange = (field, value, isPercent = false) => {
        const val = parseFloat(value);
        if (isNaN(val)) {
            setInputs(prev => ({ ...prev, [field]: 0 }));
            return;
        }
        const clamped = isPercent ? Math.min(999, Math.max(0, val)) : Math.max(0, val);
        setInputs(prev => ({ ...prev, [field]: clamped }));
    };

    const handleTextChange = (field, value) => {
        setInputs(prev => ({ ...prev, [field]: value }));
    };

    // Calculation Logic
    const { results, negotiationTable } = useMemo(() => computeFixFlip(inputs), [inputs]);

    /* ─── Sprung in den Sanierungsrechner ───
       Mit verknüpftem Deal: vorher speichern (keine Eingaben gehen verloren, die Sanierungssumme
       wird in den aktuellen Stand zurückgeschrieben) und die vorhandene Kalkulation öffnen.
       Ohne Deal-ID: Hinweis, dass ungespeicherte Eingaben verloren gehen und die Summe nicht
       automatisch übernommen wird. */
    const openRenovationCalculator = async () => {
        if (openingRenovation) return;
        const currentName = encodeURIComponent(inputs.name || 'Fix & Flip Deal');

        if (!dealId) {
            const proceed = window.confirm(
                'Dieser Deal ist nicht mit dem Sanierungsrechner verknüpft.\n\n'
                + 'Nicht gespeicherte Eingaben gehen beim Wechsel verloren, und die ermittelte Sanierungssumme '
                + 'muss anschließend von Hand in das Feld „Sanierung/Renovierung" übertragen werden. '
                + 'Sichern Sie Ihre Eingaben vorher über „Aktualisieren".\n\n'
                + 'Trotzdem zum Sanierungsrechner wechseln?'
            );
            if (!proceed) return;
            const ret = encodeURIComponent('/investor-portal?tab=deals');
            // Verlassen wurde eben bestätigt – keine zweite Rückfrage
            leave(`/renovation/calculator/new?dealName=${currentName}&returnTo=${ret}`);
            return;
        }

        setOpeningRenovation(true);
        try {
            if (onSave) {
                const savedInputsKey = JSON.stringify(inputs);
                const saved = await onSave(inputs, results, { skipNavigate: true });
                if (saved === false) return;
                setSavedKey(savedInputsKey);
            }
            const ret = encodeURIComponent(`/investor-portal?tab=audit&dealId=${dealId}`);
            const { data, error } = await supabase
                .from('renovation_calculations')
                .select('id')
                .contains('building_config', { dealId })
                .limit(1);
            if (error) throw error;
            // Gerade gespeichert – ohne erneute Rückfrage wechseln
            if (data && data.length > 0) {
                leave(`/renovation/calculator/${data[0].id}?returnTo=${ret}`);
            } else {
                leave(`/renovation/calculator/new?dealId=${dealId}&dealName=${currentName}&returnTo=${ret}`);
            }
        } catch (err) {
            console.error('Open renovation calculator error:', err);
            alert('Sanierungsrechner konnte nicht geöffnet werden: ' + translateError(err));
        } finally {
            setOpeningRenovation(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete || deleting) return;
        setDeleting(true);
        try {
            const deleted = await onDelete();
            // Nur wenn das Elternteil das Löschen ausdrücklich bestätigt, zur Übersicht wechseln
            // (der Deal ist weg – keine Rückfrage wegen ungespeicherter Eingaben)
            if (deleted === true) {
                if (onLeave) onLeave('/investor-portal?tab=deals');
                else if (onBack) onBack();
            }
        } finally {
            setDeleting(false);
        }
    };

    // Speichern; den Vergleichsstand nur bei Erfolg auf die gespeicherten Eingaben setzen
    const handleSave = async () => {
        if (!onSave || readOnly) return;
        const savedInputsKey = JSON.stringify(inputs);
        const saved = await onSave(inputs, results);
        if (saved === true) setSavedKey(savedInputsKey);
    };

    // Print as PDF
    const handlePrint = () => {
        if (!results) return;
        const i = inputs;
        const r = results;
        const fc = v => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
        const pdfData = [
            { position: 'Kaufpreis', wert: fc(i.purchasePrice) },
            { position: 'Grunderwerbsteuer', wert: fc(r.tax) },
            { position: 'Notar', wert: fc(r.notary) },
            { position: 'Makler', wert: fc(r.broker) },
            { position: 'Kaufnebenkosten', wert: fc(r.sideCostsTotal) },
            { position: 'Gesamtankauf', wert: fc(r.acquisitionTotal) },
            { position: '─', wert: '' },
            { position: 'Finanzierung', wert: fc(i.financing) },
            { position: 'Finanzierungskosten', wert: fc(r.financingCosts) },
            { position: 'Haltekosten (' + i.duration + ' Mo.)', wert: fc(r.holdingTotal) },
            { position: '─', wert: '' },
            { position: 'Sanierung', wert: fc(i.renovation) },
            { position: 'Küche', wert: fc(i.kitchen) },
            { position: 'Staging', wert: fc(i.staging) },
            { position: 'Sonstiges', wert: fc(i.misc) },
            { position: 'Aufbereitung gesamt', wert: fc(r.prepTotal) },
            { position: '─', wert: '' },
            { position: 'Gesamtinvestition (GIK)', wert: fc(r.totalInvest) },
            { position: '─', wert: '' },
            { position: 'Verkaufspreis (Low)', wert: fc(r.sellPriceLow) },
            { position: 'Gewinn (Low)', wert: fc(r.profitLow) },
            { position: 'Marge (Low)', wert: r.marginLow.toFixed(1) + ' %' },
            { position: '─', wert: '' },
            { position: 'Verkaufspreis (High)', wert: fc(r.sellPriceHigh) },
            { position: 'Gewinn (High)', wert: fc(r.profitHigh) },
            { position: 'Marge (High)', wert: r.marginHigh.toFixed(1) + ' %' },
            { position: '─', wert: '' },
            { position: 'Break-Even €/m²', wert: r.breakEven.toFixed(2) + ' €' },
        ];
        generateClientPdf({
            reportType: 'deal_kalkulation',
            data: pdfData,
            selectedColumns: ['position', 'wert'],
            showSums: false,
            portfolioName: i.name || 'Fix & Flip Deal',
            propertyName: i.address || '',
            template: pdfTemplate,
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    onClick={onBack}>
                    ← Zur Übersicht
                </span>
                <div style={{ flex: 1 }} />
                <input
                    value={inputs.name}
                    onChange={e => handleTextChange('name', e.target.value)}
                    placeholder="Deal-Name eingeben..."
                    style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600, minWidth: isMobile ? '120px' : '200px', flex: isMobile ? 1 : undefined }}
                />
                <input
                    value={inputs.address || ''}
                    onChange={e => handleTextChange('address', e.target.value)}
                    placeholder="Adresse eingeben..."
                    style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.85rem', minWidth: isMobile ? '120px' : '200px', flex: isMobile ? 1 : undefined }}
                />
                <Button variant="secondary" icon={FileText} onClick={handlePrint}>
                    PDF
                </Button>
                {onDelete && !readOnly && (
                    <Button variant="secondary" icon={deleting ? Loader2 : Trash2} onClick={handleDelete} disabled={deleting || isSaving} title="Deal löschen">
                        Löschen
                    </Button>
                )}
                {readOnly ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }} title="Für dieses Portfolio haben Sie im Investorportal kein Schreibrecht – Eingaben werden nicht gespeichert.">
                        <Lock size={14} /> Nur Lesezugriff
                    </span>
                ) : (
                    <Button icon={Save} onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Speichert...' : 'Aktualisieren'}
                    </Button>
                )}
            </div>

            {/* Mobile Stepper Progress */}
            {isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 4px' }}>
                    {flipStepLabels.map((label, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setFlipStep(i)}>
                            <div style={{
                                height: '3px', width: '100%', borderRadius: '2px',
                                backgroundColor: i <= flipStep ? 'var(--primary-color)' : 'var(--border-color)',
                                transition: 'background-color 0.3s'
                            }} />
                            <span style={{ fontSize: '0.6rem', color: i === flipStep ? 'var(--primary-color)' : 'var(--text-secondary)', fontWeight: i === flipStep ? 700 : 400 }}>
                                {label}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 'var(--spacing-xl)' }}>

                {/* LEFT: Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {(!isMobile || flipStep === 0) && <Card title="1. Investition & Finanzierung">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            <CurrencyField label="Kaufpreis (€)" value={inputs.purchasePrice} onChange={v => handleChange('purchasePrice', v)} />
                            <NumberField label="Wohnfläche (m²)" value={inputs.size} onChange={v => handleChange('size', v)} step="0.1" />
                            <PercentField label="Notar / Grundbuch (%)" value={inputs.notaryPercent} onChange={v => handleChange('notaryPercent', v, true)} />
                            <PercentField label="Makler (%)" value={inputs.brokerPercent} onChange={v => handleChange('brokerPercent', v, true)} />

                            {/* Grunderwerbsteuer mit Info-Tooltip */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Grunderwerbsteuer (%)</label>
                                    <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <Info size={14} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                                            onMouseEnter={() => setShowTaxInfo(true)}
                                            onMouseLeave={() => setShowTaxInfo(false)}
                                        />
                                        {showTaxInfo && (
                                            <div style={{
                                                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                                backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                borderRadius: '8px', padding: '12px', minWidth: '250px', zIndex: 100,
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)', fontSize: '0.75rem', marginBottom: '4px'
                                            }}>
                                                <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '0.8rem' }}>Grunderwerbsteuer je Bundesland</div>
                                                {TRANSFER_TAX_RATES.map(s => (
                                                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                                        <span>{s.name}</span><span style={{ fontWeight: 600 }}>{s.tax.toLocaleString('de-DE', { minimumFractionDigits: 1 })} %</span>
                                                    </div>
                                                ))}
                                                <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                                                    Stand: {TRANSFER_TAX_RATES_AS_OF} – ohne Gewähr, aktuellen Satz des Bundeslandes prüfen.
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <input
                                    type="number" step="0.1" min="0" max="999"
                                    value={inputs.taxPercent}
                                    onChange={e => handleChange('taxPercent', e.target.value, true)}
                                    onFocus={e => e.target.select()}
                                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)', width: '100%' }}
                                />
                            </div>

                            <CurrencyField label="Finanzierung (€)" value={inputs.financing} onChange={v => handleChange('financing', v)} />
                            <PercentField label="Zins p.a. (%)" value={inputs.interestRate} onChange={v => handleChange('interestRate', v, true)} />
                            <NumberField label="Projektdauer (Monate)" value={inputs.duration} onChange={v => handleChange('duration', v)} step="1" />
                        </div>

                        {/* Gesamtsumme Ankauf – exakt wie Buy & Hold */}
                        <div style={{ marginTop: '1.25rem', padding: '12px 16px', backgroundColor: 'var(--background-color)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                <span>Kaufpreis</span>
                                <span style={{ fontWeight: 600 }}>{formatCurrency(inputs.purchasePrice)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                <span>Kaufnebenkosten</span>
                                <span style={{ fontWeight: 600 }}>{formatCurrency(results.sideCostsTotal)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Gesamtinvestition inkl. KNK</span>
                                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary-color)' }}>{formatCurrency(results.acquisitionTotal)}</span>
                            </div>
                        </div>
                    </Card>}

                    {(!isMobile || flipStep === 1) && <Card title="2. Haltekosten">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '1rem' }}>
                            <CurrencyField label="Hausgeld" value={inputs.houseMoney} onChange={v => handleChange('houseMoney', v)} />
                            <CurrencyField label="Strom" value={inputs.electricity} onChange={v => handleChange('electricity', v)} />
                            <CurrencyField label="Heizung" value={inputs.heating} onChange={v => handleChange('heating', v)} />
                        </div>
                        <div style={{ marginTop: '1.25rem', padding: '12px 16px', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Haltekosten gesamt</span>
                            <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary-color)' }}>{formatCurrency(results.holdingTotal)}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', textAlign: 'right' }}>
                            ({inputs.duration} Monate × {formatCurrency(inputs.houseMoney + inputs.electricity + inputs.heating)}/Monat)
                        </div>
                    </Card>}

                    {(!isMobile || flipStep === 2) && <Card title="3. Aufbereitung">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            <CurrencyField
                                label={
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        Sanierung/Renovierung
                                        {readOnly ? null : openingRenovation ? (
                                            <Loader2 size={15} className="animate-spin" style={{ color: '#f97316', flexShrink: 0 }} />
                                        ) : (
                                            <Calculator
                                                size={15}
                                                style={{ color: '#f97316', cursor: 'pointer', flexShrink: 0 }}
                                                title="Sanierungsrechner öffnen"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openRenovationCalculator();
                                                }}
                                            />
                                        )}
                                    </span>
                                }
                                value={inputs.renovation} onChange={v => handleChange('renovation', v)}
                            />
                            <CurrencyField label="Küche" value={inputs.kitchen} onChange={v => handleChange('kitchen', v)} />
                            <CurrencyField label="Homestaging" value={inputs.staging} onChange={v => handleChange('staging', v)} />
                            <CurrencyField label="Sonstiges" value={inputs.misc} onChange={v => handleChange('misc', v)} />
                        </div>
                        <div style={{ marginTop: '1.25rem', padding: '12px 16px', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Aufbereitung gesamt</span>
                            <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary-color)' }}>{formatCurrency(results.prepTotal)}</span>
                        </div>
                    </Card>}

                    {(!isMobile || flipStep === 3) && <Card title="4. Verkaufsschätzung">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            <CurrencyField label="Preis Niedrig (€/m²)" value={inputs.priceLowSqm} onChange={v => handleChange('priceLowSqm', v)} />
                            <CurrencyField label="Preis Hoch (€/m²)" value={inputs.priceHighSqm} onChange={v => handleChange('priceHighSqm', v)} />
                        </div>
                    </Card>}

                    {/* Mobile: Nav Buttons */}
                    {isMobile && flipStep < 4 && (
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
                            <Button variant="secondary" icon={ChevronLeft} onClick={() => setFlipStep(Math.max(0, flipStep - 1))} disabled={flipStep === 0} style={{ flex: 1, opacity: flipStep === 0 ? 0.4 : 1 }}>
                                Zurück
                            </Button>
                            <Button icon={ChevronRight} onClick={() => setFlipStep(Math.min(flipStepCount - 1, flipStep + 1))} style={{ flex: 1 }}>
                                {flipStep === 3 ? 'Ergebnis' : 'Weiter'}
                            </Button>
                        </div>
                    )}
                </div>

                {/* RIGHT: Results */}
                <div style={{ display: (!isMobile || flipStep === 4) ? 'flex' : 'none', flexDirection: 'column', gap: '1.5rem' }}>
                    <Card title="Ergebnis & KPIs">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Bewertung (Hoch):</span>
                            {getBadge(results.marginHigh, results.profitHigh)}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <ResultBox label="Gesamtinvestment (GIK)" value={formatCurrency(results.totalInvest)} color="var(--text-primary)" />
                            <ResultBox label="Break-Even / m²" value={formatCurrency2(results.breakEven)} color="var(--warning-color)" />
                        </div>

                        <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
                            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Szenario NIEDRIG ({formatCurrency(inputs.priceLowSqm)}/m²)</h4>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                                <span>Gewinn</span>
                                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: results.profitLow >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>{formatCurrency(results.profitLow)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span>Marge</span>
                                <span style={{ fontWeight: 600 }}>{formatPercent(results.marginLow)}</span>
                            </div>
                        </div>

                        <div style={{ padding: '1rem', backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                            <h4 style={{ fontSize: '0.9rem', color: 'var(--primary-color)', marginBottom: '0.5rem' }}>Szenario HOCH ({formatCurrency(inputs.priceHighSqm)}/m²)</h4>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                                <span>Gewinn</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: results.profitHigh >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>{formatCurrency(results.profitHigh)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span>Marge</span>
                                <span style={{ fontWeight: 600 }}>{formatPercent(results.marginHigh)}</span>
                            </div>
                        </div>

                        <div style={{ marginTop: '1.5rem' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Kostenstruktur</h4>
                            <CostLine label="Ankaufspreis" value={inputs.purchasePrice} />
                            <CostLine label="Kaufnebenkosten" value={results.sideCostsTotal} sub={`~${(inputs.notaryPercent + inputs.brokerPercent + inputs.taxPercent).toFixed(1)}%`} />
                            <CostLine label="Finanzierungskosten" value={results.financingCosts} />
                            <CostLine label="Haltekosten" value={results.holdingTotal} />
                            <CostLine label="Aufbereitung" value={results.prepTotal} />
                            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '0.5rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                <span>Summe (= GIK)</span>
                                <span>{formatCurrency(results.totalInvest)}</span>
                            </div>
                        </div>
                    </Card>

                    {/* Szenario: Verkauf als Kapitalanlage */}
                    <Card title="Szenario – Verkauf als Kapitalanlage">
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                            Berechne den Verkaufspreis basierend auf der Mietrendite für einen Kapitalanleger.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            {/* IST */}
                            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase' }}>IST-Situation</h4>
                                <CurrencyField label="Kaltmiete IST (€/Mo.)" value={inputs.coldRentIst} onChange={v => handleChange('coldRentIst', v)} />
                            </div>

                            {/* SOLL */}
                            <div style={{ padding: '1rem', backgroundColor: 'rgba(59,130,246,0.04)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.15)' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#3B82F6', marginBottom: '1rem', textTransform: 'uppercase' }}>SOLL-Potenzial</h4>
                                <CurrencyField label="Kaltmiete SOLL (€/Mo.)" value={inputs.coldRentSoll} onChange={v => handleChange('coldRentSoll', v)} />
                            </div>
                        </div>

                        <div style={{ marginTop: '1rem' }}>
                            <PercentField label="Ziel Brutto-Rendite (%)" value={inputs.targetYield} onChange={v => handleChange('targetYield', v, true)} />
                        </div>

                        {/* Ergebnisse */}
                        <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            {/* IST Ergebnis */}
                            <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Ergebnis IST</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>Verkaufspreis</span>
                                    <span style={{ fontWeight: 700 }}>{inputs.coldRentIst > 0 ? formatCurrency(results.kapSellIst) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>€/m²</span>
                                    <span style={{ fontWeight: 600 }}>{inputs.coldRentIst > 0 ? formatCurrency2(results.kapSqmIst) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>Gewinn</span>
                                    <span style={{ fontWeight: 800, color: inputs.coldRentIst > 0 ? (results.kapProfitIst >= 0 ? 'var(--success-color)' : 'var(--danger-color)') : 'var(--text-secondary)' }}>{inputs.coldRentIst > 0 ? formatCurrency(results.kapProfitIst) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span>Marge</span>
                                    <span style={{ fontWeight: 600 }}>{inputs.coldRentIst > 0 ? formatPercent(results.kapMarginIst) : '–'}</span>
                                </div>
                            </div>

                            {/* SOLL Ergebnis */}
                            <div style={{ padding: '1rem', backgroundColor: 'rgba(59,130,246,0.04)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.15)' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Ergebnis SOLL</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>Verkaufspreis</span>
                                    <span style={{ fontWeight: 700 }}>{inputs.coldRentSoll > 0 ? formatCurrency(results.kapSellSoll) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>€/m²</span>
                                    <span style={{ fontWeight: 600 }}>{inputs.coldRentSoll > 0 ? formatCurrency2(results.kapSqmSoll) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                                    <span>Gewinn</span>
                                    <span style={{ fontWeight: 800, color: inputs.coldRentSoll > 0 ? (results.kapProfitSoll >= 0 ? 'var(--success-color)' : 'var(--danger-color)') : 'var(--text-secondary)' }}>{inputs.coldRentSoll > 0 ? formatCurrency(results.kapProfitSoll) : '–'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span>Marge</span>
                                    <span style={{ fontWeight: 600, color: inputs.coldRentSoll > 0 ? '#3B82F6' : 'var(--text-secondary)' }}>{inputs.coldRentSoll > 0 ? formatPercent(results.kapMarginSoll) : '–'}</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                    {isMobile && flipStep === 4 && (
                        <Button variant="secondary" icon={ChevronLeft} onClick={() => setFlipStep(0)} style={{ marginTop: '8px' }}>
                            Zurück zum Rechner
                        </Button>
                    )}
                </div>
            </div>

            {/* Ankaufs-Matrix */}
            <Card title="Ankaufs-Matrix">
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '10px', textAlign: 'left' }}>Verhandlung</th>
                                <th style={{ padding: '10px', textAlign: 'right' }} title="Gesamtinvestment inkl. Finanzierungskosten (wie im Ergebnis)">GIK</th>
                                <th style={{ padding: '10px', textAlign: 'right' }}>Gewinn (Low)</th>
                                <th style={{ padding: '10px', textAlign: 'right' }}>Marge (Low)</th>
                                <th style={{ padding: '10px', textAlign: 'right' }}>Gewinn (High)</th>
                                <th style={{ padding: '10px', textAlign: 'right' }}>Marge (High)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {negotiationTable.map(row => (
                                <tr key={row.discount} className="table-row">
                                    <td style={{ padding: '10px', fontWeight: 600 }}>-{row.discount}%</td>
                                    <td style={{ padding: '10px', textAlign: 'right' }}>{formatCurrency(row.gik)}</td>
                                    <td style={{ padding: '10px', textAlign: 'right', color: row.profitLow > 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>{formatCurrency(row.profitLow)}</td>
                                    <td style={{ padding: '10px', textAlign: 'right' }}>{formatPercent(row.marginLow)}</td>
                                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: row.profitHigh > 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>{formatCurrency(row.profitHigh)}</td>
                                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{formatPercent(row.marginHigh)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

// ─── HELPER COMPONENTS ──────────────────────────────────────────────

const inputStyle = {
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text-primary)',
    width: '100%'
};

/** Currency field – shows formatted value on blur, raw on focus */
const CurrencyField = ({ label, value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState(String(value));
    const inputRef = useRef(null);

    // Rohtext nur während der Eingabe; beim Fokussieren aus dem aktuellen Wert übernommen
    const displayValue = editing ? raw : new Intl.NumberFormat('de-DE').format(value);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type={editing ? 'number' : 'text'}
                value={displayValue}
                min="0"
                onFocus={() => {
                    setEditing(true);
                    setRaw(String(value));
                    setTimeout(() => {
                        if (inputRef.current) inputRef.current.select();
                    }, 0);
                }}
                onBlur={() => setEditing(false)}
                onChange={e => {
                    setRaw(e.target.value);
                    onChange(e.target.value);
                }}
                style={inputStyle}
            />
        </div>
    );
};

/** Number field (m², Monate etc.) */
const NumberField = ({ label, value, onChange, step = '1' }) => {
    const inputRef = useRef(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type="number"
                value={value}
                step={step}
                min="0"
                onFocus={() => { if (inputRef.current) inputRef.current.select(); }}
                onChange={e => onChange(e.target.value)}
                style={inputStyle}
            />
        </div>
    );
};

/** Percent field – max 999 */
const PercentField = ({ label, value, onChange }) => {
    const inputRef = useRef(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type="number"
                value={value}
                step="0.1"
                min="0"
                max="999"
                onFocus={() => { if (inputRef.current) inputRef.current.select(); }}
                onChange={e => onChange(e.target.value)}
                style={inputStyle}
            />
        </div>
    );
};

const ResultBox = ({ label, value, color }) => (
    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', backgroundColor: 'var(--background-color)' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color }}>{value}</div>
    </div>
);

const CostLine = ({ label, value, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
        <span>{label} {sub && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({sub})</span>}</span>
        <span>{formatCurrency(value)}</span>
    </div>
);

export default FixFlipCalculator;
