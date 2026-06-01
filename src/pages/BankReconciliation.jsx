import React, { useState, useEffect, useMemo } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import CurrencyInput from '../components/ui/CurrencyInput';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import { 
    Plus, Loader2, ArrowUpRight, ArrowDownLeft, Check, X, ShieldAlert,
    AlertCircle, Sparkles, Building2, User, CreditCard, RefreshCw, Key,
    Trash2, HelpCircle, Save, Settings, Layers, ListFilter
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';

const BankReconciliation = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    
    // Core data states
    const [connections, setConnections] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [rules, setRules] = useState([]);
    const [properties, setProperties] = useState([]);
    const [leases, setLeases] = useState([]);
    const [categories, setCategories] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [units, setUnits] = useState([]);
    const [rentPayments, setRentPayments] = useState([]);
    const [expenses, setExpenses] = useState([]);

    // UI control states
    const [showConnectModal, setShowConnectModal] = useState(false);
    const [connectStep, setConnectStep] = useState('bank-select'); // bank-select, login, success
    const [selectedBank, setSelectedBank] = useState('');
    const [loginUser, setLoginUser] = useState('sandbox_demo');
    const [loginPin, setLoginPin] = useState('•••••');
    const [activeTab, setActiveTab] = useState('transactions'); // transactions, rules
    const [manualMapTx, setManualMapTx] = useState(null); // transaction being manually mapped
    const [manualTargetType, setManualTargetType] = useState('income'); // income or expense

    // Prefilled Form States (matching Finance.jsx)
    const [incomeForm, setIncomeForm] = useState({
        payment_date: '',
        period_month: '',
        tenant_id: '',
        property_id: '',
        unit_id: '',
        amount: '',
        note: ''
    });
    const [expectedRentDisplay, setExpectedRentDisplay] = useState(null);

    const [expenseForm, setExpenseForm] = useState({
        booking_date: '',
        payee: '',
        category_id: '',
        category_custom: '',
        scope: 'general',
        property_id: '',
        unit_id: '',
        amount: '',
        is_allocatable: true,
        note: ''
    });

    const [showRuleToast, setShowRuleToast] = useState(null); // toast message

    // Notification toast helper
    const triggerToast = (message) => {
        setShowRuleToast(message);
        setTimeout(() => setShowRuleToast(null), 5000);
    };

    // Fetch initial databases
    const fetchData = async () => {
        if (!user) return;
        try {
            setLoading(true);
            
            // 1. Fetch properties
            const { data: propsData } = await supabase
                .from('properties')
                .select('*')
                .order('street');
            setProperties(propsData || []);

            // 2. Fetch active leases with units and tenants
            const { data: leasesData } = await supabase
                .from('leases')
                .select('*, unit:units(*, property:properties(*)), tenant:tenants(*)')
                .eq('status', 'active');
            setLeases(leasesData || []);

            // 3. Fetch expense categories
            const { data: catsData } = await supabase
                .from('expense_categories')
                .select('*')
                .order('name');
            setCategories(catsData || []);

            // 4. Fetch bank connections
            const { data: connData } = await supabase
                .from('bank_connections')
                .select('*')
                .eq('user_id', user.id);
            setConnections(connData || []);

            // 5. Fetch rules
            const { data: rulesData } = await supabase
                .from('bank_matching_rules')
                .select('*')
                .eq('user_id', user.id);
            setRules(rulesData || []);

            // 6. Fetch transactions
            const { data: txData } = await supabase
                .from('bank_transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('booking_date', { ascending: false });
            setTransactions(txData || []);

            // 7. Fetch tenants
            const { data: tenantsData } = await supabase
                .from('tenants')
                .select('*')
                .order('last_name');
            setTenants(tenantsData || []);

            // 8. Fetch units
            const { data: unitsData } = await supabase
                .from('units')
                .select('*')
                .order('unit_name');
            setUnits(unitsData || []);

            // 9. Fetch rent payments
            const { data: rentPaymentsData } = await supabase
                .from('rent_payments')
                .select('*')
                .eq('user_id', user.id);
            setRentPayments(rentPaymentsData || []);

            // 10. Fetch expenses
            const { data: expensesData } = await supabase
                .from('expenses')
                .select('*')
                .eq('user_id', user.id);
            setExpenses(expensesData || []);

        } catch (error) {
            console.error('Error loading bank reconciliation data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [user]);

    // Format currency helper
    const formatCurrency = (val) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val);
    };

    // Dynamic Form Units based on selected property
    const formUnits = useMemo(() => {
        const propId = manualTargetType === 'expense' ? expenseForm.property_id : incomeForm.property_id;
        if (!propId) return [];
        return units.filter(u => u.property_id === propId);
    }, [units, manualTargetType, expenseForm.property_id, incomeForm.property_id]);

    // Calculate match recommendations on the fly for pending transactions
    const matchRecommendations = useMemo(() => {
        return transactions.map(tx => {
            if (tx.status !== 'pending') {
                return { tx, type: tx.matched_type, targetId: tx.matched_target_id, confidence: 100, label: 'Bereits verbucht', matched: true };
            }

            const purposeLower = (tx.purpose || '').toLowerCase();
            const senderLower = (tx.counterpart_name || '').toLowerCase();
            const txDate = new Date(tx.booking_date);

            // A. Check if this is already manually booked (prevent duplicates)
            if (tx.amount > 0) {
                // Find matching rent payment
                // Try to find the recommended lease first
                let recommendedLeaseId = null;
                const matchedRule = rules.find(rule => {
                    if (rule.counterpart_iban && tx.counterpart_iban && rule.counterpart_iban.replace(/\s+/g, '') === tx.counterpart_iban.replace(/\s+/g, '')) return true;
                    if (rule.counterpart_name && tx.counterpart_name && tx.counterpart_name.toLowerCase().includes(rule.counterpart_name.toLowerCase())) return true;
                    if (rule.purpose_keyword && tx.purpose && tx.purpose.toLowerCase().includes(rule.purpose_keyword.toLowerCase())) return true;
                    return false;
                });
                if (matchedRule && matchedRule.target_type === 'income') {
                    recommendedLeaseId = matchedRule.target_id;
                } else {
                    let bestLease = null;
                    let maxScore = 0;
                    leases.forEach(lease => {
                        let score = 0;
                        const tenantLastName = (lease.tenant?.last_name || '').toLowerCase();
                        if (tenantLastName && (senderLower.includes(tenantLastName) || purposeLower.includes(tenantLastName))) score += 50;
                        if (score > maxScore) {
                            maxScore = score;
                            bestLease = lease;
                        }
                    });
                    if (bestLease && maxScore >= 30) {
                        recommendedLeaseId = bestLease.id;
                    }
                }

                // Look for payment
                let duplicatePayment = rentPayments.find(p => {
                    const matchAmount = Math.abs(p.amount - tx.amount) < 0.01;
                    if (!matchAmount) return false;
                    const pDate = new Date(p.payment_date);
                    const diffDays = Math.abs(txDate - pDate) / (1000 * 60 * 60 * 24);
                    if (diffDays > 10) return false;
                    if (recommendedLeaseId && p.lease_id === recommendedLeaseId) return true;
                    return false;
                });

                if (!duplicatePayment) {
                    // Generic check fallback with narrower window (5 days)
                    duplicatePayment = rentPayments.find(p => {
                        const matchAmount = Math.abs(p.amount - tx.amount) < 0.01;
                        if (!matchAmount) return false;
                        const pDate = new Date(p.payment_date);
                        const diffDays = Math.abs(txDate - pDate) / (1000 * 60 * 60 * 24);
                        return diffDays <= 5;
                    });
                }

                if (duplicatePayment) {
                    const lease = leases.find(l => l.id === duplicatePayment.lease_id);
                    return {
                        tx,
                        type: 'income',
                        targetId: duplicatePayment.lease_id,
                        confidence: 100,
                        alreadyBooked: true,
                        label: `Erfasste Miete: ${lease?.tenant?.last_name || 'Mieter'}`,
                        reason: `Eine Zahlung über ${formatCurrency(duplicatePayment.amount)} für ${lease?.tenant?.first_name || ''} ${lease?.tenant?.last_name || ''} wurde bereits am ${new Date(duplicatePayment.payment_date).toLocaleDateString('de-DE')} manuell gebucht.`,
                    };
                }
            } else {
                // Check outgoing expense duplicates
                let recommendedCategoryId = null;
                let recommendedPropertyId = null;
                const matchedRule = rules.find(rule => {
                    if (rule.counterpart_iban && tx.counterpart_iban && rule.counterpart_iban.replace(/\s+/g, '') === tx.counterpart_iban.replace(/\s+/g, '')) return true;
                    if (rule.counterpart_name && tx.counterpart_name && tx.counterpart_name.toLowerCase().includes(rule.counterpart_name.toLowerCase())) return true;
                    if (rule.purpose_keyword && tx.purpose && tx.purpose.toLowerCase().includes(rule.purpose_keyword.toLowerCase())) return true;
                    return false;
                });
                if (matchedRule && matchedRule.target_type === 'expense') {
                    recommendedCategoryId = matchedRule.target_id;
                    recommendedPropertyId = matchedRule.property_id;
                }

                let duplicateExpense = expenses.find(e => {
                    const matchAmount = Math.abs(e.amount - Math.abs(tx.amount)) < 0.01;
                    if (!matchAmount) return false;
                    const eDate = new Date(e.booking_date);
                    const diffDays = Math.abs(txDate - eDate) / (1000 * 60 * 60 * 24);
                    if (diffDays > 10) return false;
                    if (recommendedCategoryId && e.category_id === recommendedCategoryId) return true;
                    if (recommendedPropertyId && e.property_id === recommendedPropertyId) return true;
                    const ePayeeLower = (e.payee || '').toLowerCase();
                    if (ePayeeLower && senderLower && (senderLower.includes(ePayeeLower) || ePayeeLower.includes(senderLower))) return true;
                    return false;
                });

                if (!duplicateExpense) {
                    duplicateExpense = expenses.find(e => {
                        const matchAmount = Math.abs(e.amount - Math.abs(tx.amount)) < 0.01;
                        if (!matchAmount) return false;
                        const eDate = new Date(e.booking_date);
                        const diffDays = Math.abs(txDate - eDate) / (1000 * 60 * 60 * 24);
                        return diffDays <= 3;
                    });
                }

                if (duplicateExpense) {
                    const cat = categories.find(c => c.id === duplicateExpense.category_id);
                    const prop = properties.find(p => p.id === duplicateExpense.property_id);
                    return {
                        tx,
                        type: 'expense',
                        targetId: duplicateExpense.category_id || null,
                        propertyId: duplicateExpense.property_id || null,
                        unitId: duplicateExpense.unit_id || null,
                        confidence: 100,
                        alreadyBooked: true,
                        label: `Erfasste Ausgabe (${cat?.name || 'Kategorie'})`,
                        reason: `Ausgabe über ${formatCurrency(duplicateExpense.amount)} (${duplicateExpense.payee || 'Unbekannt'}) am ${new Date(duplicateExpense.booking_date).toLocaleDateString('de-DE')} wurde bereits verbucht.`,
                    };
                }
            }

            // 1. Check rules database (highest priority / learned intelligence)
            const matchedRule = rules.find(rule => {
                // Match by IBAN
                if (rule.counterpart_iban && tx.counterpart_iban && rule.counterpart_iban.replace(/\s+/g, '') === tx.counterpart_iban.replace(/\s+/g, '')) {
                    return true;
                }
                // Match by name keyword
                if (rule.counterpart_name && tx.counterpart_name && tx.counterpart_name.toLowerCase().includes(rule.counterpart_name.toLowerCase())) {
                    return true;
                }
                // Match by purpose keyword
                if (rule.purpose_keyword && tx.purpose && tx.purpose.toLowerCase().includes(rule.purpose_keyword.toLowerCase())) {
                    return true;
                }
                return false;
            });

            if (matchedRule) {
                if (matchedRule.target_type === 'income') {
                    const lease = leases.find(l => l.id === matchedRule.target_id);
                    if (lease) {
                        return {
                            tx,
                            type: 'income',
                            targetId: lease.id,
                            propertyId: matchedRule.property_id || lease.unit?.property_id || null,
                            unitId: matchedRule.unit_id || lease.unit_id || null,
                            confidence: 100,
                            label: `Miete: ${lease.tenant?.last_name || 'Mieter'} (${lease.unit?.unit_name || 'Einheit'})`,
                            reason: 'Gelernt aus Ihren vorherigen Zuordnungen (IBAN / Name)',
                            rule: matchedRule
                        };
                    }
                } else if (matchedRule.target_type === 'expense') {
                    const cat = categories.find(c => c.id === matchedRule.target_id);
                    const prop = properties.find(p => p.id === matchedRule.property_id);
                    return {
                        tx,
                        type: 'expense',
                        targetId: matchedRule.target_id,
                        propertyId: matchedRule.property_id,
                        unitId: matchedRule.unit_id,
                        confidence: 100,
                        label: `Ausgabe: ${cat?.name || 'Kategorie'} (${prop ? prop.street : 'Allgemein'})`,
                        reason: 'Gelernt aus Ihren vorherigen Zuordnungen (Name / Betreff)',
                        rule: matchedRule
                    };
                }
            }

            // Heuristics matching (AI suggestions)

            // Case A: Mieteingänge (positive amounts)
            if (tx.amount > 0) {
                let bestLease = null;
                let maxScore = 0;
                let reason = '';

                leases.forEach(lease => {
                    let score = 0;
                    const tenantLastName = (lease.tenant?.last_name || '').toLowerCase();
                    const tenantFirstName = (lease.tenant?.first_name || '').toLowerCase();

                    // Check name match
                    if (tenantLastName && (senderLower.includes(tenantLastName) || purposeLower.includes(tenantLastName))) {
                        score += 50;
                    }
                    if (tenantFirstName && (senderLower.includes(tenantFirstName) || purposeLower.includes(tenantFirstName))) {
                        score += 20;
                    }

                    // Check exact rent amount match
                    const expectedTotal = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
                    if (Math.abs(expectedTotal - tx.amount) < 1.0) {
                        score += 30;
                    }

                    // Check unit name / street matching in purpose
                    const streetName = (lease.unit?.property?.street || '').toLowerCase();
                    if (streetName && purposeLower.includes(streetName)) {
                        score += 15;
                    }

                    if (score > maxScore) {
                        maxScore = score;
                        bestLease = lease;
                        if (score >= 80) reason = 'Name, Betrag & Mietvertrag stimmen überein';
                        else if (score >= 50) reason = 'Mietername im Verwendungszweck oder Absender gefunden';
                        else reason = 'Übereinstimmender Betrag & grober Namensbezug';
                    }
                });

                if (bestLease && maxScore >= 30) {
                    return {
                        tx,
                        type: 'income',
                        targetId: bestLease.id,
                        propertyId: bestLease.unit?.property_id || null,
                        unitId: bestLease.unit_id || null,
                        confidence: Math.min(maxScore, 95),
                        label: `Miete: ${bestLease.tenant?.last_name || 'Mieter'} (${bestLease.unit?.unit_name || 'Einheit'})`,
                        reason
                    };
                }
            }

            // Case B: Betriebskosten / Rechnungen (negative amounts)
            if (tx.amount < 0) {
                let bestCategory = null;
                let bestProperty = null;
                let score = 0;
                let label = '';
                let reason = '';

                // Heuristic matches for common utility companies or recurring expenses in Germany
                if (senderLower.includes('stadtwerke') || purposeLower.includes('wasser') || purposeLower.includes('abwasser')) {
                    bestCategory = categories.find(c => c.name.toLowerCase().includes('wasser') || c.name.toLowerCase().includes('betriebskosten'));
                    score = 80;
                    label = 'Wasser / Abwasser';
                    reason = 'Absender weist auf Stadtwerke/Wasser hin';
                } else if (senderLower.includes('energie') || senderLower.includes('strom') || purposeLower.includes('strom') || senderLower.includes('e.on')) {
                    bestCategory = categories.find(c => c.name.toLowerCase().includes('strom') || c.name.toLowerCase().includes('energie'));
                    score = 80;
                    label = 'Heizung / Allgemeinstrom';
                    reason = 'Absender weist auf Energieversorger hin';
                } else if (senderLower.includes('schornsteinfeger') || purposeLower.includes('schornstein') || purposeLower.includes('kehrer')) {
                    bestCategory = categories.find(c => c.name.toLowerCase().includes('schornstein') || c.name.toLowerCase().includes('wartung'));
                    score = 90;
                    label = 'Schornsteinfeger';
                    reason = 'Schlagwort im Absender / Verwendungszweck';
                } else if (senderLower.includes('versicherung') || purposeLower.includes('gebäudeversicherung')) {
                    bestCategory = categories.find(c => c.name.toLowerCase().includes('versicherung'));
                    score = 85;
                    label = 'Versicherung';
                    reason = 'Schlagwort Gebäudeversicherung';
                } else if (senderLower.includes('müll') || purposeLower.includes('abfall') || purposeLower.includes('entsorgung')) {
                    bestCategory = categories.find(c => c.name.toLowerCase().includes('müll') || c.name.toLowerCase().includes('abfall'));
                    score = 80;
                    label = 'Müllabfuhr / Straßenreinigung';
                    reason = 'Entsorgungsschlagwort gefunden';
                }

                // Match property by looking at street keywords in purpose
                properties.forEach(p => {
                    const streetKeyword = (p.street || '').split(' ')[0].toLowerCase();
                    if (streetKeyword && streetKeyword.length > 3 && purposeLower.includes(streetKeyword)) {
                        bestProperty = p;
                        score += 10;
                    }
                });

                if (bestCategory) {
                    return {
                        tx,
                        type: 'expense',
                        targetId: bestCategory.id,
                        propertyId: bestProperty?.id || null,
                        confidence: Math.min(score, 95),
                        label: `Betriebskosten: ${bestCategory.name} (${bestProperty ? bestProperty.street : 'Allgemein'})`,
                        reason: reason + (bestProperty ? ` • Immobilie ${bestProperty.street} erkannt` : '')
                    };
                }
            }

            return { tx, type: null, targetId: null, confidence: 0, label: 'Kein eindeutiger Treffer', reason: 'Keine passenden Regeln oder Namensübereinstimmungen gefunden' };
        });
    }, [transactions, rules, leases, categories, properties, rentPayments, expenses]);

    // Trigger Sandbox Mock connection flow via FinAPI
    const connectSandboxBank = async () => {
        setActionLoading(true);
        try {
            // 1. Create a mock connection
            const { data: conn, error: connErr } = await supabase
                .from('bank_connections')
                .insert([{
                    user_id: user.id,
                    bank_name: selectedBank || 'FinAPI Sandbox Bank',
                    account_id: 'acc_' + Math.random().toString(36).substring(2, 9),
                    account_name: 'Geschäftskonto Haupt',
                    iban: 'DE89 3704 0044 0532 9912 00',
                    balance: 14850.42,
                    status: 'active'
                }])
                .select()
                .single();

            if (connErr) throw connErr;

            // 2. Generate 5 realistic transactions to match
            const mockTxData = [
                {
                    user_id: user.id,
                    connection_id: conn.id,
                    transaction_id: 'tx_finapi_' + Math.random().toString(36).substring(2, 9),
                    booking_date: new Date().toISOString().split('T')[0],
                    value_date: new Date().toISOString().split('T')[0],
                    amount: 600.00,
                    purpose: 'Miete EG Friedhofstraße - Max Mustermann',
                    counterpart_name: 'Max Mustermann',
                    counterpart_iban: 'DE24 3007 0024 1822 9310 01',
                    status: 'pending'
                },
                {
                    user_id: user.id,
                    connection_id: conn.id,
                    transaction_id: 'tx_finapi_' + Math.random().toString(36).substring(2, 9),
                    booking_date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
                    value_date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
                    amount: -128.50,
                    purpose: 'Rechn. 83921 - Abschlag Wasser Friedhofstraße 34',
                    counterpart_name: 'Stadtwerke Zweibrücken GmbH',
                    counterpart_iban: 'DE59 3405 0000 0012 3456 00',
                    status: 'pending'
                },
                {
                    user_id: user.id,
                    connection_id: conn.id,
                    transaction_id: 'tx_finapi_' + Math.random().toString(36).substring(2, 9),
                    booking_date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
                    value_date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
                    amount: 850.00,
                    purpose: 'MIETE SCHMIDT 1. OG RECHTS',
                    counterpart_name: 'Sabine Schmidt',
                    counterpart_iban: 'DE43 5005 0000 9382 1022 00',
                    status: 'pending'
                },
                {
                    user_id: user.id,
                    connection_id: conn.id,
                    transaction_id: 'tx_finapi_' + Math.random().toString(36).substring(2, 9),
                    booking_date: new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0],
                    value_date: new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0],
                    amount: -340.00,
                    purpose: 'Gebaeudeversicherung Police 3918-B',
                    counterpart_name: 'Allianz SE',
                    counterpart_iban: 'DE12 2003 0000 0987 6543 21',
                    status: 'pending'
                },
                {
                    user_id: user.id,
                    connection_id: conn.id,
                    transaction_id: 'tx_finapi_' + Math.random().toString(36).substring(2, 9),
                    booking_date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
                    value_date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
                    amount: 450.00,
                    purpose: 'Miete - WE 101 Mayr',
                    counterpart_name: 'Susanne Mayr',
                    counterpart_iban: 'DE89 6005 0000 1122 3344 55',
                    status: 'pending'
                }
            ];

            const { error: txErr } = await supabase
                .from('bank_transactions')
                .insert(mockTxData);

            if (txErr) throw txErr;

            triggerToast('Bankkonto erfolgreich via FinAPI verbunden! Mockdaten geladen.');
            setConnectStep('success');
            fetchData();
        } catch (error) {
            console.error('Error inserting mock connection:', error);
            alert('Fehler beim Verbinden der Sandbox Bank: ' + error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Link transaction to existing manual ledger record (without double posting)
    const handleLinkExisting = async (txId, type, targetId) => {
        setActionLoading(true);
        try {
            const { error } = await supabase
                .from('bank_transactions')
                .update({
                    status: 'matched',
                    matched_type: type,
                    matched_target_id: targetId
                })
                .eq('id', txId);

            if (error) throw error;
            triggerToast('Buchung erfolgreich mit bestehendem Eintrag verknüpft (kein Duplikat erstellt).');
            fetchData();
        } catch (error) {
            console.error('Error linking transaction:', error);
            alert('Fehler beim Verknüpfen: ' + error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Confirm matching suggestion (Create Ledger / Expense booking)
    const handleConfirmMatch = async (recommendation) => {
        const { tx, type, targetId, propertyId, unitId } = recommendation;
        if (!type || !targetId) return;

        setActionLoading(true);
        try {
            if (type === 'income') {
                // Post rent payment
                const { error: rentErr } = await supabase
                    .from('rent_payments')
                    .insert([{
                        user_id: user.id,
                        lease_id: targetId,
                        payment_date: tx.booking_date,
                        amount: Math.abs(parseFloat(tx.amount)),
                        note: `Automatischer Bankabgleich FinAPI - ${tx.purpose}`
                    }]);

                if (rentErr) throw rentErr;

            } else if (type === 'expense') {
                // Post operational costs/expense
                const { error: expErr } = await supabase
                    .from('expenses')
                    .insert([{
                        user_id: user.id,
                        booking_date: tx.booking_date,
                        payee: tx.counterpart_name || 'Unbekannt',
                        category_id: targetId,
                        property_id: propertyId,
                        unit_id: unitId || null,
                        amount: Math.abs(parseFloat(tx.amount)),
                        is_allocatable: true,
                        note: `Automatischer Bankabgleich FinAPI - ${tx.purpose}`
                    }]);

                if (expErr) throw expErr;
            }

            // Update bank transaction status to matched
            const { error: txUpdateErr } = await supabase
                .from('bank_transactions')
                .update({
                    status: 'matched',
                    matched_type: type,
                    matched_target_id: targetId
                })
                .eq('id', tx.id);

            if (txUpdateErr) throw txUpdateErr;

            // Learn Rule: Save complete reference to learning rules database
            const ruleExists = rules.some(r => 
                (r.counterpart_iban && tx.counterpart_iban && r.counterpart_iban === tx.counterpart_iban) ||
                (r.counterpart_name && tx.counterpart_name && r.counterpart_name === tx.counterpart_name)
            );

            if (!ruleExists) {
                await supabase
                    .from('bank_matching_rules')
                    .insert([{
                        user_id: user.id,
                        counterpart_name: tx.counterpart_name,
                        counterpart_iban: tx.counterpart_iban,
                        purpose_keyword: tx.purpose ? tx.purpose.split(' ').slice(0, 2).join(' ') : null,
                        target_type: type,
                        target_id: targetId,
                        property_id: propertyId || null,
                        unit_id: unitId || null
                    }]);
                
                triggerToast(`Intelligente Buchungsregel für "${tx.counterpart_name || 'Zahler'}" gelernt!`);
            } else {
                triggerToast('Zahlung erfolgreich verbucht.');
            }

            fetchData();
        } catch (error) {
            console.error('Error confirming match:', error);
            alert('Fehler beim Buchen des Abgleichs: ' + error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Ignore transaction
    const handleIgnoreTransaction = async (txId) => {
        try {
            const { error } = await supabase
                .from('bank_transactions')
                .update({ status: 'ignored' })
                .eq('id', txId);
            if (error) throw error;
            triggerToast('Buchung ignoriert.');
            fetchData();
        } catch (error) {
            alert('Fehler: ' + error.message);
        }
    };

    // Tenant change handler to update prefilled fields
    const handleTenantChange = (e) => {
        const newTenantId = e.target.value;
        setIncomeForm(prev => {
            const newData = { ...prev, tenant_id: newTenantId };

            if (newTenantId) {
                const today = new Date().toISOString().split('T')[0];
                const activeLease = leases.find(l =>
                    l.tenant_id === newTenantId &&
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );

                if (activeLease && activeLease.unit) {
                    newData.property_id = activeLease.unit.property_id;
                    newData.unit_id = activeLease.unit_id;

                    const totalRent = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                    setExpectedRentDisplay(totalRent.toFixed(2));
                }
            } else {
                setExpectedRentDisplay(null);
            }
            return newData;
        });
    };

    // Unit change handler to update prefilled expected rents
    const handleUnitChange = (e) => {
        const newUnitId = e.target.value;
        setIncomeForm(prev => {
            const newData = { ...prev, unit_id: newUnitId };

            if (newUnitId && prev.tenant_id) {
                const activeLease = leases.find(l =>
                    l.tenant_id === prev.tenant_id &&
                    l.unit_id === newUnitId &&
                    l.status === 'active'
                );

                if (activeLease) {
                    const totalRent = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                    setExpectedRentDisplay(totalRent.toFixed(2));
                } else {
                    setExpectedRentDisplay(null);
                }
            } else {
                setExpectedRentDisplay(null);
            }
            return newData;
        });
    };

    // Prep manual mapping modal fields based on heuristic recommendations
    const openManualMap = (tx) => {
        setManualMapTx(tx);
        const isPositive = tx.amount > 0;
        const targetType = isPositive ? 'income' : 'expense';
        setManualTargetType(targetType);

        // Find match recommendations
        const recommendation = matchRecommendations.find(r => r.tx.id === tx.id);

        if (isPositive) {
            let tenantId = '';
            let propertyId = '';
            let unitId = '';
            let expectedRent = null;

            if (recommendation && recommendation.type === 'income' && recommendation.targetId) {
                const lease = leases.find(l => l.id === recommendation.targetId);
                if (lease) {
                    tenantId = lease.tenant_id;
                    propertyId = lease.unit?.property_id || '';
                    unitId = lease.unit_id || '';
                    const totalRent = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
                    expectedRent = totalRent.toFixed(2);
                }
            }

            setIncomeForm({
                payment_date: tx.booking_date,
                period_month: tx.booking_date.slice(0, 7),
                tenant_id: tenantId,
                property_id: propertyId,
                unit_id: unitId,
                amount: Math.abs(tx.amount).toString(),
                note: tx.purpose || ''
            });
            setExpectedRentDisplay(expectedRent);
        } else {
            let categoryId = '';
            let propertyId = '';
            let unitId = '';
            let scope = 'general';

            if (recommendation && recommendation.type === 'expense') {
                categoryId = recommendation.targetId || '';
                propertyId = recommendation.propertyId || '';
                unitId = recommendation.unitId || '';
                scope = unitId ? 'unit' : 'general';
            }

            setExpenseForm({
                booking_date: tx.booking_date,
                payee: tx.counterpart_name || '',
                category_id: categoryId,
                category_custom: '',
                scope: scope,
                property_id: propertyId,
                unit_id: unitId,
                amount: Math.abs(tx.amount).toString(),
                is_allocatable: true,
                note: tx.purpose || ''
            });
        }
    };

    // Apply manual reconciliation selection and learn rule
    const handleSaveManualMap = async () => {
        if (!manualMapTx) return;

        setActionLoading(true);
        try {
            const tx = manualMapTx;

            let targetId = '';
            let propertyId = null;
            let unitId = null;

            if (manualTargetType === 'income') {
                // Find active lease for the selected tenant and property/unit
                const activeLease = leases.find(l =>
                    l.tenant_id === incomeForm.tenant_id &&
                    (!incomeForm.unit_id || l.unit_id === incomeForm.unit_id)
                );

                if (!activeLease) {
                    alert('Kein aktives Mietverhältnis für diesen Mieter/Einheit gefunden.');
                    setActionLoading(false);
                    return;
                }

                targetId = activeLease.id;
                propertyId = incomeForm.property_id || null;
                unitId = incomeForm.unit_id || null;

                // Post rent payment
                const { error: rentErr } = await supabase
                    .from('rent_payments')
                    .insert([{
                        user_id: user.id,
                        lease_id: targetId,
                        payment_date: incomeForm.payment_date,
                        amount: parseFloat(incomeForm.amount),
                        note: incomeForm.note || `Automatischer Bankabgleich - ${tx.purpose}`
                    }]);

                if (rentErr) throw rentErr;

            } else if (manualTargetType === 'expense') {
                targetId = expenseForm.category_id;
                propertyId = expenseForm.property_id || null;
                unitId = expenseForm.scope === 'unit' ? (expenseForm.unit_id || null) : null;

                // Post expense
                const { error: expErr } = await supabase
                    .from('expenses')
                    .insert([{
                        user_id: user.id,
                        booking_date: expenseForm.booking_date,
                        payee: expenseForm.payee || 'Unbekannt',
                        category_id: targetId || null,
                        category_custom: !targetId ? expenseForm.category_custom : null,
                        property_id: propertyId,
                        unit_id: unitId,
                        amount: parseFloat(expenseForm.amount),
                        is_allocatable: expenseForm.is_allocatable,
                        note: expenseForm.note || `Automatischer Bankabgleich - ${tx.purpose}`
                    }]);

                if (expErr) throw expErr;
            }

            // Update transaction
            const { error: txErr } = await supabase
                .from('bank_transactions')
                .update({
                    status: 'matched',
                    matched_type: manualTargetType,
                    matched_target_id: targetId
                })
                .eq('id', tx.id);

            if (txErr) throw txErr;

            // SAVE TO LEARNING DATABASE (RULES) - Save Haus, Einheit, Mieter/Lease reference as well
            const { error: ruleErr } = await supabase
                .from('bank_matching_rules')
                .insert([{
                    user_id: user.id,
                    counterpart_name: tx.counterpart_name,
                    counterpart_iban: tx.counterpart_iban,
                    purpose_keyword: tx.purpose ? tx.purpose.split(' ').slice(0, 2).join(' ') : null,
                    target_type: manualTargetType,
                    target_id: targetId,
                    property_id: propertyId,
                    unit_id: unitId
                }]);

            if (ruleErr) throw ruleErr;

            triggerToast(`Regel gelernt! Künftige Buchungen von "${tx.counterpart_name}" werden als Vorschlag bereitgestellt.`);
            setManualMapTx(null);
            fetchData();
        } catch (error) {
            console.error('Error saving manual mapping:', error);
            alert('Fehler beim manuellen Zuweisen: ' + error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Remove learning rule
    const handleDeleteRule = async (ruleId) => {
        if (!window.confirm('Möchten Sie diese Buchungsregel löschen?')) return;
        try {
            const { error } = await supabase
                .from('bank_matching_rules')
                .delete()
                .eq('id', ruleId);
            if (error) throw error;
            triggerToast('Regel gelöscht.');
            fetchData();
        } catch (error) {
            alert('Fehler: ' + error.message);
        }
    };

    // Disconnect bank account
    const handleDisconnectBank = async (connId) => {
        if (!window.confirm('Möchten Sie diese Bankverbindung wirklich trennen? Alle zugehörigen unverbuchten Transaktionen werden gelöscht.')) return;
        try {
            const { error } = await supabase
                .from('bank_connections')
                .delete()
                .eq('id', connId);
            if (error) throw error;
            triggerToast('Bankverbindung getrennt.');
            fetchData();
        } catch (error) {
            alert('Fehler: ' + error.message);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '100px' }}>
                <Loader2 className="animate-spin" size={32} color="var(--primary-color)" />
            </div>
        );
    }

    return (
        <div style={{ position: 'relative' }}>
            {/* Learning Rule Toast Alert */}
            {showRuleToast && (
                <div style={{
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000,
                    backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
                    padding: '16px 20px', color: '#f8fafc', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', gap: '12px', width: '380px',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    <Sparkles size={20} color="#38bdf8" />
                    <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#38bdf8' }}>KI-Zuweisung gelernt</div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>{showRuleToast}</div>
                    </div>
                    <button onClick={() => setShowRuleToast(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '4px' }}>Automatisierter Bankabgleich</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verknüpfen Sie Ihre Konten via FinAPI & verbuchen Sie Ihre Mieteingänge intelligent.</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <Button variant="ghost" onClick={fetchData} disabled={actionLoading}>
                        <RefreshCw size={16} className={actionLoading ? 'animate-spin' : ''} style={{ marginRight: '6px' }} /> Aktualisieren
                    </Button>
                    {connections.length === 0 && (
                        <Button icon={Plus} onClick={() => { setShowConnectModal(true); setConnectStep('bank-select'); }}>
                            Bankkonto verknüpfen (FinAPI)
                        </Button>
                    )}
                </div>
            </div>

            {/* Main Layout Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>
                
                {/* Left Area - Tabs & Lists */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    
                    {/* Tabs navigation */}
                    <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                        <button 
                            onClick={() => setActiveTab('transactions')}
                            style={{
                                padding: '8px 16px', border: 'none', background: 'none', fontSize: '0.95rem', fontWeight: 600,
                                color: activeTab === 'transactions' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                borderBottom: activeTab === 'transactions' ? '2px solid var(--primary-color)' : 'none',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            <CreditCard size={16} /> Banktransaktionen ({transactions.filter(t => t.status === 'pending').length} offen)
                        </button>
                        <button 
                            onClick={() => setActiveTab('rules')}
                            style={{
                                padding: '8px 16px', border: 'none', background: 'none', fontSize: '0.95rem', fontWeight: 600,
                                color: activeTab === 'rules' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                borderBottom: activeTab === 'rules' ? '2px solid var(--primary-color)' : 'none',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            <Sparkles size={16} /> Lernende Datenbank ({rules.length} Regeln)
                        </button>
                    </div>

                    {/* Active Tab Contents */}
                    {activeTab === 'transactions' && (
                        <Card>
                            {connections.length === 0 ? (
                                <div style={{ padding: '48px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '30px', backgroundColor: 'rgba(14, 165, 233, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9' }}>
                                        <CreditCard size={28} />
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px' }}>Kein Bankkonto verknüpft</h3>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto', lineHeight: 1.5 }}>
                                            Verknüpfen Sie Ihr Bankkonto via FinAPI.io, um Transaktionen direkt zu laden, Mietzahlungen abzugleichen und Belege zuzuordnen.
                                        </p>
                                    </div>
                                    <Button onClick={() => { setShowConnectModal(true); setConnectStep('bank-select'); }}>
                                        Jetzt Bankkonto verknüpfen
                                    </Button>
                                </div>
                            ) : transactions.length === 0 ? (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    Keine Transaktionen auf diesem Konto gefunden.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: 'var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    
                                    {/* Table Header */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '110px 180px 1fr 180px 180px', padding: '12px 16px', backgroundColor: 'var(--bg-secondary)', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        <div>Datum</div>
                                        <div>Partner / IBAN</div>
                                        <div>Verwendungszweck</div>
                                        <div>Betrag</div>
                                        <div>Zuweisung / Status</div>
                                    </div>

                                    {/* Table Body */}
                                    {matchRecommendations.map(({ tx, type, targetId, propertyId, unitId, confidence, label, reason, rule, matched, alreadyBooked }, idx) => {
                                        const isPositive = tx.amount > 0;
                                        return (
                                            <div 
                                                key={tx.id} 
                                                style={{ 
                                                    display: 'grid', 
                                                    gridTemplateColumns: '110px 180px 1fr 180px 180px', 
                                                    padding: '16px', 
                                                    backgroundColor: 'var(--surface-color)', 
                                                    alignItems: 'center',
                                                    borderBottom: '1px solid var(--border-color)',
                                                    opacity: tx.status !== 'pending' ? 0.75 : 1
                                                }}
                                            >
                                                {/* Date */}
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                    {new Date(tx.booking_date).toLocaleDateString('de-DE')}
                                                </div>

                                                {/* Partner */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                                        {tx.counterpart_name || 'Unbekannt'}
                                                    </span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                                        {tx.counterpart_iban || '–'}
                                                    </span>
                                                </div>

                                                {/* Purpose */}
                                                <div style={{ fontSize: '0.85rem', paddingRight: '12px', color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                                    {tx.purpose}
                                                </div>

                                                {/* Amount */}
                                                <div>
                                                    <span style={{ 
                                                        fontWeight: 700, 
                                                        fontSize: '0.95rem',
                                                        color: isPositive ? 'var(--success-color)' : 'var(--danger-color)'
                                                    }}>
                                                        {isPositive ? '+' : ''}{formatCurrency(tx.amount)}
                                                    </span>
                                                </div>

                                                {/* Zuweisung & Match Action */}
                                                <div>
                                                    {tx.status === 'matched' ? (
                                                        <Badge variant="success">✓ Verbucht</Badge>
                                                    ) : tx.status === 'ignored' ? (
                                                        <Badge variant="secondary">Ignoriert</Badge>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                            
                                                            {/* Check if transaction is already booked manually */}
                                                            {alreadyBooked ? (
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    flexDirection: 'column',
                                                                    padding: '8px', 
                                                                    borderRadius: '6px', 
                                                                    backgroundColor: 'rgba(245, 158, 11, 0.06)',
                                                                    border: '1px dashed rgba(245, 158, 11, 0.3)'
                                                                }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: '#d97706' }}>
                                                                        <AlertCircle size={12} /> Bereits erfasst
                                                                    </div>
                                                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {label}
                                                                    </div>
                                                                    {reason && (
                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.2 }}>
                                                                            {reason}
                                                                        </div>
                                                                    )}

                                                                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                                                        <button 
                                                                            onClick={() => handleLinkExisting(tx.id, type, targetId)}
                                                                            style={{
                                                                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                                                                padding: '4px 6px', fontSize: '0.75rem', fontWeight: 600, border: 'none',
                                                                                borderRadius: '4px', backgroundColor: '#d97706', color: 'white', cursor: 'pointer'
                                                                            }}
                                                                            title="Mit vorhandenem Eintrag verknüpfen"
                                                                        >
                                                                            <Check size={12} /> Verknüpfen
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => openManualMap(tx)}
                                                                            style={{
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                padding: '4px', border: '1px solid var(--border-color)',
                                                                                borderRadius: '4px', backgroundColor: 'var(--surface-color)', cursor: 'pointer'
                                                                            }}
                                                                            title="Neu verbuchen"
                                                                        >
                                                                            <Settings size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : confidence > 0 ? (
                                                                <div style={{ 
                                                                    display: 'flex', 
                                                                    flexDirection: 'column',
                                                                    padding: '8px', 
                                                                    borderRadius: '6px', 
                                                                    backgroundColor: rule ? 'rgba(56, 189, 248, 0.06)' : 'rgba(22, 163, 74, 0.04)',
                                                                    border: rule ? '1px dashed rgba(56, 189, 248, 0.3)' : '1px dashed rgba(22, 163, 74, 0.25)'
                                                                }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: rule ? '#0ea5e9' : 'var(--success-color)' }}>
                                                                        <Sparkles size={12} /> {confidence}% Match
                                                                    </div>
                                                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {label}
                                                                    </div>
                                                                    {reason && (
                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.2 }}>
                                                                            {reason}
                                                                        </div>
                                                                    )}

                                                                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                                                        <button 
                                                                            onClick={() => handleConfirmMatch({ tx, type, targetId, propertyId, unitId })}
                                                                            style={{
                                                                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                                                                padding: '4px 6px', fontSize: '0.75rem', fontWeight: 600, border: 'none',
                                                                                borderRadius: '4px', backgroundColor: 'var(--success-color)', color: 'white', cursor: 'pointer'
                                                                            }}
                                                                        >
                                                                            <Check size={12} /> Bestätigen
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => openManualMap(tx)}
                                                                            style={{
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                padding: '4px', border: '1px solid var(--border-color)',
                                                                                borderRadius: '4px', backgroundColor: 'var(--surface-color)', cursor: 'pointer'
                                                                            }}
                                                                            title="Anders zuordnen"
                                                                        >
                                                                            <Settings size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                        <AlertCircle size={12} color="#f59e0b" /> Keine Zuweisung
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                                        <button 
                                                                            onClick={() => openManualMap(tx)}
                                                                            style={{
                                                                                flex: 1, padding: '5px 8px', fontSize: '0.75rem', fontWeight: 600,
                                                                                backgroundColor: 'var(--primary-color)', color: 'white', border: 'none',
                                                                                borderRadius: '4px', cursor: 'pointer'
                                                                            }}
                                                                        >
                                                                            Zuweisen
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => handleIgnoreTransaction(tx.id)}
                                                                            style={{
                                                                                padding: '5px 8px', fontSize: '0.75rem', fontWeight: 500,
                                                                                border: '1px solid var(--border-color)', borderRadius: '4px',
                                                                                backgroundColor: 'var(--surface-color)', color: 'var(--text-secondary)', cursor: 'pointer'
                                                                            }}
                                                                        >
                                                                            Ignorieren
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}

                                                        </div>
                                                    )}
                                                </div>

                                            </div>
                                        );
                                    })}

                                </div>
                            )}
                        </Card>
                    )}

                    {activeTab === 'rules' && (
                        <Card>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Intelligente Zuweisungsregeln</h3>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                                    Das System lernt aus Ihren Zuordnungen und schlägt künftige Zahlungen direkt mit hoher Konfidenz vor, sodass Sie diese mit einem Klick bestätigen können.
                                </p>
                            </div>
                            
                            {rules.length === 0 ? (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Noch keine gelernten Regeln in der Datenbank vorhanden.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {rules.map(rule => {
                                        const lease = leases.find(l => l.id === rule.target_id);
                                        const category = categories.find(c => c.id === rule.target_id);
                                        const prop = properties.find(p => p.id === rule.property_id);

                                        return (
                                            <div 
                                                key={rule.id} 
                                                style={{ 
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '16px 20px', borderBottom: '1px solid var(--border-color)'
                                                }}
                                            >
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                                                            {rule.counterpart_name || 'Generische Regel'}
                                                        </span>
                                                        {rule.counterpart_iban && (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                                                                IBAN: {rule.counterpart_iban}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span>Zuordnung auf:</span>
                                                        {rule.target_type === 'income' ? (
                                                            <Badge variant="success">Miete: {lease?.tenant?.last_name || 'Mieter'} ({lease?.unit?.unit_name || 'Wohnung'})</Badge>
                                                        ) : (
                                                            <Badge variant="warning">Rechnung: {category?.name || 'Ausgabe'} {prop ? `(${prop.street})` : ''}</Badge>
                                                        )}
                                                    </div>
                                                </div>

                                                <button 
                                                    onClick={() => handleDeleteRule(rule.id)}
                                                    style={{
                                                        background: 'none', border: 'none', color: '#ef4444',
                                                        cursor: 'pointer', padding: '6px', borderRadius: '4px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}
                                                    title="Regel löschen"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
                    )}

                </div>

                {/* Right Area - Connected Bank Account Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    
                    <Card style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Bankverbindungen</h3>
                            <Badge variant={connections.length > 0 ? 'success' : 'secondary'}>
                                {connections.length > 0 ? 'FinAPI Verbunden' : 'Keine'}
                            </Badge>
                        </div>

                        {connections.length > 0 ? (
                            connections.map(conn => (
                                <div key={conn.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                                            <Building2 size={16} color="var(--primary-color)" /> {conn.bank_name}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'monospace' }}>
                                            {conn.iban}
                                        </div>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '10px', color: 'var(--primary-color)' }}>
                                            {formatCurrency(conn.balance)}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleDisconnectBank(conn.id)}
                                        style={{
                                            width: '100%', padding: '8px', fontSize: '0.8rem', fontWeight: 600,
                                            color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.04)',
                                            border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', cursor: 'pointer'
                                        }}
                                    >
                                        Verbindung trennen
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                                Keine aktiven Bankverknüpfungen vorhanden.
                            </div>
                        )}
                    </Card>

                    {/* How it works info panel */}
                    <Card style={{ padding: '16px', backgroundColor: 'rgba(14, 165, 233, 0.03)', border: '1px solid rgba(14, 165, 233, 0.15)' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.88rem', fontWeight: 700, color: '#0ea5e9' }}>
                            <HelpCircle size={16} /> Wie funktioniert der Abgleich?
                        </div>
                        <ol style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', paddingLeft: '16px', marginTop: '10px', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <li>Verbinden Sie Ihr Girokonto über die FinAPI Rest-API.</li>
                            <li>Das System ordnet Mieteingänge und Zahlungsabgänge automatisch zu.</li>
                            <li>Bestätigen Sie den Vorschlag, um die Buchung festzuschreiben.</li>
                            <li>Manuelle Korrekturen werden als Regel gespeichert und beim nächsten Mal als Vorschlag mit hoher Konfidenz bereitgestellt.</li>
                        </ol>
                    </Card>

                </div>

            </div>

            {/* CONNECT BANK MODAL (FinAPI interface) */}
            <Modal
                isOpen={showConnectModal}
                onClose={() => setShowConnectModal(false)}
                title={connectStep === 'bank-select' ? 'Bankkonto verknüpfen' : connectStep === 'login' ? 'FinAPI Bank-Anmeldung' : 'Erfolgreich verknüpft!'}
                maxWidth="460px"
            >
                {connectStep === 'bank-select' && (
                    <div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Wählen Sie Ihre Bank aus, um eine sichere Verbindung über die FinAPI.io Rest Schnittstelle aufzubauen.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ihre Bank suchen oder auswählen</label>
                            <select 
                                value={selectedBank} 
                                onChange={e => setSelectedBank(e.target.value)}
                                style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                            >
                                <option value="">-- Bitte Bank wählen --</option>
                                <option value="Sparkasse Zweibrücken">Sparkasse Zweibrücken</option>
                                <option value="Deutsche Bank AG">Deutsche Bank AG</option>
                                <option value="Commerzbank AG">Commerzbank AG</option>
                                <option value="VR-Bank eG">VR-Bank eG</option>
                                <option value="N26 Bank">N26 Bank</option>
                                <option value="FinAPI Web-Sandbox">FinAPI Web-Sandbox (Demo)</option>
                            </select>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <Button variant="ghost" onClick={() => setShowConnectModal(false)}>Abbrechen</Button>
                            <Button disabled={!selectedBank} onClick={() => setConnectStep('login')}>Weiter</Button>
                        </div>
                    </div>
                )}

                {connectStep === 'login' && (
                    <div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Melden Sie sich sicher mit Ihren Online-Banking Zugangsdaten an. FinAPI verschlüsselt die Verbindung nach PSD2 Richtlinien.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Online-Banking Benutzername / Anmeldename</label>
                                <Input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>PIN / Passwort</label>
                                <Input type="password" value={loginPin} onChange={e => setLoginPin(e.target.value)} />
                            </div>

                            <div style={{ display: 'flex', gap: '8px', padding: '10px', backgroundColor: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '6px', fontSize: '0.72rem', color: '#0284c7', lineHeight: 1.4 }}>
                                <Key size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                                <span>Sandbox-Modus aktiv: Geben Sie beliebige Zugangsdaten ein, um das Demokonto erfolgreich zu verknüpfen.</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <Button variant="ghost" onClick={() => setConnectStep('bank-select')}>Zurück</Button>
                            <Button onClick={connectSandboxBank} disabled={actionLoading}>
                                {actionLoading ? <Loader2 size={16} className="animate-spin" /> : 'Konto verbinden'}
                            </Button>
                        </div>
                    </div>
                )}

                {connectStep === 'success' && (
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div style={{ width: '56px', height: '56px', borderRadius: '28px', backgroundColor: 'rgba(22, 163, 74, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success-color)', margin: '0 auto 16px' }}>
                            <Check size={28} />
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.4 }}>
                            Das Konto bei der <strong>{selectedBank}</strong> wurde erfolgreich über die FinAPI Schnittstelle importiert und synchronisiert.
                        </p>
                        <Button onClick={() => setShowConnectModal(false)}>Schließen & Transaktionen ansehen</Button>
                    </div>
                )}
            </Modal>

            {/* MANUAL MAPPING / BOOKING MODAL (Exactly matching Finance.jsx structures) */}
            <Modal
                isOpen={!!manualMapTx}
                onClose={() => setManualMapTx(null)}
                title="Buchung erfassen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setManualMapTx(null)}>Abbrechen</Button>
                        <Button onClick={handleSaveManualMap} disabled={actionLoading || (manualTargetType === 'income' ? !incomeForm.tenant_id : !expenseForm.category_id)}>Speichern</Button>
                    </>
                }
            >
                {actionLoading && <LoadingOverlay message="Buche..." />}
                
                {/* Tabs to switch Income/Expense */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color-soft)', paddingBottom: '10px' }}>
                    <button
                        onClick={() => setManualTargetType('expense')}
                        style={{ padding: '8px 16px', borderRadius: '20px', backgroundColor: manualTargetType === 'expense' ? 'var(--danger-color)' : '#F3F4F6', color: manualTargetType === 'expense' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >Kosten</button>
                    <button
                        onClick={() => setManualTargetType('income')}
                        style={{ padding: '8px 16px', borderRadius: '20px', backgroundColor: manualTargetType === 'income' ? 'var(--success-color)' : '#F3F4F6', color: manualTargetType === 'income' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >Mieteingänge</button>
                </div>

                {/* Expense Form */}
                {manualTargetType === 'expense' && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Datum" type="date" value={expenseForm.booking_date} onChange={e => setExpenseForm({ ...expenseForm, booking_date: e.target.value })} />
                            <Input label="Zahlungsempfänger" value={expenseForm.payee} onChange={e => setExpenseForm({ ...expenseForm, payee: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Kostenart</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                    value={expenseForm.category_id}
                                    onChange={e => {
                                        const catId = e.target.value;
                                        const cat = categories.find(c => c.id === catId);
                                        setExpenseForm({
                                            ...expenseForm,
                                            category_id: catId,
                                            is_allocatable: cat ? (cat.is_recoverable ?? true) : true
                                        });
                                    }}
                                >
                                    <option value="">Eigene Angabe...</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            {!expenseForm.category_id && (
                                <Input label="Kategorie (Text)" value={expenseForm.category_custom} onChange={e => setExpenseForm({ ...expenseForm, category_custom: e.target.value })} />
                            )}
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Zuordnung</label>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'general'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'general' })} /> Allgemein</label>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'unit'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'unit' })} /> Einheit</label>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                    value={expenseForm.property_id}
                                    onChange={e => setExpenseForm({ ...expenseForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            {expenseForm.scope === 'unit' && (
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                    <select
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                        value={expenseForm.unit_id}
                                        onChange={e => setExpenseForm({ ...expenseForm, unit_id: e.target.value })}
                                        disabled={!expenseForm.property_id}
                                    >
                                        <option value="">Wählen...</option>
                                        {formUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Betrag (€)" allowDecimals value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: '25px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={expenseForm.is_allocatable} onChange={e => setExpenseForm({ ...expenseForm, is_allocatable: e.target.checked })} style={{ marginRight: 8 }} /> Umlagefähig</label>
                            </div>
                        </div>
                        <Input label="Notiz" value={expenseForm.note} onChange={e => setExpenseForm({ ...expenseForm, note: e.target.value })} />
                    </div>
                )}

                {/* Income Form */}
                {manualTargetType === 'income' && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Zahldatum" type="date" value={incomeForm.payment_date} onChange={e => setIncomeForm({ ...incomeForm, payment_date: e.target.value })} />
                            <Input label="Monat" type="month" value={incomeForm.period_month} onChange={e => setIncomeForm({ ...incomeForm, period_month: e.target.value })} />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Mieter</label>
                            <select
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                value={incomeForm.tenant_id}
                                onChange={handleTenantChange}
                            >
                                <option value="">Wählen...</option>
                                {Array.from(new Map(tenants.map(t => [t.first_name + t.last_name, t])).values()).map(t => (
                                    <option key={t.id} value={t.id}>{t.last_name}, {t.first_name}</option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                    value={incomeForm.property_id}
                                    onChange={e => setIncomeForm({ ...incomeForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' }}
                                    value={incomeForm.unit_id}
                                    onChange={handleUnitChange}
                                    disabled={!incomeForm.property_id}
                                >
                                    <option value="">Wählen...</option>
                                    {formUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Betrag (€)" allowDecimals value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Soll-Miete (Gesamt)</label>
                                <input
                                    type="text"
                                    disabled
                                    value={expectedRentDisplay ? `${expectedRentDisplay} €` : '-'}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', color: 'var(--text-secondary)' }}
                                />
                            </div>
                        </div>
                        <Input label="Notiz" value={incomeForm.note} onChange={e => setIncomeForm({ ...incomeForm, note: e.target.value })} />
                    </div>
                )}

                <div style={{ display: 'flex', gap: '8px', padding: '10px', backgroundColor: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '6px', fontSize: '0.72rem', color: '#0ea5e9', lineHeight: 1.4, marginTop: '20px' }}>
                    <Save size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span><strong>Regel lernen:</strong> Bei Bestätigung speichert die lernende Datenbank diesen Zuweisungskontext (Haus, Einheit, Kostenkategorie/Mieter) für bessere zukünftige Match-Vorschläge.</span>
                </div>
            </Modal>
        </div>
    );
};

export default BankReconciliation;
