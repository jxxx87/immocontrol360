import React, { useState, useEffect, useRef } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Save, Info, ChevronLeft, ChevronRight, Calculator, FileText } from 'lucide-react';
import { generateClientPdf } from '../../lib/pdfGenerator';
import { usePdfTemplate } from '../../lib/usePdfTemplate';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '../../context/ViewModeContext';
import { supabase } from '../../lib/supabase';

const statesTaxRef = [
    { name: 'Bayern', tax: 3.5 },
    { name: 'Hamburg', tax: 4.5 },
    { name: 'Baden-Württemberg', tax: 5.0 },
    { name: 'Bremen', tax: 5.0 },
    { name: 'Rheinland-Pfalz', tax: 5.0 },
    { name: 'Sachsen-Anhalt', tax: 5.0 },
    { name: 'Sachsen', tax: 5.5 },
    { name: 'Schleswig-Holstein', tax: 5.5 },
    { name: 'Berlin', tax: 6.0 },
    { name: 'Hessen', tax: 6.0 },
    { name: 'Mecklenburg-Vorpommern', tax: 6.0 },
    { name: 'Brandenburg', tax: 6.5 },
    { name: 'Nordrhein-Westfalen', tax: 6.5 },
    { name: 'Saarland', tax: 6.5 },
    { name: 'Niedersachsen', tax: 5.0 },
    { name: 'Thüringen', tax: 5.0 }
];

const formatCurrency = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
const formatCurrency2 = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 100);

const FixFlipCalculator = ({ initialData, onSave, onBack, isSaving, dealId }) => {
    const navigate = useNavigate();
    const [inputs, setInputs] = useState({
        purchasePrice: 0,
        size: 0,
        notaryPercent: 2,
        brokerPercent: 3.6,
        taxPercent: 5,
        financing: 0,
        interestRate: 5.5,
        duration: 8,
        houseMoney: 0,
        electricity: 0,
        heating: 0,
        renovation: 0,
        kitchen: 0,
        staging: 0,
        misc: 0,
        priceLowSqm: 3500,
        priceHighSqm: 3900,
        // Szenario: Verkauf als Kapitalanlage
        coldRentIst: 0,
        coldRentSoll: 0,
        targetYield: 5,
        name: 'Neuer Fix & Flip Deal',
        address: ''
    });

    const [results, setResults] = useState(null);
    const [negotiationTable, setNegotiationTable] = useState([]);
    const [showTaxInfo, setShowTaxInfo] = useState(false);
    const [flipStep, setFlipStep] = useState(0);
    const { isMobile } = useViewMode();
    const pdfTemplate = usePdfTemplate('deal_kalkulation');
    const flipStepLabels = ['Investition', 'Haltekosten', 'Aufbereitung', 'Verkauf', 'Ergebnis'];
    const flipStepCount = flipStepLabels.length;

    useEffect(() => {
        if (initialData) {
            setInputs(prev => ({ ...prev, ...initialData }));
        }
    }, [initialData]);

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
    useEffect(() => {
        calculate();
    }, [inputs]);

    const calculate = () => {
        const {
            purchasePrice, size, notaryPercent, brokerPercent, taxPercent,
            financing, interestRate, duration,
            houseMoney, electricity, heating,
            renovation, kitchen, staging, misc,
            priceLowSqm, priceHighSqm
        } = inputs;

        // 1. Kaufnebenkosten (ohne Finanzierung)
        const notary = purchasePrice * (notaryPercent / 100);
        const broker = purchasePrice * (brokerPercent / 100);
        const tax = purchasePrice * (taxPercent / 100);
        const sideCostsTotal = notary + broker + tax;

        // Gesamtsumme Ankauf (Kaufpreis + Nebenkosten, OHNE Finanzierung)
        const acquisitionTotal = purchasePrice + sideCostsTotal;

        // Finanzierungskosten (Zins auf Finanzierungsbetrag)
        const financingCosts = (financing * (interestRate / 100) / 12) * duration;

        // 2. Holding Costs
        const holdingTotal = (houseMoney + electricity + heating) * duration;

        // 3. Aufbereitung
        const prepTotal = renovation + kitchen + staging + misc;

        // 4. Gesamtinvestment (GIK)
        const totalInvest = acquisitionTotal + financingCosts + holdingTotal + prepTotal;

        // 5. Verkauf
        const sellPriceLow = size * priceLowSqm;
        const sellPriceHigh = size * priceHighSqm;

        const profitLow = sellPriceLow - totalInvest;
        const profitHigh = sellPriceHigh - totalInvest;

        const marginLow = sellPriceLow > 0 ? (profitLow / sellPriceLow) * 100 : 0;
        const marginHigh = sellPriceHigh > 0 ? (profitHigh / sellPriceHigh) * 100 : 0;

        const breakEven = size > 0 ? totalInvest / size : 0;

        // 6. Szenario: Verkauf als Kapitalanlage
        const { coldRentIst, coldRentSoll, targetYield } = inputs;
        const yieldDecimal = targetYield > 0 ? targetYield / 100 : 0;

        const kapSellIst = yieldDecimal > 0 ? (coldRentIst * 12) / yieldDecimal : 0;
        const kapSellSoll = yieldDecimal > 0 ? (coldRentSoll * 12) / yieldDecimal : 0;

        const kapSqmIst = size > 0 ? kapSellIst / size : 0;
        const kapSqmSoll = size > 0 ? kapSellSoll / size : 0;

        const kapProfitIst = kapSellIst - totalInvest;
        const kapProfitSoll = kapSellSoll - totalInvest;

        const kapMarginIst = kapSellIst > 0 ? (kapProfitIst / kapSellIst) * 100 : 0;
        const kapMarginSoll = kapSellSoll > 0 ? (kapProfitSoll / kapSellSoll) * 100 : 0;

        setResults({
            acquisitionTotal,
            sideCostsTotal,
            notary, broker, tax, financingCosts,
            holdingTotal,
            prepTotal,
            totalInvest,
            sellPriceLow, sellPriceHigh,
            profitLow, profitHigh,
            marginLow, marginHigh,
            breakEven,
            // Kapitalanlage
            kapSellIst, kapSellSoll,
            kapSqmIst, kapSqmSoll,
            kapProfitIst, kapProfitSoll,
            kapMarginIst, kapMarginSoll
        });

        // Ankaufs-Matrix
        const steps = [5, 10, 15, 20, 25, 30];
        const table = steps.map(discount => {
            const discountedPrice = purchasePrice * (1 - discount / 100);
            const d_notary = discountedPrice * (notaryPercent / 100);
            const d_broker = discountedPrice * (brokerPercent / 100);
            const d_tax = discountedPrice * (taxPercent / 100);

            // GIK ohne Finanzierung/Zins
            const d_gik = discountedPrice + d_notary + d_broker + d_tax + holdingTotal + prepTotal;

            const d_totalInvest = d_gik + financingCosts;
            const d_profitLow = sellPriceLow - d_totalInvest;
            const d_marginLow = sellPriceLow > 0 ? (d_profitLow / sellPriceLow) * 100 : 0;

            const d_profitHigh = sellPriceHigh - d_totalInvest;
            const d_marginHigh = sellPriceHigh > 0 ? (d_profitHigh / sellPriceHigh) * 100 : 0;

            return {
                discount,
                gik: d_gik,
                profitLow: d_profitLow,
                marginLow: d_marginLow,
                profitHigh: d_profitHigh,
                marginHigh: d_marginHigh
            };
        });
        setNegotiationTable(table);
    };

    const getBadge = (margin, profit) => {
        if (margin >= 20 && profit >= 50000) return <span style={{ backgroundColor: 'var(--success-color)', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>EXZELLENT</span>;
        if ((margin >= 15 && margin < 20) || (profit >= 25000 && profit < 50000)) return <span style={{ backgroundColor: 'var(--warning-color)', color: '#000', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>GUT</span>;
        return <span style={{ backgroundColor: 'var(--danger-color)', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>RISIKO</span>;
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

    if (!results) return null;

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
                <Button icon={Save} onClick={() => onSave(inputs, results)} disabled={isSaving}>
                    {isSaving ? 'Speichert...' : 'Aktualisieren'}
                </Button>
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
                                                {statesTaxRef.map(s => (
                                                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                                        <span>{s.name}</span><span style={{ fontWeight: 600 }}>{s.tax} %</span>
                                                    </div>
                                                ))}
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
                                        <Calculator
                                            size={15}
                                            style={{ color: '#f97316', cursor: 'pointer', flexShrink: 0 }}
                                            title="Sanierungsrechner öffnen"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                const currentName = encodeURIComponent(inputs.name || 'Fix & Flip Deal');
                                                if (dealId) {
                                                    const ret = encodeURIComponent(`/investor-portal?tab=audit&dealId=${dealId}`);
                                                    const { data } = await supabase
                                                        .from('renovation_calculations')
                                                        .select('id')
                                                        .contains('building_config', { dealId })
                                                        .limit(1);
                                                    if (data && data.length > 0) {
                                                        navigate(`/renovation/calculator/${data[0].id}?returnTo=${ret}`);
                                                    } else {
                                                        navigate(`/renovation/calculator/new?dealId=${dealId}&dealName=${currentName}&returnTo=${ret}`);
                                                    }
                                                } else {
                                                    const ret = encodeURIComponent('/investor-portal?tab=audit');
                                                    navigate(`/renovation/calculator/new?dealName=${currentName}&returnTo=${ret}`);
                                                }
                                            }}
                                        />
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
                                <th style={{ padding: '10px', textAlign: 'right' }}>GIK</th>
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

    useEffect(() => {
        if (!editing) setRaw(String(value));
    }, [value, editing]);

    const displayValue = editing ? raw : new Intl.NumberFormat('de-DE').format(value);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type={editing ? 'number' : 'text'}
                value={displayValue}
                min="0"
                onFocus={e => {
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
