import React, { useState, useRef } from 'react';
import Card from '../../components/ui/Card';
import { RefreshCw, TrendingUp, Calculator, Info, AlertTriangle } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';
import {
    round2, toNumber, nonNegative, todayStr, todayPlusYearsStr, yearsBetween, addMonthsToDate,
    formatDateDE, computeRestschuld, monthsToAmortize, fullAmortizationYears, recommendedRepayment,
    getCurrentLease, getUnitCurrentRent,
} from './calcHelpers';

const formatCurrency = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
const formatCurrency2 = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 100);

const formatYearsAndMonths = (yearsDecimal) => {
    if (yearsDecimal <= 0) return '0 Monaten';
    const totalMonths = Math.round(yearsDecimal * 12);
    const yrs = Math.floor(totalMonths / 12);
    const mos = totalMonths % 12;

    const parts = [];
    if (yrs > 0) {
        parts.push(yrs === 1 ? '1 Jahr' : `${yrs} Jahren`);
    }
    if (mos > 0) {
        parts.push(mos === 1 ? '1 Monat' : `${mos} Monaten`);
    }
    return parts.join(' und ');
};

// Demo-Werte nur für die freie Berechnung (ohne geladenes Objekt)
const FREE_RENT_DEFAULTS = { size: 80, currentRent: 600, marketValue: 180000 };

// Kappungsgrenzen § 558 Abs. 3 BGB (innerhalb von drei Jahren)
const RENT_CAP_GENERAL = 20;
const RENT_CAP_REDUCED = 15;

const hintBoxStyle = (tone) => ({
    display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '8px', fontSize: '0.78rem', lineHeight: 1.45,
    ...(tone === 'danger'
        ? { backgroundColor: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#b91c1c' }
        : tone === 'warning'
            ? { backgroundColor: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.3)', color: '#c2410c' }
            : { backgroundColor: 'var(--background-color)', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }),
});

const Hint = ({ tone = 'info', children }) => (
    <div style={hintBoxStyle(tone)}>
        {tone === 'info' ? <Info size={15} style={{ flexShrink: 0, marginTop: '1px' }} /> : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />}
        <span>{children}</span>
    </div>
);

const InvestorCalculators = ({ properties = [], loans = [], economicUnits = [] }) => {
    const [activeSubTab, setActiveSubTab] = useState('refinancing');
    const { isMobile } = useViewMode();
    const cols2 = isMobile ? '1fr' : '1fr 1fr';
    const today = todayStr();

    /* ─── 1. REFINANCING CALCULATOR STATE ─── */
    const [selectedLoanId, setSelectedLoanId] = useState('');
    const [refinancingInputs, setRefinancingInputs] = useState(() => ({
        loanAmount: 200000,
        interestRate: 2.5,
        repaymentRate: 2.0,
        startDate: todayStr(),
        endDate: todayPlusYearsStr(10),
        totalYears: 25,
        newInterestRate: 4.0,
        newRepaymentRate: 2.0,
        // Werte eines geladenen Darlehens (in der freien Berechnung leer)
        actualDebt: null,
        actualDebtDate: '',
        fixedAnnuity: null,
    }));
    // Herkunft der Gesamtlaufzeit: 'default' | 'plan' (aus Tilgungsplan) | 'unknown' (nicht ableitbar) | 'manual'
    const [totalYearsSource, setTotalYearsSource] = useState('default');
    // Neue Tilgung folgt der Empfehlung, bis der Nutzer sie selbst ändert
    const [newRepaymentManual, setNewRepaymentManual] = useState(false);

    /* ─── 2. RENT INCREASE CALCULATOR STATE ─── */
    const [selectedPropertyId, setSelectedPropertyId] = useState('');
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [rentInputs, setRentInputs] = useState({
        size: FREE_RENT_DEFAULTS.size,
        currentRent: FREE_RENT_DEFAULTS.currentRent,
        marketValue: FREE_RENT_DEFAULTS.marketValue,
        targetRent: round2(FREE_RENT_DEFAULTS.currentRent * 1.15),
        cappingLimit: 15,
        // IST-Miete der übrigen Einheiten des Objekts (nur bei Auswahl einer einzelnen Wohnung)
        otherUnitsRent: 0,
    });
    // Herkunft/Lücken der geladenen Objektdaten (für Hinweise)
    const [rentLoadInfo, setRentLoadInfo] = useState(null);

    /* ─── 3. MODERNIZATION CALCULATOR STATE ─── */
    const [modInputs, setModInputs] = useState({
        modCosts: 25000,
        subsidies: 0,
        size: 80,
        levyRate: 8,
        cappingLimit: 3.00 // EUR/m²/month cap
    });

    /* ─── 1. REFINANCING ─── */
    const handleSelectLoan = (loanId) => {
        setSelectedLoanId(loanId);
        const loan = loans.find(l => l.id === loanId);
        if (!loan) {
            // Freie Berechnung: Darlehens-spezifische Werte nicht weiterverwenden
            setRefinancingInputs(prev => ({ ...prev, actualDebt: null, actualDebtDate: '', fixedAnnuity: null }));
            if (totalYearsSource === 'plan' || totalYearsSource === 'unknown') setTotalYearsSource('manual');
            return;
        }
        const amount = toNumber(loan.loan_amount);
        const interest = toNumber(loan.interest_rate);
        const fixedAnnuity = toNumber(loan.fixed_annuity) > 0 ? toNumber(loan.fixed_annuity) : null;

        // Anfangstilgung aus dem Darlehen oder aus fester Rate und Zins ableiten
        let repayment = toNumber(loan.initial_repayment_rate);
        if (!repayment && fixedAnnuity && amount) {
            repayment = round2(Math.max(0, ((fixedAnnuity * 12) / amount) * 100 - interest));
        }

        const rawActual = loan.actual_residual_debt;
        const hasActual = rawActual !== null && rawActual !== undefined && rawActual !== '' && Number.isFinite(parseFloat(rawActual));
        const totalYrs = fullAmortizationYears(amount, interest, repayment, fixedAnnuity);

        setRefinancingInputs(prev => ({
            ...prev,
            loanAmount: amount,
            interestRate: interest,
            repaymentRate: repayment,
            startDate: loan.start_date || todayStr(),
            endDate: loan.end_date || todayPlusYearsStr(10),
            totalYears: totalYrs != null ? totalYrs : prev.totalYears,
            actualDebt: hasActual ? parseFloat(rawActual) : null,
            actualDebtDate: hasActual ? (loan.actual_residual_debt_date || '') : '',
            fixedAnnuity,
        }));
        setTotalYearsSource(totalYrs != null ? 'plan' : 'unknown');
    };

    const refCalc = computeRestschuld(refinancingInputs, today);
    const refError = refCalc.error;
    const refRestschuld = refCalc.restschuld ?? 0;
    const fixedYrs = yearsBetween(refinancingInputs.startDate, refinancingInputs.endDate);
    const refRemainingRaw = refinancingInputs.totalYears - (fixedYrs || 0);
    const refRemainingYears = Math.max(1, refRemainingRaw);
    const refRecommendedRepayment = recommendedRepayment(refRestschuld, refinancingInputs.newInterestRate, refRemainingYears);
    const effectiveNewRepayment = newRepaymentManual ? refinancingInputs.newRepaymentRate : refRecommendedRepayment;

    // Bisherige Rate: feste Annuität des Darlehens oder aus Betrag, Zins und Tilgung
    const refOriginalMonthly = refCalc.monthlyPayment;
    const refNewMonthly = (refRestschuld * ((refinancingInputs.newInterestRate / 100) + (effectiveNewRepayment / 100))) / 12;
    const refCashflowImpact = refOriginalMonthly - refNewMonthly; // Positive means we save money

    const refMonthsAmortizeSzenario = monthsToAmortize(refRestschuld, refinancingInputs.newInterestRate, refNewMonthly);
    const refFullyPaidOffDate = refMonthsAmortizeSzenario > 0 ? addMonthsToDate(refinancingInputs.endDate, refMonthsAmortizeSzenario) : null;
    const refAmortizedPercent = refinancingInputs.loanAmount > 0 ? (1 - (refRestschuld / refinancingInputs.loanAmount)) * 100 : null;

    /* ─── 2. RENT INCREASE ─── */
    const getUnitsForSelection = (selId) => {
        if (!selId) return [];
        if (selId.startsWith('prop_')) {
            const propId = selId.replace('prop_', '');
            const prop = properties.find(p => String(p.id) === propId);
            return prop ? (prop.units || []) : [];
        }
        if (selId.startsWith('we_')) {
            const weId = selId.replace('we_', '');
            return properties.filter(p => String(p.economic_unit_id) === weId).flatMap(p => p.units || []);
        }
        return [];
    };

    // Marktwert wie im Cockpit: WE-Wert (falls gepflegt) bzw. Objektwerte; ersatzweise Gesamtinvestition
    const getMarketValueForSelection = (selId) => {
        if (selId.startsWith('prop_')) {
            const propId = selId.replace('prop_', '');
            const prop = properties.find(p => String(p.id) === propId);
            const mv = toNumber(prop?.market_value_total);
            if (mv > 0) return { value: mv, source: 'market' };
            const inv = toNumber(prop?.total_investment_cost);
            return inv > 0 ? { value: inv, source: 'investment' } : { value: 0, source: 'none' };
        }
        if (selId.startsWith('we_')) {
            const weId = selId.replace('we_', '');
            const weRow = economicUnits.find(eu => String(eu.id) === weId);
            const weProps = properties.filter(p => String(p.economic_unit_id) === weId);
            const weMv = toNumber(weRow?.market_value_total);
            if (weMv > 0) return { value: weMv, source: 'market' };
            const sumMv = weProps.reduce((s, p) => s + toNumber(p.market_value_total), 0);
            if (sumMv > 0) return { value: sumMv, source: 'market' };
            const weInv = toNumber(weRow?.total_investment_cost);
            const sumInv = weInv > 0 ? weInv : weProps.reduce((s, p) => s + toNumber(p.total_investment_cost), 0);
            return sumInv > 0 ? { value: sumInv, source: 'investment' } : { value: 0, source: 'none' };
        }
        return { value: 0, source: 'none' };
    };

    const rentUnitsList = getUnitsForSelection(selectedPropertyId);

    // Objekt-/Wohnungsdaten einmalig als Startwerte übernehmen; gerechnet wird danach nur mit den Eingabefeldern
    const loadRentSelection = (selPropId, selUnitId) => {
        if (!selPropId) {
            setRentInputs(prev => ({
                ...prev,
                ...FREE_RENT_DEFAULTS,
                otherUnitsRent: 0,
                targetRent: round2(FREE_RENT_DEFAULTS.currentRent * (1 + prev.cappingLimit / 100)),
            }));
            setRentLoadInfo(null);
            return;
        }

        const units = getUnitsForSelection(selPropId);
        const market = getMarketValueForSelection(selPropId);
        const objectRent = units.reduce((s, u) => s + getUnitCurrentRent(u, today), 0);
        const objectSize = units.reduce((s, u) => s + toNumber(u.sqm), 0);

        let size = objectSize;
        let currentRent = objectRent;
        let otherUnitsRent = 0;
        let vacantCount = 0;
        let unitLease = null;
        const scopeUnits = selUnitId ? units.filter(u => String(u.id) === selUnitId) : units;

        if (selUnitId) {
            const unit = scopeUnits[0];
            size = toNumber(unit?.sqm);
            currentRent = getUnitCurrentRent(unit, today);
            otherUnitsRent = round2(objectRent - currentRent);
            unitLease = unit && !unit.is_vacation_rental ? getCurrentLease(unit, today) : null;
        }
        scopeUnits.forEach(u => {
            if (!u.is_vacation_rental && !getCurrentLease(u, today)) vacantCount++;
        });
        const indexOrStaffel = scopeUnits
            .map(u => (u.is_vacation_rental ? null : getCurrentLease(u, today)))
            .filter(l => l && (l.lease_type === 'index' || l.lease_type === 'staffel')).length;

        setRentInputs(prev => ({
            ...prev,
            size: round2(size),
            currentRent: round2(currentRent),
            marketValue: round2(market.value),
            otherUnitsRent,
            targetRent: round2(currentRent * (1 + prev.cappingLimit / 100)),
        }));
        setRentLoadInfo({
            marketValueSource: market.source,
            loadedMarketValue: round2(market.value),
            vacantCount,
            unitCount: scopeUnits.length,
            indexOrStaffel,
            unitLease,
        });
    };

    const rentCurrentSqm = rentInputs.size > 0 ? rentInputs.currentRent / rentInputs.size : 0;
    const rentTargetSqm = rentInputs.size > 0 ? rentInputs.targetRent / rentInputs.size : 0;
    const rentIncreaseAbsolute = Math.max(0, round2(rentInputs.targetRent - rentInputs.currentRent));
    const rentIncreasePercent = rentInputs.currentRent > 0 ? (rentIncreaseAbsolute / rentInputs.currentRent) * 100 : 0;

    // Kennzahlen für das gesamte Objekt/die WE – ausschließlich aus den sichtbaren Eingaben
    const objectCurrentRent = rentInputs.currentRent + (selectedUnitId ? rentInputs.otherUnitsRent : 0);
    const objectStats = {
        marketValue: rentInputs.marketValue,
        currentRent: objectCurrentRent,
        targetRent: objectCurrentRent + rentIncreaseAbsolute,
    };

    // Yield Boost calculations based on entire object/WE
    const yieldCurrent = objectStats.marketValue > 0 ? (objectStats.currentRent * 12 / objectStats.marketValue) * 100 : 0;
    const yieldTarget = objectStats.marketValue > 0 ? (objectStats.targetRent * 12 / objectStats.marketValue) * 100 : 0;
    const currentFactor = (objectStats.currentRent * 12) > 0 ? objectStats.marketValue / (objectStats.currentRent * 12) : 0;
    const calculatedValueAppreciation = rentIncreaseAbsolute * 12 * currentFactor;

    // Lücken der geladenen Objektdaten (verschwinden, sobald der Wert eingetragen ist)
    const rentDataGaps = rentLoadInfo ? [
        !(rentInputs.size > 0) ? 'Keine Wohnfläche hinterlegt.' : null,
        !(rentInputs.currentRent > 0) ? 'Keine IST-Miete (kein laufender Mietvertrag).' : null,
        !(rentInputs.marketValue > 0) ? 'Kein Marktwert hinterlegt.' : null,
        rentInputs.marketValue > 0 && rentLoadInfo.marketValueSource === 'investment' && rentInputs.marketValue === rentLoadInfo.loadedMarketValue
            ? 'Kein Marktwert hinterlegt – die Gesamtinvestition wird als Immobilienwert verwendet.' : null,
    ].filter(Boolean) : [];

    // Sperrfrist (§ 558 Abs. 1 BGB) für die ausgewählte Wohnung
    const unitLease = selectedUnitId ? rentLoadInfo?.unitLease : null;
    const lastChangeDate = unitLease ? (unitLease.last_rent_increase || unitLease.start_date || '') : '';
    const earliestRequest = lastChangeDate ? addMonthsToDate(lastChangeDate, 12) : null;
    const earliestEffective = lastChangeDate ? addMonthsToDate(lastChangeDate, 15) : null;
    const lockActive = earliestEffective ? earliestEffective > new Date() : false;
    const unitLeaseIsIndexOrStaffel = unitLease && (unitLease.lease_type === 'index' || unitLease.lease_type === 'staffel');

    /* ─── 3. MODERNIZATION CALCULATIONS ─── */
    const modCostsEligible = Math.max(0, modInputs.modCosts - modInputs.subsidies);
    const modLevyTheoreticalAnnual = modCostsEligible * (modInputs.levyRate / 100);
    const modLevyTheoreticalMonthly = modLevyTheoreticalAnnual / 12;
    const modLevyTheoreticalMonthlySqm = modInputs.size > 0 ? modLevyTheoreticalMonthly / modInputs.size : 0;

    // Apply capping limit
    const modLevyAppliedMonthlySqm = Math.min(modLevyTheoreticalMonthlySqm, modInputs.cappingLimit);
    const modLevyAppliedMonthly = modLevyAppliedMonthlySqm * modInputs.size;

    const modAmortizationYears = modLevyAppliedMonthly > 0 ? modCostsEligible / (modLevyAppliedMonthly * 12) : 0;

    const tabButtonStyle = (key) => ({
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: isMobile ? '10px 12px' : '12px 16px', borderRadius: '8px', border: 'none',
        cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
        backgroundColor: activeSubTab === key ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
        color: activeSubTab === key ? '#0ea5e9' : 'var(--text-secondary)',
        transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
    });

    return (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '240px minmax(0, 1fr)', gap: isMobile ? '16px' : '24px', minHeight: '500px' }}>

            {/* Sidebar Navigation (mobil: Tabs oben) */}
            <div style={isMobile
                ? { display: 'flex', flexDirection: 'row', gap: '6px', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }
                : { display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid var(--border-color)', paddingRight: '16px' }}>
                <button onClick={() => setActiveSubTab('refinancing')} style={tabButtonStyle('refinancing')}>
                    <RefreshCw size={16} className={activeSubTab === 'refinancing' ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
                    Anschlussfinanzierung
                </button>

                <button onClick={() => setActiveSubTab('rent_increase')} style={tabButtonStyle('rent_increase')}>
                    <TrendingUp size={16} />
                    Mieterhöhungs-Simulator
                </button>

                <button onClick={() => setActiveSubTab('modernization')} style={tabButtonStyle('modernization')}>
                    <Calculator size={16} />
                    Modernisierungsumlage
                </button>
            </div>

            {/* Calculator Display Panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

                {/* TAB 1: REFINANCING */}
                {activeSubTab === 'refinancing' && (
                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '24px' }}>

                        {/* INPUTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Finanzierungs-Parameter">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                                    {/* Load loan dropdown */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            Bestehendes Darlehen laden
                                        </label>
                                        <select
                                            value={selectedLoanId}
                                            onChange={e => handleSelectLoan(e.target.value)}
                                            style={{
                                                padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem'
                                            }}
                                        >
                                            <option value="">— Freie Berechnung —</option>
                                            {loans.map(loan => {
                                                const prop = properties.find(p => p.id === loan.property_id);
                                                const we = economicUnits.find(eu => eu.id === loan.economic_unit_id);
                                                let addr = 'Unbekanntes Objekt';
                                                if (loan.economic_unit_id) {
                                                    const weProps = properties.filter(p => p.economic_unit_id === loan.economic_unit_id);
                                                    const streets = Array.from(new Set(weProps.map(pr => pr.street).filter(Boolean))).join(', ');
                                                    const houseNumbers = weProps.map(pr => pr.house_number).filter(Boolean).join(' & ');
                                                    const addrStr = [streets, houseNumbers].filter(Boolean).join(' ');
                                                    addr = addrStr ? `WE: ${addrStr}` : `WE: ${we?.name || 'Wirtschaftseinheit'}`;
                                                } else if (prop) {
                                                    addr = `${prop.street} ${prop.house_number || ''}`.trim();
                                                }
                                                return (
                                                    <option key={loan.id} value={loan.id}>
                                                        {addr} - {loan.bank_name || 'Bank'} ({formatCurrency(toNumber(loan.loan_amount))})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <CurrencyField
                                            label="Darlehensbetrag (€)"
                                            value={refinancingInputs.loanAmount}
                                            // Ein geänderter Betrag ersetzt die Ist-Restschuld des geladenen Darlehens
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, loanAmount: nonNegative(v), actualDebt: null, actualDebtDate: '' }))}
                                        />
                                        <PercentField
                                            label="Sollzins p.a. (%)"
                                            value={refinancingInputs.interestRate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, interestRate: nonNegative(v) }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <DateField
                                            label="Startdatum / Tilgungsbeginn"
                                            value={refinancingInputs.startDate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, startDate: v }))}
                                        />
                                        <PercentField
                                            label="Anfangstilgung p.a. (%)"
                                            value={refinancingInputs.repaymentRate}
                                            // Eine geänderte Tilgung ersetzt die feste Rate des geladenen Darlehens
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, repaymentRate: nonNegative(v), fixedAnnuity: null }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <DateField
                                                label="Zinsende"
                                                value={refinancingInputs.endDate}
                                                onChange={v => setRefinancingInputs(prev => ({ ...prev, endDate: v }))}
                                            />
                                            {fixedYrs != null && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', fontWeight: 500 }}>
                                                    ⏱️ Zinsbindung: {fixedYrs.toFixed(1)} Jahre
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <NumberField
                                                label="Geplante Gesamtlaufzeit (Jahre)"
                                                value={refinancingInputs.totalYears}
                                                onChange={v => {
                                                    setRefinancingInputs(prev => ({ ...prev, totalYears: Math.round(nonNegative(v)) }));
                                                    setTotalYearsSource('manual');
                                                }}
                                            />
                                            {selectedLoanId && totalYearsSource === 'plan' && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', fontWeight: 500 }}>
                                                    📊 Aus aktuellem Tilgungsplan berechnet
                                                </div>
                                            )}
                                            {selectedLoanId && totalYearsSource === 'unknown' && (
                                                <div style={{ fontSize: '0.72rem', color: '#c2410c', marginTop: '4px', fontWeight: 500 }}>
                                                    Aus dem Tilgungsplan nicht ableitbar (Rate deckt die Zinsen nicht bzw. kein Betrag) – bitte selbst eintragen.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Darlehens-spezifische Rechengrundlagen sichtbar machen */}
                                    {refinancingInputs.actualDebt != null && (
                                        refCalc.basis === 'actual_undated' ? (
                                            <Hint tone="warning">
                                                Ist-Restschuld laut Darlehen: <strong>{formatCurrency2(refinancingInputs.actualDebt)}</strong> ohne Stichtag –
                                                als heutiger Stand angenommen. Bitte den Stichtag im Darlehen nachtragen.
                                                (Eine Änderung des Darlehensbetrags verwirft die Ist-Restschuld.)
                                            </Hint>
                                        ) : (
                                            <Hint>
                                                Ist-Restschuld laut Darlehen: <strong>{formatCurrency2(refinancingInputs.actualDebt)}</strong>
                                                {refinancingInputs.actualDebtDate ? ` zum ${formatDateDE(refinancingInputs.actualDebtDate)}` : ''} – die Restschuld
                                                wird ab diesem Stand berechnet. (Eine Änderung des Darlehensbetrags verwirft die Ist-Restschuld.)
                                            </Hint>
                                        )
                                    )}
                                    {refinancingInputs.fixedAnnuity > 0 && (
                                        <Hint>
                                            Feste Monatsrate laut Darlehen: <strong>{formatCurrency2(refinancingInputs.fixedAnnuity)}</strong>.
                                            (Eine Änderung der Anfangstilgung ersetzt sie durch die rechnerische Rate.)
                                        </Hint>
                                    )}
                                </div>
                            </Card>

                            <Card title="Anschlussfinanzierung (Szenario)">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <PercentField
                                            label="Neuer Zinssatz (%)"
                                            value={refinancingInputs.newInterestRate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, newInterestRate: nonNegative(v) }))}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <PercentField
                                                label="Neue Tilgung (%)"
                                                value={effectiveNewRepayment}
                                                onChange={v => {
                                                    setRefinancingInputs(prev => ({ ...prev, newRepaymentRate: nonNegative(v) }));
                                                    setNewRepaymentManual(true);
                                                }}
                                            />
                                            {refRestschuld > 0 && (
                                                <button
                                                    onClick={() => {
                                                        setRefinancingInputs(prev => ({ ...prev, newRepaymentRate: refRecommendedRepayment }));
                                                        setNewRepaymentManual(false);
                                                    }}
                                                    style={{
                                                        backgroundColor: 'var(--background-color)', border: '1px solid var(--primary-color)',
                                                        color: 'var(--primary-color)', padding: '2px 6px', borderRadius: '4px',
                                                        fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left', fontWeight: 600,
                                                        marginTop: '2px', display: 'inline-block', width: 'fit-content'
                                                    }}
                                                >
                                                    💡 Empfehlung: {refRecommendedRepayment}%{newRepaymentManual ? ' übernehmen' : ''}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* RESULTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Berechnete Ergebnisse">
                                {refError ? (
                                    <Hint tone="danger">{refError} Ohne gültigen Zeitraum werden keine Ergebnisse berechnet.</Hint>
                                ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                    <div style={{ padding: '14px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                            Restschuld zum Zinsende (nach {fixedYrs.toFixed(1)} Jahren)
                                        </div>
                                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary-color)' }}>
                                            {formatCurrency(refRestschuld)}
                                        </div>
                                        {refAmortizedPercent != null && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                Getilgt: {formatPercent(refAmortizedPercent)} ({formatCurrency(refinancingInputs.loanAmount - refRestschuld)})
                                            </div>
                                        )}
                                    </div>

                                    {refFullyPaidOffDate ? (
                                        <div style={{ padding: '14px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                                Vollständige Tilgung (Szenario)
                                            </div>
                                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#16a34a' }}>
                                                📅 {refFullyPaidOffDate.toLocaleDateString('de-DE')}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                Gesamtlaufzeit ab heute: {formatYearsAndMonths((refFullyPaidOffDate - new Date()) / (1000 * 60 * 60 * 24 * 365.25))}
                                            </div>
                                        </div>
                                    ) : (refRestschuld > 0 && refMonthsAmortizeSzenario == null && (
                                        <Hint tone="warning">
                                            Mit der neuen Rate wird das Darlehen nicht vollständig getilgt (die Rate deckt höchstens die Zinsen
                                            oder die Tilgung dauert länger als 100 Jahre).
                                        </Hint>
                                    ))}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rate Bisher (Mo.)</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px' }}>{formatCurrency(refOriginalMonthly)}</div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', backgroundColor: 'rgba(14, 165, 233, 0.03)' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rate Neu (Mo.)</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px', color: 'var(--primary-color)' }}>{formatCurrency(refNewMonthly)}</div>
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: '14px', borderRadius: '10px',
                                        backgroundColor: refCashflowImpact >= 0 ? 'rgba(22, 163, 74, 0.08)' : 'rgba(220, 38, 38, 0.08)',
                                        border: `1px solid ${refCashflowImpact >= 0 ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`
                                    }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                            Auswirkung auf monatlichen Cashflow
                                        </div>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: refCashflowImpact >= 0 ? '#16a34a' : '#dc2626' }}>
                                            {refCashflowImpact >= 0 ? '+' : ''}{formatCurrency(refCashflowImpact)} / Monat
                                        </div>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                                            {refCashflowImpact >= 0
                                                ? 'Durch die niedrigere Gesamtbelastung erhöht sich Ihr freier Cashflow entsprechend.'
                                                : 'Achtung: Die gestiegene Kreditrate verringert Ihren monatlichen Cashflow aus diesem Objekt.'
                                            }
                                        </p>
                                    </div>

                                    <div style={{ padding: '12px 14px', border: '1px dashed var(--border-color)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                        <strong>ℹ️ Empfehlung zur Volltilgung:</strong>
                                        <br />
                                        Um das Darlehen in den verbleibenden <strong>{formatYearsAndMonths(refRemainingYears)}</strong>
                                        {refRemainingRaw < 1 ? ' (mindestens 1 Jahr angesetzt, die geplante Gesamtlaufzeit ist kürzer als die Zinsbindung)' : ''} komplett
                                        abzuzahlen, empfiehlt sich bei einem Zins von {refinancingInputs.newInterestRate}% eine Anfangstilgung von <strong>{refRecommendedRepayment}%</strong>.
                                    </div>
                                </div>
                                )}
                            </Card>
                        </div>
                    </div>
                )}

                {/* TAB 2: RENT INCREASE */}
                {activeSubTab === 'rent_increase' && (
                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '24px' }}>

                        {/* INPUTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Objekt & Mietwerte">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                                    {/* Load property dropdown */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            Bestandsobjekt laden
                                        </label>
                                        <select
                                            value={selectedPropertyId}
                                            onChange={e => {
                                                setSelectedPropertyId(e.target.value);
                                                setSelectedUnitId(''); // reset unit on property change
                                                loadRentSelection(e.target.value, '');
                                            }}
                                            style={{
                                                padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem'
                                            }}
                                        >
                                            <option value="">— Freie Berechnung —</option>
                                            <optgroup label="Wirtschaftseinheiten">
                                                {economicUnits.map(eu => {
                                                    const weProps = properties.filter(p => String(p.economic_unit_id) === String(eu.id));
                                                    // Nur Wirtschaftseinheiten mit Objekten im aktuellen Portfolio
                                                    if (weProps.length === 0) return null;
                                                    const weTotalRent = weProps.reduce((sum, p) => sum + (p.units || []).reduce((s, u) => s + getUnitCurrentRent(u, today), 0), 0);
                                                    const streets = Array.from(new Set(weProps.map(pr => pr.street).filter(Boolean))).join(', ');
                                                    const houseNumbers = weProps.map(pr => pr.house_number).filter(Boolean).join(' & ');
                                                    const addrStr = [streets, houseNumbers].filter(Boolean).join(' ');
                                                    const displayName = addrStr ? `WE: ${addrStr}` : `WE: ${eu.name || 'Wirtschaftseinheit'}`;
                                                    return (
                                                        <option key={`we_${eu.id}`} value={`we_${eu.id}`}>
                                                            {displayName} (IST: {formatCurrency(weTotalRent)})
                                                        </option>
                                                    );
                                                })}
                                            </optgroup>
                                            <optgroup label="Einzelobjekte">
                                                {properties.map(p => {
                                                    const totalRent = (p.units || []).reduce((s, u) => s + getUnitCurrentRent(u, today), 0);
                                                    return (
                                                        <option key={`prop_${p.id}`} value={`prop_${p.id}`}>
                                                            {p.street} {p.house_number || ''} (IST: {formatCurrency(totalRent)})
                                                        </option>
                                                    );
                                                })}
                                            </optgroup>
                                        </select>
                                    </div>

                                    {selectedPropertyId && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                Betroffene Wohnung
                                            </label>
                                            <select
                                                value={selectedUnitId}
                                                onChange={e => {
                                                    setSelectedUnitId(e.target.value);
                                                    loadRentSelection(selectedPropertyId, e.target.value);
                                                }}
                                                style={{
                                                    padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                    backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem'
                                                }}
                                            >
                                                <option value="">— Gesamtes Objekt —</option>
                                                {rentUnitsList.map(u => (
                                                    <option key={u.id} value={u.id}>
                                                        Wohnung: {u.unit_name || u.unit_number || '–'} ({u.sqm ?? '–'} m², IST: {formatCurrency(getUnitCurrentRent(u, today))})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Fehlende Objektdaten sichtbar machen statt Demo-Werte einzusetzen */}
                                    {selectedPropertyId && rentLoadInfo && rentDataGaps.length > 0 && (
                                        <Hint tone="warning">
                                            {rentDataGaps.join(' ')} Die Werte können unten eingetragen werden.
                                        </Hint>
                                    )}
                                    {selectedPropertyId && rentLoadInfo && rentLoadInfo.vacantCount > 0 && !selectedUnitId && (
                                        <Hint>
                                            {rentLoadInfo.vacantCount} von {rentLoadInfo.unitCount} Einheiten ohne laufenden Mietvertrag – Leerstand zählt mit 0 € IST-Miete.
                                        </Hint>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <NumberField
                                            label="Wohnfläche (m²)"
                                            value={rentInputs.size}
                                            onChange={v => setRentInputs(prev => ({ ...prev, size: nonNegative(v) }))}
                                            step="0.1"
                                        />
                                        <CurrencyField
                                            label="Kaltmiete IST (€ / Mo.)"
                                            value={rentInputs.currentRent}
                                            onChange={v => setRentInputs(prev => ({ ...prev, currentRent: round2(nonNegative(v)) }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <CurrencyField
                                            label={selectedUnitId ? 'Immobilienwert Gesamtobjekt (€)' : 'Immobilienwert / Marktpreis (€)'}
                                            value={rentInputs.marketValue}
                                            onChange={v => setRentInputs(prev => ({ ...prev, marketValue: nonNegative(v) }))}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                Mieterhöhung (%)
                                            </label>
                                            <select
                                                value={rentInputs.cappingLimit}
                                                onChange={e => {
                                                    const pct = parseInt(e.target.value, 10) || 15;
                                                    setRentInputs(prev => ({
                                                        ...prev,
                                                        cappingLimit: pct,
                                                        targetRent: round2(prev.currentRent * (1 + pct / 100))
                                                    }));
                                                }}
                                                style={{
                                                    padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                    backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem', width: '100%'
                                                }}
                                            >
                                                <option value="5">5% Erhöhung</option>
                                                <option value="10">10% Erhöhung</option>
                                                <option value="15">15% Erhöhung</option>
                                                <option value="20">20% Erhöhung</option>
                                                <option value="25">25% Erhöhung (über Kappungsgrenze)</option>
                                                <option value="30">30% Erhöhung (über Kappungsgrenze)</option>
                                            </select>
                                        </div>
                                    </div>

                                    {selectedUnitId && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            Rendite und Faktor beziehen sich auf das Gesamtobjekt: IST-Miete gesamt {formatCurrency2(objectCurrentRent)} / Mo.
                                            (diese Wohnung {formatCurrency2(rentInputs.currentRent)} + übrige Einheiten {formatCurrency2(rentInputs.otherUnitsRent)}).
                                        </div>
                                    )}
                                </div>
                            </Card>

                            <Card title="Mieterhöhung (Soll)">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <CurrencyField
                                            label="Neue Miete SOLL (€ / Mo.)"
                                            value={rentInputs.targetRent}
                                            onChange={v => setRentInputs(prev => ({ ...prev, targetRent: round2(nonNegative(v)) }))}
                                        />
                                        <NumberField
                                            label="Soll-Miete pro m² (€)"
                                            value={round2(rentTargetSqm)}
                                            step="0.01"
                                            onChange={v => setRentInputs(prev => ({ ...prev, targetRent: round2(nonNegative(v) * prev.size) }))}
                                        />
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* RESULTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Auswertungen & Hebel">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

                                    {/* Rechtliche Grenzen (§ 558 BGB) */}
                                    {unitLeaseIsIndexOrStaffel && (
                                        <Hint tone="danger">
                                            Für diesen Vertrag ({unitLease.lease_type === 'staffel' ? 'Staffelmiete' : 'Indexmiete'}) ist eine Erhöhung auf die ortsübliche
                                            Vergleichsmiete (§ 558 BGB) ausgeschlossen; Anpassungen richten sich nach der vereinbarten
                                            {unitLease.lease_type === 'staffel' ? ' Staffel (§ 557a BGB)' : ' Indexklausel (§ 557b BGB)'}.
                                        </Hint>
                                    )}
                                    {!selectedUnitId && rentLoadInfo?.indexOrStaffel > 0 && (
                                        <Hint tone="warning">
                                            {rentLoadInfo.indexOrStaffel} {rentLoadInfo.indexOrStaffel === 1 ? 'Vertrag' : 'Verträge'} mit Index- oder Staffelmiete:
                                            Für diese ist eine prozentuale Erhöhung nach § 558 BGB nicht anwendbar.
                                        </Hint>
                                    )}
                                    {rentIncreasePercent > RENT_CAP_GENERAL + 0.005 ? (
                                        <Hint tone="danger">
                                            Die Erhöhung um {rentIncreasePercent.toFixed(1)}% überschreitet die Kappungsgrenze nach § 558 Abs. 3 BGB
                                            ({RENT_CAP_GENERAL}% innerhalb von drei Jahren).
                                        </Hint>
                                    ) : rentIncreasePercent > RENT_CAP_REDUCED + 0.005 ? (
                                        <Hint tone="warning">
                                            In Gebieten mit abgesenkter Kappungsgrenze (Landesverordnung) sind höchstens {RENT_CAP_REDUCED}% innerhalb von drei
                                            Jahren zulässig – die Erhöhung um {rentIncreasePercent.toFixed(1)}% wäre dort unzulässig.
                                        </Hint>
                                    ) : null}
                                    {lockActive && !unitLeaseIsIndexOrStaffel && (
                                        <Hint tone="warning">
                                            {unitLease.last_rent_increase ? 'Letzte Mieterhöhung' : 'Mietbeginn'} am {formatDateDE(lastChangeDate)}:
                                            Mieterhöhungsverlangen nach § 558 BGB frühestens ab {earliestRequest.toLocaleDateString('de-DE')},
                                            wirksam frühestens ab {earliestEffective.toLocaleDateString('de-DE')}.
                                        </Hint>
                                    )}
                                    {rentIncreaseAbsolute > 0 && (
                                        <Hint>
                                            Vereinfachte Simulation, keine Rechtsberatung: Eine Erhöhung nach § 558 BGB ist nur bis zur ortsüblichen
                                            Vergleichsmiete möglich. Die Kappungsgrenze bezieht sich auf die Miete vor drei Jahren (frühere Erhöhungen in
                                            diesem Zeitraum zählen mit); die Miete muss beim Wirksamwerden seit 15 Monaten unverändert sein.
                                        </Hint>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietertrag IST/m²</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px' }}>{formatCurrency2(rentCurrentSqm)}/m²</div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietertrag SOLL/m²</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px', color: '#0ea5e9' }}>{formatCurrency2(rentTargetSqm)}/m²</div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mehrertrag (Monat)</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '4px', color: '#16a34a' }}>
                                                +{formatCurrency2(rentIncreaseAbsolute)}
                                            </div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Erhöhung</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '4px' }}>
                                                {rentIncreasePercent.toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Bruttorendite IST</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px' }}>{objectStats.marketValue > 0 ? `${yieldCurrent.toFixed(2)}%` : '–'}</div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', backgroundColor: 'rgba(14, 165, 233, 0.03)' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Bruttorendite SOLL</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px', color: '#0ea5e9' }}>{objectStats.marketValue > 0 ? `${yieldTarget.toFixed(2)}%` : '–'}</div>
                                        </div>
                                    </div>

                                    {/* Asset Value Appreciation Card */}
                                    {calculatedValueAppreciation > 0 && (
                                        <div style={{
                                            padding: '14px', borderRadius: '10px',
                                            backgroundColor: 'rgba(14, 165, 233, 0.08)',
                                            border: '1px solid rgba(14, 165, 233, 0.3)'
                                        }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                Asset-Hebel (Kalkulatorischer Wertzuwachs)
                                            </div>
                                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0ea5e9' }}>
                                                +{formatCurrency(calculatedValueAppreciation)}
                                            </div>
                                            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                                                Bei einem aktuellen Multiplikator von <strong>{currentFactor.toFixed(1)}x</strong> (Faktor) steigert diese Mieterhöhung den rechnerischen Immobilienwert um den oben genannten Betrag.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    </div>
                )}

                {/* TAB 3: MODERNIZATION */}
                {activeSubTab === 'modernization' && (
                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '24px' }}>

                        {/* INPUTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Modernisierungs-Kosten">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <CurrencyField
                                            label="Modernisierungskosten (€)"
                                            value={modInputs.modCosts}
                                            onChange={v => setModInputs(prev => ({ ...prev, modCosts: nonNegative(v) }))}
                                        />
                                        <CurrencyField
                                            label="Abzug Förder-/Drittmittel (€)"
                                            value={modInputs.subsidies}
                                            onChange={v => setModInputs(prev => ({ ...prev, subsidies: nonNegative(v) }))}
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '12px' }}>
                                        <NumberField
                                            label="Wohnfläche (m²)"
                                            value={modInputs.size}
                                            onChange={v => setModInputs(prev => ({ ...prev, size: nonNegative(v) }))}
                                            step="0.1"
                                        />
                                        <PercentField
                                            label="Umlagesatz p.a. (%)"
                                            value={modInputs.levyRate}
                                            onChange={v => setModInputs(prev => ({ ...prev, levyRate: nonNegative(v) }))}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            Modernisierungs-Kappungsgrenze / m²
                                        </label>
                                        <select
                                            value={modInputs.cappingLimit}
                                            onChange={e => setModInputs(prev => ({ ...prev, cappingLimit: parseFloat(e.target.value) || 3.00 }))}
                                            style={{
                                                padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem'
                                            }}
                                        >
                                            <option value="2">2,00 € (Kappungsgrenze, z.B. Bestandsmiete &lt; 7 €/m²)</option>
                                            <option value="3">3,00 € (Kappungsgrenze, standardmäßig)</option>
                                        </select>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* RESULTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Modernisierungsumlage-Ergebnis">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

                                    <div style={{ padding: '14px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                            Zulässige Mieterhöhung (Monatlich gesamt)
                                        </div>
                                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#16a34a' }}>
                                            +{formatCurrency(modLevyAppliedMonthly)}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Erhöhung pro m²: {formatCurrency2(modLevyAppliedMonthlySqm)}/m² (theoretisch: {formatCurrency2(modLevyTheoreticalMonthlySqm)}/m²)
                                        </div>
                                        {modInputs.subsidies > 0 && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                Umlagefähige Kosten nach Abzug der Förder-/Drittmittel: {formatCurrency(modCostsEligible)}
                                            </div>
                                        )}
                                    </div>

                                    {/* Cap indicator */}
                                    {modLevyTheoreticalMonthlySqm > modInputs.cappingLimit && (
                                        <div style={{
                                            display: 'flex', gap: '10px', alignItems: 'center', padding: '12px',
                                            backgroundColor: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.3)',
                                            borderRadius: '8px', color: '#f97316', fontSize: '0.8rem'
                                        }}>
                                            <Info size={16} />
                                            <span>
                                                Die Erhöhung wird durch die Modernisierungs-Kappungsgrenze von {formatCurrency2(modInputs.cappingLimit)}/m² limitiert.
                                            </span>
                                        </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Umlagebetrag p.a.</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px' }}>{formatCurrency(modLevyAppliedMonthly * 12)}</div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Amortisationsdauer</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px', color: '#f97316' }}>
                                                {modAmortizationYears.toFixed(1)} Jahre
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ padding: '12px 14px', border: '1px dashed var(--border-color)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                        <strong>ℹ️ Modernisierungsumlage gem. BGB:</strong>
                                        <br />
                                        Sie dürfen energetische Sanierungen, Barrierefreiheit-Maßnahmen sowie sonstige Gebrauchswerterhöhungen umlegen. Reine Instandhaltungskosten (z.B. Reparaturen) müssen von den Gesamtkosten abgezogen werden.
                                        <br />
                                        Vereinfachte Berechnung nach § 559 BGB, keine Rechtsberatung. Nicht abgebildet sind u. a. zinsverbilligte
                                        Darlehen (§ 559a BGB), die Sonderregeln beim Heizungstausch (§ 559e BGB) sowie die Anrechnung früherer
                                        Modernisierungserhöhungen der letzten sechs Jahre auf die Kappungsgrenze.
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─── LOCAL INPUT FIELD STYLES ─── */
const inputStyle = {
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text-primary)',
    width: '100%',
    fontSize: '0.9rem'
};

/** Währungsfeld – formatiert außerhalb der Eingabe, Rohtext während der Eingabe */
const CurrencyField = ({ label, value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState(String(value));
    const inputRef = useRef(null);

    const displayValue = editing ? raw : new Intl.NumberFormat('de-DE').format(value);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type={editing ? 'number' : 'text'}
                value={displayValue}
                min="0"
                onFocus={() => {
                    setEditing(true);
                    setRaw(String(value));
                    setTimeout(() => { if (inputRef.current) inputRef.current.select(); }, 0);
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

/** Zahlenfeld – während der Eingabe bleibt der getippte Text stehen (auch ein leeres Feld) */
const NumberField = ({ label, value, onChange, step = '1', max }) => {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState('');
    const inputRef = useRef(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                ref={inputRef}
                type="number"
                value={editing ? raw : value}
                step={step}
                min="0"
                max={max}
                onFocus={() => {
                    setEditing(true);
                    setRaw(String(value));
                    setTimeout(() => { if (inputRef.current) inputRef.current.select(); }, 0);
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

const PercentField = ({ label, value, onChange }) => (
    <NumberField label={label} value={value} onChange={onChange} step="0.1" max="999" />
);

const DateField = ({ label, value, onChange }) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</label>
            <input
                type="date"
                value={value}
                onChange={e => onChange(e.target.value)}
                style={inputStyle}
            />
        </div>
    );
};

export default InvestorCalculators;
