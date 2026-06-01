import React, { useState, useEffect, useRef, useMemo } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { RefreshCw, TrendingUp, Calculator, Info, AlertTriangle } from 'lucide-react';

const formatCurrency = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
const formatCurrency2 = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 100);

const calculateFullAmortizationTerm = (amount, interest, repaymentRate, fixedAnnuity) => {
    if (amount <= 0 || interest <= 0) return 30;
    
    let balance = amount;
    const interestRateDec = interest / 100;
    let monthlyPayment = fixedAnnuity ? parseFloat(fixedAnnuity) : 0;
    if (!monthlyPayment) {
        monthlyPayment = (amount * (interestRateDec + (repaymentRate / 100))) / 12;
    }
    
    if (monthlyPayment <= (balance * interestRateDec / 12)) {
        return 50; 
    }
    
    let months = 0;
    while (balance > 0.01 && months < 1200) {
        const monthlyInterest = balance * (interestRateDec / 12);
        const principal = monthlyPayment - monthlyInterest;
        balance = Math.max(0, balance - principal);
        months++;
    }
    return Math.max(1, Math.round(months / 12));
};

const getRestschuldFromInputs = (inputs, selectedLoanObj) => {
    const amount = inputs.loanAmount;
    const interest = inputs.interestRate;
    const repayment = inputs.repaymentRate;
    const start = new Date(inputs.startDate);
    const end = new Date(inputs.endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return amount;

    let initialBalance = amount;
    let calcStartDate = start;
    let monthlyPayment = 0;

    if (selectedLoanObj) {
        const hasActual = selectedLoanObj.actual_residual_debt !== null && selectedLoanObj.actual_residual_debt !== undefined;
        initialBalance = hasActual ? parseFloat(selectedLoanObj.actual_residual_debt) : amount;
        const startStr = hasActual && selectedLoanObj.actual_residual_debt_date ? selectedLoanObj.actual_residual_debt_date : selectedLoanObj.start_date;
        calcStartDate = new Date(startStr);
        
        monthlyPayment = parseFloat(selectedLoanObj.fixed_annuity);
    }

    if (!monthlyPayment) {
        monthlyPayment = (amount * ((interest / 100) + (repayment / 100))) / 12;
    }

    const months = (end.getFullYear() - calcStartDate.getFullYear()) * 12 + (end.getMonth() - calcStartDate.getMonth());
    if (months <= 0) return initialBalance;

    let balance = initialBalance;
    const monthlyInterestRate = (interest / 100) / 12;

    for (let m = 0; m < months; m++) {
        const monthlyInterest = balance * monthlyInterestRate;
        const principal = monthlyPayment - monthlyInterest;
        balance = Math.max(0, balance - principal);
    }
    return balance;
};

const getMonthsToAmortize = (balance, interestRate, repaymentRate) => {
    if (balance <= 0) return 0;
    const interestRateDec = interestRate / 100;
    const monthlyInterestRate = interestRateDec / 12;
    const monthlyPayment = (balance * (interestRateDec + (repaymentRate / 100))) / 12;

    if (monthlyPayment <= (balance * monthlyInterestRate)) {
        return 1200; // never ends or capped at 100 years
    }

    let currentBalance = balance;
    let months = 0;
    while (currentBalance > 0.01 && months < 1200) {
        const monthlyInterest = currentBalance * monthlyInterestRate;
        const principal = monthlyPayment - monthlyInterest;
        currentBalance = Math.max(0, currentBalance - principal);
        months++;
    }
    return months;
};

const getFullyPaidOffDate = (endDateStr, monthsNeeded) => {
    const date = new Date(endDateStr);
    if (isNaN(date.getTime()) || monthsNeeded <= 0) return null;
    date.setMonth(date.getMonth() + monthsNeeded);
    return date;
};

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

const InvestorCalculators = ({ properties = [], loans = [], economicUnits = [] }) => {
    const [activeSubTab, setActiveSubTab] = useState('refinancing');

    /* ─── 1. REFINANCING CALCULATOR STATE ─── */
    const [selectedLoanId, setSelectedLoanId] = useState('');
    const selectedLoan = loans.find(l => l.id === selectedLoanId);
    const [refinancingInputs, setRefinancingInputs] = useState({
        loanAmount: 200000,
        interestRate: 2.5,
        repaymentRate: 2.0,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString().split('T')[0],
        totalYears: 25,
        newInterestRate: 4.0,
        newRepaymentRate: 2.0
    });

    /* ─── 2. RENT INCREASE CALCULATOR STATE ─── */
    const [selectedPropertyId, setSelectedPropertyId] = useState('');
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [rentInputs, setRentInputs] = useState({
        size: 80,
        currentRent: 600,
        marketValue: 180000,
        targetRent: 690,
        cappingLimit: 15
    });

    /* ─── 3. MODERNIZATION CALCULATOR STATE ─── */
    const [modInputs, setModInputs] = useState({
        modCosts: 25000,
        size: 80,
        levyRate: 8,
        cappingLimit: 3.00 // EUR/m²/month cap
    });

    /* ─── 1. REFINANCING CALCULATIONS ─── */
    // Helper to calculate remaining debt after N years
    const calculateRestschuld = (amount, interest, repayment, fixedYrs) => {
        let balance = amount;
        const monthlyInterestRate = (interest / 100) / 12;
        const annualRate = (interest / 100) + (repayment / 100);
        const monthlyPayment = (amount * annualRate) / 12;

        for (let m = 0; m < fixedYrs * 12; m++) {
            const monthlyInterest = balance * monthlyInterestRate;
            const monthlyPrincipal = monthlyPayment - monthlyInterest;
            balance = Math.max(0, balance - monthlyPrincipal);
        }
        return balance;
    };

    // Recalculates recommended repayment for refinancing
    const getRecommendedRepayment = (restschuld, newInterest, remainingYrs) => {
        if (restschuld <= 0 || remainingYrs <= 0) return 2.0;
        const i = (newInterest / 100) / 12;
        const n = remainingYrs * 12;

        if (i === 0) {
            // No interest, simple amortization
            return (1 / remainingYrs) * 100;
        }

        // Annuity formula: monthly payment to pay off loan in n months
        const monthlyPayment = restschuld * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        const annualAnnuity = monthlyPayment * 12;
        const totalAnnualRate = (annualAnnuity / restschuld) * 100;
        const recommendedRepayment = Math.max(0, totalAnnualRate - newInterest);
        return parseFloat(recommendedRepayment.toFixed(2));
    };

    // Load selected loan data
    useEffect(() => {
        if (selectedLoanId) {
            const loan = loans.find(l => l.id === selectedLoanId);
            if (loan) {
                const amount = parseFloat(loan.loan_amount) || 0;
                const interest = parseFloat(loan.interest_rate) || 0;
                
                // Determine repayment rate or calculate from fixed_annuity and interest
                let repayment = parseFloat(loan.initial_repayment_rate) || 0;
                if (!repayment && loan.fixed_annuity && amount) {
                    const annualAnnuity = parseFloat(loan.fixed_annuity) * 12;
                    const totalAnnualRate = (annualAnnuity / amount) * 100;
                    repayment = Math.max(0, totalAnnualRate - interest);
                }

                // Calculate planned total amortization years
                const totalYrs = calculateFullAmortizationTerm(amount, interest, repayment, loan.fixed_annuity);

                setRefinancingInputs(prev => ({
                    ...prev,
                    loanAmount: amount,
                    interestRate: parseFloat(interest.toFixed(2)),
                    repaymentRate: parseFloat(repayment.toFixed(2)),
                    startDate: loan.start_date || new Date().toISOString().split('T')[0],
                    endDate: loan.end_date || new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString().split('T')[0],
                    totalYears: totalYrs,
                }));
            }
        }
    }, [selectedLoanId, loans]);

    const refRestschuld = getRestschuldFromInputs(refinancingInputs, selectedLoan);

    // Calculate fixedYears based on date inputs
    const getYearsBetween = (startDateStr, endDateStr) => {
        const start = new Date(startDateStr);
        const end = new Date(endDateStr);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 10;
        return (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    };

    const fixedYrs = getYearsBetween(refinancingInputs.startDate, refinancingInputs.endDate);
    const refRemainingYears = Math.max(1, refinancingInputs.totalYears - fixedYrs);
    const refRecommendedRepayment = getRecommendedRepayment(refRestschuld, refinancingInputs.newInterestRate, refRemainingYears);

    // Automatically sync newRepaymentRate to refRecommendedRepayment
    useEffect(() => {
        setRefinancingInputs(prev => ({
            ...prev,
            newRepaymentRate: refRecommendedRepayment
        }));
    }, [refRecommendedRepayment]);

    // Original monthly payment
    let refOriginalMonthly = 0;
    if (selectedLoan && selectedLoan.fixed_annuity) {
        refOriginalMonthly = parseFloat(selectedLoan.fixed_annuity);
    } else {
        refOriginalMonthly = (refinancingInputs.loanAmount * ((refinancingInputs.interestRate / 100) + (refinancingInputs.repaymentRate / 100))) / 12;
    }
    const refNewMonthly = (refRestschuld * ((refinancingInputs.newInterestRate / 100) + (refinancingInputs.newRepaymentRate / 100))) / 12;
    const refCashflowImpact = refOriginalMonthly - refNewMonthly; // Positive means we save money

    const refMonthsAmortizeSzenario = getMonthsToAmortize(refRestschuld, refinancingInputs.newInterestRate, refinancingInputs.newRepaymentRate);
    const refFullyPaidOffDate = getFullyPaidOffDate(refinancingInputs.endDate, refMonthsAmortizeSzenario);

    /* ─── 2. RENT INCREASE CALCULATIONS ─── */
    const rentUnitsList = useMemo(() => {
        if (!selectedPropertyId) return [];
        if (selectedPropertyId.startsWith('prop_')) {
            const propId = selectedPropertyId.replace('prop_', '');
            const prop = properties.find(p => String(p.id) === propId);
            return prop ? (prop.units || []) : [];
        } else if (selectedPropertyId.startsWith('we_')) {
            const weId = selectedPropertyId.replace('we_', '');
            const weProps = properties.filter(p => String(p.economic_unit_id) === weId);
            return weProps.flatMap(p => p.units || []);
        }
        return [];
    }, [selectedPropertyId, properties]);

    // Load selected property/economic unit data or selected unit/flat data
    useEffect(() => {
        if (!selectedPropertyId) {
            setRentInputs(prev => ({
                ...prev,
                size: 80,
                currentRent: 600,
                marketValue: 180000,
                targetRent: 600 * (1 + prev.cappingLimit / 100)
            }));
            return;
        }

        let size = 0;
        let currentRent = 0;
        let marketValue = 0;

        // 1. Calculate market value from the loaded property or economic unit
        if (selectedPropertyId.startsWith('prop_')) {
            const propId = selectedPropertyId.replace('prop_', '');
            const prop = properties.find(p => String(p.id) === propId);
            if (prop) {
                marketValue = parseFloat(prop.market_value_total) || parseFloat(prop.total_investment_cost) || 0;
            }
        } else if (selectedPropertyId.startsWith('we_')) {
            const weId = selectedPropertyId.replace('we_', '');
            const weProps = properties.filter(p => String(p.economic_unit_id) === weId);
            marketValue = weProps.reduce((sum, p) => sum + (parseFloat(p.market_value_total) || parseFloat(p.total_investment_cost) || 0), 0);
        }

        // 2. If a specific unit/flat is selected
        if (selectedUnitId) {
            const unit = rentUnitsList.find(u => String(u.id) === selectedUnitId);
            if (unit) {
                size = parseFloat(unit.sqm) || 0;
                if (unit.is_vacation_rental) {
                    currentRent = parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0;
                } else {
                    const activeLease = unit.leases?.find(l => l.status === 'active');
                    currentRent = activeLease ? parseFloat(activeLease.cold_rent) : (parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0);
                }
            }
        } else {
            // 3. Otherwise calculate for the entire selected property or economic unit
            if (selectedPropertyId.startsWith('prop_')) {
                const propId = selectedPropertyId.replace('prop_', '');
                const prop = properties.find(p => String(p.id) === propId);
                if (prop) {
                    size = prop.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                    prop.units?.forEach(u => {
                        if (u.is_vacation_rental) {
                            currentRent += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                        } else {
                            const activeLease = u.leases?.find(l => l.status === 'active');
                            currentRent += activeLease ? parseFloat(activeLease.cold_rent) : (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
                        }
                    });
                }
            } else if (selectedPropertyId.startsWith('we_')) {
                const weId = selectedPropertyId.replace('we_', '');
                const weProps = properties.filter(p => String(p.economic_unit_id) === weId);
                weProps.forEach(p => {
                    size += p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                    p.units?.forEach(u => {
                        if (u.is_vacation_rental) {
                            currentRent += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                        } else {
                            const activeLease = u.leases?.find(l => l.status === 'active');
                            currentRent += activeLease ? parseFloat(activeLease.cold_rent) : (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
                        }
                    });
                });
            }
        }

        setRentInputs(prev => ({
            ...prev,
            size: size || 80,
            currentRent: currentRent || 600,
            marketValue: marketValue || 180000,
            targetRent: currentRent ? currentRent * (1 + prev.cappingLimit / 100) : 600 * (1 + prev.cappingLimit / 100)
        }));
    }, [selectedPropertyId, selectedUnitId, properties, economicUnits, rentUnitsList]);

    const rentCurrentSqm = rentInputs.size > 0 ? rentInputs.currentRent / rentInputs.size : 0;
    const rentTargetSqm = rentInputs.size > 0 ? rentInputs.targetRent / rentInputs.size : 0;
    const rentIncreaseAbsolute = Math.max(0, rentInputs.targetRent - rentInputs.currentRent);
    const rentIncreasePercent = rentInputs.currentRent > 0 ? (rentIncreaseAbsolute / rentInputs.currentRent) * 100 : 0;
    
    // Capping Limit calculation
    const maxRentAllowed = rentInputs.currentRent * (1 + rentInputs.cappingLimit / 100);
    const isAboveCap = rentInputs.targetRent > maxRentAllowed;

    // Calculate total object stats for yield and factor calculations (always based on entire object/WE)
    const objectStats = useMemo(() => {
        if (!selectedPropertyId) {
            return {
                marketValue: rentInputs.marketValue,
                currentRent: rentInputs.currentRent,
                targetRent: rentInputs.targetRent
            };
        }

        let totalMarketValue = 0;
        let totalCurrentRent = 0;

        if (selectedPropertyId.startsWith('prop_')) {
            const propId = selectedPropertyId.replace('prop_', '');
            const prop = properties.find(p => String(p.id) === propId);
            if (prop) {
                totalMarketValue = parseFloat(prop.market_value_total) || parseFloat(prop.total_investment_cost) || 0;
            }
        } else if (selectedPropertyId.startsWith('we_')) {
            const weId = selectedPropertyId.replace('we_', '');
            const weProps = properties.filter(p => String(p.economic_unit_id) === weId);
            totalMarketValue = weProps.reduce((sum, p) => sum + (parseFloat(p.market_value_total) || parseFloat(p.total_investment_cost) || 0), 0);
        }

        rentUnitsList.forEach(u => {
            if (u.is_vacation_rental) {
                totalCurrentRent += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
            } else {
                const activeLease = u.leases?.find(l => l.status === 'active');
                totalCurrentRent += activeLease ? parseFloat(activeLease.cold_rent) : (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
            }
        });

        const totalTargetRent = totalCurrentRent + rentIncreaseAbsolute;

        return {
            marketValue: totalMarketValue || rentInputs.marketValue,
            currentRent: totalCurrentRent || rentInputs.currentRent,
            targetRent: totalTargetRent
        };
    }, [selectedPropertyId, rentUnitsList, rentIncreaseAbsolute, rentInputs.currentRent, rentInputs.targetRent, rentInputs.marketValue, properties]);

    // Yield Boost calculations based on entire object/WE
    const yieldCurrent = objectStats.marketValue > 0 ? (objectStats.currentRent * 12 / objectStats.marketValue) * 100 : 0;
    const yieldTarget = objectStats.marketValue > 0 ? (objectStats.targetRent * 12 / objectStats.marketValue) * 100 : 0;
    const currentFactor = (objectStats.currentRent * 12) > 0 ? objectStats.marketValue / (objectStats.currentRent * 12) : 0;
    const calculatedValueAppreciation = rentIncreaseAbsolute * 12 * currentFactor;

    /* ─── 3. MODERNIZATION CALCULATIONS ─── */
    const modLevyTheoreticalAnnual = modInputs.modCosts * (modInputs.levyRate / 100);
    const modLevyTheoreticalMonthly = modLevyTheoreticalAnnual / 12;
    const modLevyTheoreticalMonthlySqm = modInputs.size > 0 ? modLevyTheoreticalMonthly / modInputs.size : 0;
    
    // Apply capping limit
    const modLevyAppliedMonthlySqm = Math.min(modLevyTheoreticalMonthlySqm, modInputs.cappingLimit);
    const modLevyAppliedMonthly = modLevyAppliedMonthlySqm * modInputs.size;
    
    const modAmortizationYears = modLevyAppliedMonthly > 0 ? modInputs.modCosts / (modLevyAppliedMonthly * 12) : 0;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '24px', minHeight: '500px' }}>
            
            {/* Sidebar Navigation */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid var(--border-color)', paddingRight: '16px' }}>
                <button
                    onClick={() => setActiveSubTab('refinancing')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px 16px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
                        backgroundColor: activeSubTab === 'refinancing' ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
                        color: activeSubTab === 'refinancing' ? '#0ea5e9' : 'var(--text-secondary)',
                        transition: 'all 0.2s'
                    }}
                >
                    <RefreshCw size={16} className={activeSubTab === 'refinancing' ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
                    Anschlussfinanzierung
                </button>
                
                <button
                    onClick={() => setActiveSubTab('rent_increase')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px 16px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
                        backgroundColor: activeSubTab === 'rent_increase' ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
                        color: activeSubTab === 'rent_increase' ? '#0ea5e9' : 'var(--text-secondary)',
                        transition: 'all 0.2s'
                    }}
                >
                    <TrendingUp size={16} />
                    Mieterhöhungs-Simulator
                </button>
                
                <button
                    onClick={() => setActiveSubTab('modernization')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px 16px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem',
                        backgroundColor: activeSubTab === 'modernization' ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
                        color: activeSubTab === 'modernization' ? '#0ea5e9' : 'var(--text-secondary)',
                        transition: 'all 0.2s'
                    }}
                >
                    <Calculator size={16} />
                    Modernisierungsumlage
                </button>
            </div>

            {/* Calculator Display Panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* TAB 1: REFINANCING */}
                {activeSubTab === 'refinancing' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        
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
                                            onChange={e => setSelectedLoanId(e.target.value)}
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
                                                        {addr} - {loan.bank_name || 'Bank'} ({formatCurrency(loan.loan_amount)})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <CurrencyField
                                            label="Darlehensbetrag (€)"
                                            value={refinancingInputs.loanAmount}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, loanAmount: parseFloat(v) || 0 }))}
                                        />
                                        <PercentField
                                            label="Sollzins p.a. (%)"
                                            value={refinancingInputs.interestRate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, interestRate: parseFloat(v) || 0 }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <DateField
                                            label="Startdatum / Tilgungsbeginn"
                                            value={refinancingInputs.startDate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, startDate: v }))}
                                        />
                                        <PercentField
                                            label="Anfangstilgung p.a. (%)"
                                            value={refinancingInputs.repaymentRate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, repaymentRate: parseFloat(v) || 0 }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <DateField
                                                label="Zinsende"
                                                value={refinancingInputs.endDate}
                                                onChange={v => setRefinancingInputs(prev => ({ ...prev, endDate: v }))}
                                            />
                                            {fixedYrs > 0 && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', fontWeight: 500 }}>
                                                    ⏱️ Zinsbindung: {fixedYrs.toFixed(1)} Jahre
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <NumberField
                                                label="Geplante Gesamtlaufzeit (Jahre)"
                                                value={refinancingInputs.totalYears}
                                                onChange={v => setRefinancingInputs(prev => ({ ...prev, totalYears: parseInt(v) || 25 }))}
                                            />
                                            {selectedLoan && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', fontWeight: 500 }}>
                                                    📊 Aus aktuellem Tilgungsplan berechnet
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>

                            <Card title="Anschlussfinanzierung (Szenario)">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <PercentField
                                            label="Neuer Zinssatz (%)"
                                            value={refinancingInputs.newInterestRate}
                                            onChange={v => setRefinancingInputs(prev => ({ ...prev, newInterestRate: parseFloat(v) || 0 }))}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <PercentField
                                                label="Neue Tilgung (%)"
                                                value={refinancingInputs.newRepaymentRate}
                                                onChange={v => setRefinancingInputs(prev => ({ ...prev, newRepaymentRate: parseFloat(v) || 0 }))}
                                            />
                                            {refRestschuld > 0 && (
                                                <button
                                                    onClick={() => setRefinancingInputs(prev => ({ ...prev, newRepaymentRate: refRecommendedRepayment }))}
                                                    style={{
                                                        backgroundColor: 'var(--background-color)', border: '1px solid var(--primary-color)',
                                                        color: 'var(--primary-color)', padding: '2px 6px', borderRadius: '4px',
                                                        fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left', fontWeight: 600,
                                                        marginTop: '2px', display: 'inline-block', width: 'fit-content'
                                                    }}
                                                >
                                                    💡 Empfehlung: {refRecommendedRepayment}%
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                    <div style={{ padding: '14px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                            Restschuld zum Zinsende (nach {fixedYrs.toFixed(1)} Jahren)
                                        </div>
                                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary-color)' }}>
                                            {formatCurrency(refRestschuld)}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Getilgt: {formatPercent((1 - (refRestschuld / refinancingInputs.loanAmount)) * 100)} ({formatCurrency(refinancingInputs.loanAmount - refRestschuld)})
                                        </div>
                                    </div>

                                    {refFullyPaidOffDate && (
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
                                    )}

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
                                        Um das Darlehen in den verbleibenden <strong>{formatYearsAndMonths(refRemainingYears)}</strong> komplett abzuzahlen, empfiehlt sich bei einem Zins von {refinancingInputs.newInterestRate}% eine Anfangstilgung von <strong>{refRecommendedRepayment}%</strong>.
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </div>
                )}

                {/* TAB 2: RENT INCREASE */}
                {activeSubTab === 'rent_increase' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        
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
                                                    let weTotalRent = 0;
                                                    weProps.forEach(p => {
                                                        p.units?.forEach(u => {
                                                            if (u.is_vacation_rental) {
                                                                weTotalRent += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                                                            } else {
                                                                const activeLease = u.leases?.find(l => l.status === 'active');
                                                                if (activeLease) weTotalRent += parseFloat(activeLease.cold_rent) || 0;
                                                            }
                                                        });
                                                    });
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
                                                    let totalRent = 0;
                                                    (p.units || []).forEach(u => {
                                                        if (u.is_vacation_rental) {
                                                            totalRent += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                                                        } else {
                                                            const activeLease = u.leases?.find(l => l.status === 'active');
                                                            if (activeLease) totalRent += parseFloat(activeLease.cold_rent) || 0;
                                                        }
                                                    });
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
                                                onChange={e => setSelectedUnitId(e.target.value)}
                                                style={{
                                                    padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                    backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem'
                                                }}
                                            >
                                                <option value="">— Gesamtes Objekt —</option>
                                                {rentUnitsList.map(u => {
                                                    let uRent = 0;
                                                    if (u.is_vacation_rental) {
                                                        uRent = parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                                                    } else {
                                                        const activeLease = u.leases?.find(l => l.status === 'active');
                                                        uRent = activeLease ? parseFloat(activeLease.cold_rent) : (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
                                                    }
                                                    return (
                                                        <option key={u.id} value={u.id}>
                                                            Wohnung: {u.unit_name || u.unit_number || '–'} ({u.sqm} m², IST: {formatCurrency(uRent)})
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <NumberField
                                            label="Wohnfläche (m²)"
                                            value={rentInputs.size}
                                            onChange={v => setRentInputs(prev => ({ ...prev, size: parseFloat(v) || 0 }))}
                                            step="0.1"
                                        />
                                        <CurrencyField
                                            label="Kaltmiete IST (€ / Mo.)"
                                            value={rentInputs.currentRent}
                                            onChange={v => setRentInputs(prev => ({ ...prev, currentRent: parseFloat(v) || 0 }))}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <CurrencyField
                                            label="Immobilienwert / Marktpreis (€)"
                                            value={rentInputs.marketValue}
                                            onChange={v => setRentInputs(prev => ({ ...prev, marketValue: parseFloat(v) || 0 }))}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                Mieterhöhung (%)
                                            </label>
                                            <select
                                                value={rentInputs.cappingLimit}
                                                onChange={e => {
                                                    const pct = parseInt(e.target.value) || 15;
                                                    setRentInputs(prev => ({
                                                        ...prev,
                                                        cappingLimit: pct,
                                                        targetRent: prev.currentRent * (1 + pct / 100)
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
                                                <option value="25">25% Erhöhung</option>
                                                <option value="30">30% Erhöhung</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </Card>

                            <Card title="Mieterhöhung (Soll)">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <CurrencyField
                                            label="Neue Miete SOLL (€ / Mo.)"
                                            value={rentInputs.targetRent}
                                            onChange={v => setRentInputs(prev => ({ ...prev, targetRent: parseFloat(v) || 0 }))}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                Soll-Miete pro m² (€)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={parseFloat(rentTargetSqm.toFixed(2))}
                                                onChange={e => {
                                                    const sqmVal = parseFloat(e.target.value) || 0;
                                                    setRentInputs(prev => ({ ...prev, targetRent: sqmVal * prev.size }));
                                                }}
                                                style={{
                                                    padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                                                    backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)', width: '100%'
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* RESULTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Auswertungen & Hebel">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                    


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
                                                +{formatCurrency(rentIncreaseAbsolute)}
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
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px' }}>{yieldCurrent.toFixed(2)}%</div>
                                        </div>
                                        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', backgroundColor: 'rgba(14, 165, 233, 0.03)' }}>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Bruttorendite SOLL</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '4px', color: '#0ea5e9' }}>{yieldTarget.toFixed(2)}%</div>
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        
                        {/* INPUTS PANEL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card title="Modernisierungs-Kosten">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <CurrencyField
                                        label="Modernisierungskosten (€)"
                                        value={modInputs.modCosts}
                                        onChange={v => setModInputs(prev => ({ ...prev, modCosts: parseFloat(v) || 0 }))}
                                    />
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <NumberField
                                            label="Wohnfläche (m²)"
                                            value={modInputs.size}
                                            onChange={v => setModInputs(prev => ({ ...prev, size: parseFloat(v) || 0 }))}
                                            step="0.1"
                                        />
                                        <PercentField
                                            label="Umlagesatz p.a. (%)"
                                            value={modInputs.levyRate}
                                            onChange={v => setModInputs(prev => ({ ...prev, levyRate: parseFloat(v) || 8 }))}
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

const CurrencyField = ({ label, value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState(String(value));
    const inputRef = useRef(null);

    useEffect(() => {
        if (!editing) setRaw(String(value));
    }, [value, editing]);

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

const NumberField = ({ label, value, onChange, step = '1' }) => {
    const inputRef = useRef(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
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

const PercentField = ({ label, value, onChange }) => {
    const inputRef = useRef(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
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
