import React, { useState, useEffect } from 'react';
import { useLocation, useOutletContext, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import RateInput from '../components/ui/RateInput';
import { User, Lock, HelpCircle, Briefcase, Plus, Edit2, Loader2, Trash2, Tag, Check, X, Upload, PanelLeft, Settings as SettingsIcon, Clock, CreditCard, Bell, FileText, Share2, Cloud, Mail, LogOut, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import ImportPage from './Import'; // Import the Import page component
import Billing from './Billing'; // Billing & Abo page component
import { PortfolioShareModal } from '../components/portfolio/PortfolioShareModal';
import { PendingInvitations } from '../components/portfolio/PendingInvitations';
import { ActiveShares } from '../components/portfolio/ActiveShares';
import { CloudSettings } from './settings/CloudSettings';
import DocumentTemplates from './settings/DocumentTemplates';
import { EmailSettings } from './settings/EmailSettings';

// Spalten der Tabelle profiles, die das Stammdaten-Formular speichert (keine UI-Hilfsfelder)
const PROFILE_FIELDS = [
    'salutation', 'name_suffix', 'company', 'first_name', 'last_name', 'street', 'house_number',
    'zip', 'city', 'phone', 'mobile', 'bank_name', 'iban', 'bic', 'tax_number', 'vat_id',
    'portfolio_name', 'ownership_percent', 'settings_opening_hours_visible', 'settings_opening_hours_text'
];

// Profilfeld -> Spalte im Hauptportfolio (für den Abgleich beim Speichern der Stammdaten)
const PROFILE_TO_PORTFOLIO = {
    portfolio_name: 'name',
    company: 'company_name',
    street: 'street',
    house_number: 'house_number',
    zip: 'zip',
    city: 'city',
    bank_name: 'bank_name',
    iban: 'iban',
    bic: 'bic',
    tax_number: 'tax_number',
    vat_id: 'vat_id',
    ownership_percent: 'ownership_percent'
};

const MIN_PASSWORD_LENGTH = 10;

const normalizeEmail = (value) => (value || '').trim().toLowerCase();

// IBAN: Format + Prüfziffer (Mod 97); BIC: 8 oder 11 Zeichen
const isValidIban = (value) => {
    const iban = (value || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
        const code = ch.charCodeAt(0);
        const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
        for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
    }
    return remainder === 1;
};
const isValidBic = (value) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test((value || '').replace(/\s+/g, '').toUpperCase());

const validateBankData = ({ iban, bic }) => {
    const errors = [];
    if (iban && iban.trim() && !isValidIban(iban)) errors.push('Die IBAN ist ungültig (Format oder Prüfziffer stimmt nicht).');
    if (bic && bic.trim() && !isValidBic(bic)) errors.push('Die BIC ist ungültig (8 oder 11 Zeichen, z. B. COBADEFFXXX).');
    return errors;
};

// Leer -> 100 % (Spalte ist NOT NULL mit Standard 100); sonst 0–100
const parseOwnershipPercent = (value) => {
    if (value === '' || value === null || value === undefined) return { value: 100 };
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { error: 'Der Eigentumsanteil muss zwischen 0 und 100 % liegen.' };
    }
    return { value: n };
};

const KEY_TYPE_LABELS = { area: 'Fläche', persons: 'Personen', units: 'Wohneinheiten', equal: 'Gleich', direct: 'Direkt', mea: 'MEA' };
const keyTypeLabel = (type) => KEY_TYPE_LABELS[type] || 'Manuell';

// Zählt Zeilen (optional über eingebettete Beziehungen); null = konnte nicht ermittelt werden
const countRows = async (table, select, filterColumn, id) => {
    try {
        const { count, error } = await supabase
            .from(table)
            .select(select, { count: 'exact', head: true })
            .eq(filterColumn, id);
        if (error) {
            console.warn(`Zählung ${table} fehlgeschlagen:`, error.message);
            return null;
        }
        return count ?? 0;
    } catch (err) {
        console.warn(`Zählung ${table} fehlgeschlagen:`, err);
        return null;
    }
};

const loadDeleteImpact = async (portfolioId) => {
    const viaProperty = 'properties.portfolio_id';
    const viaUnit = 'units.properties.portfolio_id';
    const viaLease = 'leases.units.properties.portfolio_id';
    const [
        properties, units, leases, rentLedger, rentPayments, settlements, documents, claims,
        invoices, meters, meterReadings, loans, deals, documentTemplates
    ] = await Promise.all([
        countRows('properties', 'id', 'portfolio_id', portfolioId),
        countRows('units', 'id, properties!inner(portfolio_id)', viaProperty, portfolioId),
        countRows('leases', 'id, units!inner(properties!inner(portfolio_id))', viaUnit, portfolioId),
        countRows('rent_ledger', 'id, leases!inner(units!inner(properties!inner(portfolio_id)))', viaLease, portfolioId),
        countRows('rent_payments', 'id, leases!inner(units!inner(properties!inner(portfolio_id)))', viaLease, portfolioId),
        countRows('utility_settlements', 'id, properties!inner(portfolio_id)', viaProperty, portfolioId),
        countRows('documents', 'id, properties!inner(portfolio_id)', viaProperty, portfolioId),
        countRows('claims', 'id, leases!inner(units!inner(properties!inner(portfolio_id)))', viaLease, portfolioId),
        countRows('invoices', 'id', 'portfolio_id', portfolioId),
        countRows('meters', 'id', 'portfolio_id', portfolioId),
        countRows('meter_readings', 'id', 'portfolio_id', portfolioId),
        countRows('loans', 'id', 'portfolio_id', portfolioId),
        countRows('deals', 'id', 'portfolio_id', portfolioId),
        countRows('document_templates', 'id', 'portfolio_id', portfolioId)
    ]);
    return {
        properties, units, leases, rentLedger, rentPayments, settlements, documents, claims,
        invoices, meters, meterReadings, loans, deals, documentTemplates
    };
};

const IMPACT_LABELS = [
    ['properties', 'Objekte'],
    ['units', 'Einheiten'],
    ['leases', 'Mietverträge'],
    ['rentLedger', 'Mietkonto-Einträge (Sollstellungen)'],
    ['rentPayments', 'Mietzahlungen'],
    ['settlements', 'Nebenkostenabrechnungen'],
    ['invoices', 'Rechnungen'],
    ['meters', 'Zähler'],
    ['meterReadings', 'Zählerstände'],
    ['loans', 'Darlehen'],
    ['documents', 'Dokumente'],
    ['claims', 'Forderungsakten'],
    ['deals', 'Deals (Investorportal)'],
    ['documentTemplates', 'Portfolio-eigene Schreibvorlagen']
];

const Settings = () => {
    const { user } = useAuth();
    const { isMobile } = useViewMode();
    const { refreshPortfolios } = usePortfolio();
    const navigate = useNavigate();
    const { onboardingLocked, unlockOnboarding } = useOutletContext() || {};
    const location = useLocation();
    const [activeTab, setActiveTab] = useState('profile');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    
    // Sharing modal state
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [sharePortfolioId, setSharePortfolioId] = useState(null);
    const [activeShareRefresh, setActiveShareRefresh] = useState(0);

    // Navigation visibility state
    const [navVisibility, setNavVisibility] = useState(() => {
        try {
            const saved = localStorage.getItem('navVisibility');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    useEffect(() => {
        if (location.state && location.state.activeTab) {
            setActiveTab(location.state.activeTab);
            if (location.state.activeTab === 'document-templates') {
                setIsSidebarCollapsed(true);
            } else {
                setIsSidebarCollapsed(false);
            }
        }
    }, [location]);

    // Push-Schalter (eigener State statt Hilfsfeld im Profil, das sonst mitgespeichert würde)
    const [pushEnabled, setPushEnabled] = useState(() => {
        try { return localStorage.getItem('pushNotificationsEnabled') !== 'false'; } catch { return true; }
    });

    // Profile State
    const [loadingProfile, setLoadingProfile] = useState(false);
    const [profileLoadError, setProfileLoadError] = useState('');
    // Zuletzt geladener/gespeicherter Stand – Basis für den Abgleich ins Hauptportfolio
    const [loadedProfile, setLoadedProfile] = useState(null);
    const [profileData, setProfileData] = useState({
        salutation: 'Herr',
        name_suffix: '',
        company: '',
        first_name: '',
        last_name: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        phone: '',
        mobile: '',
        bank_name: '',
        iban: '',
        bic: '',
        tax_number: '',
        vat_id: '',
        portfolio_name: '',
        ownership_percent: '',
        onboarding_complete: false,
        settings_opening_hours_visible: true,
        settings_opening_hours_text: 'Mo-Fr 9:00 - 17:00 Uhr'
    });

    const fetchProfile = async () => {
        try {
            if (!user) return;
            setLoadingProfile(true);
            setProfileLoadError('');
            // maybeSingle: neue Nutzer haben noch keine Zeile (kein Fehler)
            const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
            if (error) throw error;
            if (data) {
                const mapped = {
                    salutation: data.salutation || 'Herr',
                    name_suffix: data.name_suffix || '',
                    company: data.company || '',
                    first_name: data.first_name || '',
                    last_name: data.last_name || '',
                    street: data.street || '',
                    house_number: data.house_number || '',
                    zip: data.zip || '',
                    city: data.city || '',
                    phone: data.phone || '',
                    mobile: data.mobile || '',
                    bank_name: data.bank_name || '',
                    iban: data.iban || '',
                    bic: data.bic || '',
                    tax_number: data.tax_number || '',
                    vat_id: data.vat_id || '',
                    portfolio_name: data.portfolio_name || '',
                    ownership_percent: data.ownership_percent ?? '',
                    onboarding_complete: data.onboarding_complete || false,
                    settings_opening_hours_visible: data.settings_opening_hours_visible !== false,
                    settings_opening_hours_text: data.settings_opening_hours_text || 'Mo-Fr 9:00 - 17:00 Uhr'
                };
                setProfileData(mapped);
                setLoadedProfile(mapped);
            } else {
                setLoadedProfile(null);
            }
        } catch (error) {
            // Nicht mit leeren Werten weiterarbeiten: Speichern würde sonst die Stammdaten
            // (inkl. Bankverbindung im Hauptportfolio) überschreiben.
            console.error('Profile fetch error:', error);
            setProfileLoadError('Ihre Stammdaten konnten nicht geladen werden. Speichern ist gesperrt, damit keine vorhandenen Daten überschrieben werden. Bitte laden Sie die Seite neu.');
        } finally {
            setLoadingProfile(false);
        }
    };

    // "Allgemeine Einstellungen": nur die Öffnungszeiten speichern – kein Abgleich ins Hauptportfolio
    const handleSaveGeneralSettings = async () => {
        if (profileLoadError) {
            alert(profileLoadError);
            return;
        }
        try {
            const { error } = await supabase.from('profiles').upsert({
                id: user.id,
                settings_opening_hours_visible: profileData.settings_opening_hours_visible,
                settings_opening_hours_text: profileData.settings_opening_hours_text,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
            setLoadedProfile(prev => prev ? {
                ...prev,
                settings_opening_hours_visible: profileData.settings_opening_hours_visible,
                settings_opening_hours_text: profileData.settings_opening_hours_text
            } : prev);
            alert('Einstellungen gespeichert.');
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleSaveProfile = async () => {
        if (profileLoadError) {
            alert(profileLoadError);
            return;
        }
        // Validate required fields
        const required = [
            { key: 'first_name', label: 'Vorname' },
            { key: 'last_name', label: 'Nachname' },
            { key: 'street', label: 'Straße' },
            { key: 'house_number', label: 'Hausnummer' },
            { key: 'zip', label: 'PLZ' },
            { key: 'city', label: 'Stadt' },
            { key: 'portfolio_name', label: 'Bezeichnung Portfolio' },
            { key: 'ownership_percent', label: 'Eigentumsanteil' },
        ];
        const missing = required.filter(f => !profileData[f.key]?.toString().trim());
        if (missing.length > 0) {
            alert(`Bitte füllen Sie folgende Pflichtfelder aus: ${missing.map(f => f.label).join(', ')}`);
            return;
        }

        const ownership = parseOwnershipPercent(profileData.ownership_percent);
        if (ownership.error) {
            alert(ownership.error);
            return;
        }
        const bankErrors = validateBankData(profileData);
        if (bankErrors.length > 0) {
            alert(bankErrors.join('\n'));
            return;
        }

        try {
            // Save profile – nur bekannte Spalten (keine UI-Hilfsfelder)
            const payload = {
                id: user.id,
                updated_at: new Date().toISOString(),
                onboarding_complete: true
            };
            PROFILE_FIELDS.forEach(key => { payload[key] = profileData[key]; });
            payload.ownership_percent = ownership.value;

            const { error } = await supabase.from('profiles').upsert(payload);
            if (error) throw error;

            const savedProfile = { ...profileData, ownership_percent: ownership.value, onboarding_complete: true };

            // Auto-create or update primary portfolio
            await syncPrimaryPortfolio(savedProfile);

            setProfileData(savedProfile);
            setLoadedProfile(savedProfile);
            if (unlockOnboarding) unlockOnboarding();
            alert('Stammdaten gespeichert.');
        } catch (error) {
            alert(translateError(error));
        }
    };

    // Hauptportfolio aus den Stammdaten anlegen bzw. aktualisieren.
    // Beim Aktualisieren werden nur Felder übernommen, die in den Stammdaten geändert
    // wurden – im Portfolio-Dialog abweichend gepflegte Werte bleiben sonst erhalten.
    const syncPrimaryPortfolio = async (savedProfile) => {
        // Check if a primary portfolio already exists (Fehler nicht ignorieren – sonst entstünde ein zweites)
        const { data: existing, error: lookupError } = await supabase
            .from('portfolios')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_primary', true)
            .maybeSingle();
        if (lookupError) throw lookupError;

        const valueFor = (profileKey) => {
            if (profileKey === 'portfolio_name') {
                return savedProfile.portfolio_name || `${savedProfile.first_name} ${savedProfile.last_name}`;
            }
            if (profileKey === 'ownership_percent') return savedProfile.ownership_percent;
            return savedProfile[profileKey] || '';
        };

        if (existing) {
            const changes = {};
            Object.entries(PROFILE_TO_PORTFOLIO).forEach(([profileKey, portfolioKey]) => {
                const before = loadedProfile ? String(loadedProfile[profileKey] ?? '') : null;
                const after = String(savedProfile[profileKey] ?? '');
                if (before === null || before !== after) {
                    changes[portfolioKey] = valueFor(profileKey);
                }
            });

            if (Object.keys(changes).length > 0) {
                const { error } = await supabase
                    .from('portfolios')
                    .update(changes)
                    .eq('id', existing.id);
                if (error) throw error;
            }
        } else {
            // Create new primary portfolio
            const portfolioData = { user_id: user.id, is_primary: true };
            Object.entries(PROFILE_TO_PORTFOLIO).forEach(([profileKey, portfolioKey]) => {
                portfolioData[portfolioKey] = valueFor(profileKey);
            });
            const { error } = await supabase
                .from('portfolios')
                .insert([portfolioData]);
            if (error) throw error;
        }

        // Refresh portfolios in context and local state
        fetchPortfolios();
        if (refreshPortfolios) refreshPortfolios();
    };

    // Portfolio State
    const [portfolios, setPortfolios] = useState([]);
    const [loadingPortfolios, setLoadingPortfolios] = useState(false);
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [editingPortfolio, setEditingPortfolio] = useState(null);
    const [portfolioForm, setPortfolioForm] = useState({
        name: '',
        company_name: '',
        email: '',
        phone: '',
        tax_number: '',
        vat_id: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        bank_name: '',
        iban: '',
        bic: '',
        ownership_percent: '',
        entity_type: 'private'
    });

    // Categories State
    const [categories, setCategories] = useState([]);
    const [loadingCategories, setLoadingCategories] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [categoryForm, setCategoryForm] = useState({ name: '', is_recoverable: true, distribution_key_id: '' });

    // Distribution Keys State
    const [distributionKeys, setDistributionKeys] = useState([]);
    const [isManageKeysModalOpen, setIsManageKeysModalOpen] = useState(false);
    const [isKeyEditModalOpen, setIsKeyEditModalOpen] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [keyForm, setKeyForm] = useState({ name: '', description: '', calculation_type: 'custom' });

    // Security State
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
    const [emailForm, setEmailForm] = useState({ newEmail: '', currentPassword: '' });
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

    // Delete Modals
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [portfolioToDelete, setPortfolioToDelete] = useState(null);
    const [targetPortfolioId, setTargetPortfolioId] = useState('');
    const [deleteImpact, setDeleteImpact] = useState(null);
    const [loadingDeleteImpact, setLoadingDeleteImpact] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchPortfolios = async () => {
        try {
            setLoadingPortfolios(true);
            const { data, error } = await supabase.from('portfolios').select('*').order('name');
            if (error) throw error;
            setPortfolios(data || []);
        } catch (error) {
            console.error('Error fetching portfolios:', error);
        } finally {
            setLoadingPortfolios(false);
        }
    };

    const fetchCategories = async () => {
        try {
            setLoadingCategories(true);
            if (!user) return;
            const { data, error } = await supabase
                .from('expense_categories')
                .select(`*, distribution_key:distribution_keys(name)`)
                .or(`user_id.is.null,user_id.eq.${user.id}`)
                .order('name');
            if (error) throw error;
            setCategories(data || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoadingCategories(false);
        }
    };

    const fetchDistributionKeys = async () => {
        try {
            if (!user) return;
            const { data, error } = await supabase
                .from('distribution_keys')
                .select('*')
                .or(`user_id.is.null,user_id.eq.${user.id}`)
                .order('name');
            if (error) throw error;
            setDistributionKeys(data || []);
        } catch (error) {
            console.error('Error fetching keys:', error);
        }
    };

    // Nur bei Nutzerwechsel neu laden (refreshPortfolios aus dem Context ist nicht stabil
    // und würde sonst ungespeicherte Eingaben durch DB-Werte ersetzen).
    // Standardschlüssel (user_id NULL) können mehrfach vorhanden sein -> nach Name zusammenfassen;
    // eigene Schlüssel werden immer angezeigt (auch bei gleichem Namen wie ein Standardschlüssel).
    const visibleKeys = distributionKeys.filter((k, index, self) =>
        k.user_id || index === self.findIndex(t => !t.user_id && t.name === k.name)
    );

    useEffect(() => {
        if (user) {
            fetchProfile();
            fetchPortfolios();
            fetchCategories();
            fetchDistributionKeys();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // --- CATEGORIES ---
    const handleNewCategory = () => {
        setEditingCategory(null);
        setCategoryForm({ name: '', is_recoverable: true, distribution_key_id: '' });
        setIsCategoryModalOpen(true);
    };

    const handleEditCategory = (cat) => {
        setEditingCategory(cat);
        setCategoryForm({
            name: cat.name,
            is_recoverable: cat.is_recoverable,
            distribution_key_id: cat.distribution_key_id || ''
        });
        setIsCategoryModalOpen(true);
    };

    const handleSaveCategory = async () => {
        if (!categoryForm.name.trim()) return alert('Name fehlt.');
        try {
            const payload = {
                name: categoryForm.name,
                is_recoverable: categoryForm.is_recoverable,
                distribution_key_id: categoryForm.distribution_key_id || null
            };

            if (editingCategory) {
                if (editingCategory.user_id !== user.id) {
                    alert('Standard-Kostenarten können nicht geändert werden. Legen Sie bei Bedarf eine eigene Kostenart an.');
                    return;
                }
                const { data, error } = await supabase.from('expense_categories').update(payload).eq('id', editingCategory.id).select('id');
                if (error) throw error;
                if (!data || data.length === 0) throw new Error('Die Kostenart wurde nicht gespeichert (keine Berechtigung).');
            } else {
                const { error } = await supabase.from('expense_categories').insert([{ ...payload, user_id: user.id }]);
                if (error) throw error;
            }
            setIsCategoryModalOpen(false);
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteCategory = async (row) => {
        if (row.user_id !== user.id) {
            alert('Standard-Kostenarten können nicht gelöscht werden.');
            return;
        }
        if (!window.confirm('Kostenart löschen?')) return;
        try {
            const { data, error } = await supabase.from('expense_categories').delete().eq('id', row.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Die Kostenart wurde nicht gelöscht (keine Berechtigung).');
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // Standard-Kostenarten (user_id NULL) sind schreibgeschützt
    const renderCategoryActions = (row) => (
        row.user_id === user?.id ? (
            <>
                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditCategory(row)}>Bearbeiten</Button>
                <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteCategory(row)}>Löschen</Button>
            </>
        ) : (
            <span style={{ fontSize: '0.8rem', color: '#9CA3AF', fontStyle: 'italic' }}>Standard</span>
        )
    );

    const categoryColumns = [
        { header: 'Bezeichnung', accessor: 'name', render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span> },
        { header: 'Umlagefähig', accessor: 'is_recoverable', render: (row) => <Badge variant={row.is_recoverable ? 'success' : 'default'}>{row.is_recoverable ? 'Ja' : 'Nein'}</Badge> },
        { header: 'Standard-Schlüssel', accessor: 'distribution_key', render: (row) => row.distribution_key?.name || '-' },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', alignItems: 'center' }}>
                    {renderCategoryActions(row)}
                </div>
            )
        }
    ];

    // --- KEYS ---
    const openKeyEdit = (key) => {
        setEditingKey(key);
        setKeyForm(key ? { name: key.name, description: key.description || '', calculation_type: key.calculation_type } : { name: '', description: '', calculation_type: 'custom' });
        setIsKeyEditModalOpen(true);
    };

    const handleSaveKey = async () => {
        if (!keyForm.name.trim()) return alert('Name fehlt.');
        try {
            const payload = {
                name: keyForm.name,
                description: keyForm.description,
                calculation_type: 'custom' // Always custom for user defined
            };
            if (editingKey) {
                const { data, error } = await supabase.from('distribution_keys').update(payload).eq('id', editingKey.id).select('id');
                if (error) throw error;
                if (!data || data.length === 0) throw new Error('Der Schlüssel wurde nicht gespeichert (keine Berechtigung).');
            } else {
                const { error } = await supabase.from('distribution_keys').insert([{ ...payload, user_id: user.id }]);
                if (error) throw error;
            }
            setIsKeyEditModalOpen(false);
            fetchDistributionKeys();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteKey = async (id) => {
        if (!window.confirm('Schlüssel löschen?')) return;
        try {
            const { data, error } = await supabase.from('distribution_keys').delete().eq('id', id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Der Schlüssel wurde nicht gelöscht (keine Berechtigung).');
            fetchDistributionKeys();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // ... (rest of component)

    const isOwnPortfolio = (portfolio) => !!portfolio && !!user && portfolio.user_id === user.id;
    const ownPortfolios = portfolios.filter(isOwnPortfolio);

    const handleEditPortfolio = (portfolio) => {
        if (!isOwnPortfolio(portfolio)) {
            alert('Dieses Portfolio wurde für Sie freigegeben. Bearbeiten kann es nur der Eigentümer.');
            return;
        }
        setEditingPortfolio(portfolio);
        setPortfolioForm({
            name: portfolio.name || '',
            company_name: portfolio.company_name || '',
            email: portfolio.email || '',
            phone: portfolio.phone || '',
            tax_number: portfolio.tax_number || '',
            vat_id: portfolio.vat_id || '',
            street: portfolio.street || '',
            house_number: portfolio.house_number || '',
            zip: portfolio.zip || '',
            city: portfolio.city || '',
            bank_name: portfolio.bank_name || '',
            iban: portfolio.iban || '',
            bic: portfolio.bic || '',
            ownership_percent: portfolio.ownership_percent ?? '',
            entity_type: portfolio.entity_type || 'private'
        });
        setIsPortfolioModalOpen(true);
    };

    const handleNewPortfolio = () => {
        setEditingPortfolio(null);
        setPortfolioForm({
            name: '',
            company_name: '',
            email: '',
            phone: '',
            tax_number: '',
            vat_id: '',
            street: '',
            house_number: '',
            zip: '',
            city: '',
            bank_name: '',
            iban: '',
            bic: '',
            ownership_percent: '',
            entity_type: 'private'
        });
        setIsPortfolioModalOpen(true);
    };

    const handleSavePortfolio = async () => {
        if (editingPortfolio && !isOwnPortfolio(editingPortfolio)) {
            alert('Nur der Eigentümer kann dieses Portfolio bearbeiten.');
            return;
        }
        if (!portfolioForm.name || !portfolioForm.name.trim()) {
            alert('Bitte eine Bezeichnung für das Portfolio eingeben.');
            return;
        }
        const ownership = parseOwnershipPercent(portfolioForm.ownership_percent);
        if (ownership.error) {
            alert(ownership.error);
            return;
        }
        const bankErrors = validateBankData(portfolioForm);
        if (bankErrors.length > 0) {
            alert(bankErrors.join('\n'));
            return;
        }

        try {
            // user_id wird nur beim Anlegen gesetzt – nie im Update (sonst Eigentümerwechsel)
            const dataToSave = {
                name: portfolioForm.name.trim(),
                company_name: portfolioForm.company_name,
                email: portfolioForm.email,
                phone: portfolioForm.phone,
                tax_number: portfolioForm.tax_number,
                vat_id: portfolioForm.vat_id,
                street: portfolioForm.street,
                house_number: portfolioForm.house_number,
                zip: portfolioForm.zip,
                city: portfolioForm.city,
                bank_name: portfolioForm.bank_name,
                iban: portfolioForm.iban,
                bic: portfolioForm.bic,
                ownership_percent: ownership.value,
                entity_type: portfolioForm.entity_type,
            };

            if (editingPortfolio) {
                const { data, error: updateError } = await supabase
                    .from('portfolios')
                    .update(dataToSave)
                    .eq('id', editingPortfolio.id)
                    .eq('user_id', user.id)
                    .select('id');
                if (updateError) throw updateError;
                if (!data || data.length === 0) {
                    throw new Error('Das Portfolio wurde nicht gespeichert (keine Berechtigung).');
                }
            } else {
                const { error: insertError } = await supabase
                    .from('portfolios')
                    .insert([{ ...dataToSave, user_id: user.id }]);
                if (insertError) throw insertError;
            }

            setIsPortfolioModalOpen(false);
            fetchPortfolios();
            if (refreshPortfolios) refreshPortfolios();

        } catch (error) {
            console.error('Save error:', error);
            alert(translateError(error));
        }
    };

    // Freigegebenes (fremdes) Portfolio verlassen
    const handleLeaveSharedPortfolio = async (portfolio) => {
        if (!window.confirm(`Freigabe für das Portfolio "${portfolio.name}" beenden? Sie verlieren danach den Zugriff; die Daten bleiben beim Eigentümer.`)) return;
        try {
            const { data: shares, error } = await supabase
                .from('portfolio_shares')
                .select('id, shared_with_email')
                .eq('portfolio_id', portfolio.id);
            if (error) throw error;
            const mine = (shares || []).filter(s => normalizeEmail(s.shared_with_email) === normalizeEmail(user.email));
            if (mine.length === 0) throw new Error('Für Ihr Konto wurde keine Freigabe zu diesem Portfolio gefunden.');
            for (const share of mine) {
                const { error: declineError } = await supabase.rpc('decline_portfolio_share', { share_id: share.id });
                if (declineError) throw declineError;
            }
            fetchPortfolios();
            if (refreshPortfolios) refreshPortfolios();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const [deleteProperties, setDeleteProperties] = useState(false);

    const handleOpenDeleteModal = async (portfolio) => {
        if (!isOwnPortfolio(portfolio)) {
            alert('Nur der Eigentümer kann dieses Portfolio löschen.');
            return;
        }
        setPortfolioToDelete(portfolio);
        setTargetPortfolioId('');
        setDeleteProperties(false);
        setDeleteImpact(null);
        setIsDeleteModalOpen(true);
        setLoadingDeleteImpact(true);
        try {
            setDeleteImpact(await loadDeleteImpact(portfolio.id));
        } finally {
            setLoadingDeleteImpact(false);
        }
    };

    // Überträgt alle Daten mit eigener portfolio_id in das Zielportfolio. Läuft in
    // Einzelschritten; bricht ein Schritt ab, wird das Quellportfolio NICHT gelöscht
    // (bereits übertragene Daten liegen dann schon im Ziel – es geht nichts verloren).
    const transferPortfolioContents = async (fromId, toId) => {
        const moved = [];
        const fail = (label, error) => {
            const err = new Error(`${label}: ${translateError(error)}`);
            err.moved = [...moved];
            return err;
        };
        const move = async (table, label) => {
            const { error } = await supabase.from(table).update({ portfolio_id: toId }).eq('portfolio_id', fromId);
            if (error) throw fail(label, error);
            moved.push(label);
        };

        await move('properties', 'Objekte (mit Einheiten, Verträgen, Mietkonto, Zahlungen, Abrechnungen)');
        await move('meters', 'Zähler');
        await move('meter_readings', 'Zählerstände');
        await move('invoices', 'Rechnungen');
        await move('loans', 'Darlehen');
        await move('deals', 'Deals');

        // Rechnungsnummern-Zähler zusammenführen (höchster Stand gewinnt), damit im Ziel
        // keine Nummern doppelt vergeben werden
        const { data: srcCounters, error: srcCounterError } = await supabase
            .from('invoice_counters').select('id, year, object_unit_id, last_number').eq('portfolio_id', fromId);
        if (srcCounterError) throw fail('Rechnungsnummern-Zähler', srcCounterError);
        if (srcCounters && srcCounters.length > 0) {
            const { data: dstCounters, error: dstCounterError } = await supabase
                .from('invoice_counters').select('id, year, object_unit_id, last_number').eq('portfolio_id', toId);
            if (dstCounterError) throw fail('Rechnungsnummern-Zähler', dstCounterError);
            for (const counter of srcCounters) {
                const match = (dstCounters || []).find(d => d.year === counter.year && (d.object_unit_id || null) === (counter.object_unit_id || null));
                if (match) {
                    if ((counter.last_number || 0) > (match.last_number || 0)) {
                        const { error } = await supabase.from('invoice_counters').update({ last_number: counter.last_number }).eq('id', match.id);
                        if (error) throw fail('Rechnungsnummern-Zähler', error);
                    }
                } else {
                    const { error } = await supabase.from('invoice_counters').update({ portfolio_id: toId }).eq('id', counter.id);
                    if (error) throw fail('Rechnungsnummern-Zähler', error);
                }
            }
            moved.push('Rechnungsnummern-Zähler');
        }

        // Portfolio-eigene Schreibvorlagen: übernehmen, sofern das Ziel keine gleiche Vorlage hat
        const { data: srcTemplates, error: srcTplError } = await supabase
            .from('document_templates').select('id, type').eq('portfolio_id', fromId);
        if (srcTplError) throw fail('Schreibvorlagen', srcTplError);
        if (srcTemplates && srcTemplates.length > 0) {
            const { data: dstTemplates, error: dstTplError } = await supabase
                .from('document_templates').select('type').eq('portfolio_id', toId);
            if (dstTplError) throw fail('Schreibvorlagen', dstTplError);
            const dstTypes = new Set((dstTemplates || []).map(t => t.type));
            for (const tpl of srcTemplates) {
                const { error } = dstTypes.has(tpl.type)
                    ? await supabase.from('document_templates').delete().eq('id', tpl.id)
                    : await supabase.from('document_templates').update({ portfolio_id: toId }).eq('id', tpl.id);
                if (error) throw fail('Schreibvorlagen', error);
            }
            moved.push('Schreibvorlagen');
        }

        // PDF-Vorlage nur übernehmen, wenn das Ziel noch keine hat (eine je Portfolio)
        const { data: srcPdf, error: srcPdfError } = await supabase.from('pdf_templates').select('id').eq('portfolio_id', fromId);
        if (srcPdfError) throw fail('PDF-Vorlage', srcPdfError);
        if (srcPdf && srcPdf.length > 0) {
            const { data: dstPdf, error: dstPdfError } = await supabase.from('pdf_templates').select('id').eq('portfolio_id', toId);
            if (dstPdfError) throw fail('PDF-Vorlage', dstPdfError);
            if (!dstPdf || dstPdf.length === 0) {
                const { error } = await supabase.from('pdf_templates').update({ portfolio_id: toId }).eq('id', srcPdf[0].id);
                if (error) throw fail('PDF-Vorlage', error);
                moved.push('PDF-Vorlage');
            }
        }

        return moved;
    };

    const handleExecuteDelete = async () => {
        if (!portfolioToDelete) return;
        if (!isOwnPortfolio(portfolioToDelete)) {
            alert('Nur der Eigentümer kann dieses Portfolio löschen.');
            return;
        }
        if (portfolioToDelete.is_primary) {
            alert('Das Hauptportfolio kann nicht gelöscht werden.');
            return;
        }

        const fromId = portfolioToDelete.id;
        setIsDeleting(true);
        try {
            const impact = deleteImpact || await loadDeleteImpact(fromId);
            const n = (key) => impact[key] || 0;

            if (targetPortfolioId) {
                if (!ownPortfolios.some(p => p.id === targetPortfolioId && p.id !== fromId)) {
                    alert('Bitte wählen Sie eines Ihrer eigenen Portfolios als Ziel.');
                    return;
                }

                // Doppelte Rechnungsnummern im Ziel würden den Übertrag mittendrin abbrechen
                if (n('invoices') > 0) {
                    const [{ data: srcInv, error: srcErr }, { data: dstInv, error: dstErr }] = await Promise.all([
                        supabase.from('invoices').select('invoice_number').eq('portfolio_id', fromId),
                        supabase.from('invoices').select('invoice_number').eq('portfolio_id', targetPortfolioId)
                    ]);
                    if (srcErr) throw srcErr;
                    if (dstErr) throw dstErr;
                    const dstNumbers = new Set((dstInv || []).map(i => i.invoice_number));
                    const duplicates = (srcInv || []).map(i => i.invoice_number).filter(num => dstNumbers.has(num));
                    if (duplicates.length > 0) {
                        alert(`Im Zielportfolio gibt es bereits Rechnungen mit denselben Nummern (z. B. ${duplicates.slice(0, 3).join(', ')}). Die Rechnungen können deshalb nicht übertragen werden. Bitte wählen Sie ein anderes Zielportfolio. Es wurde nichts verändert.`);
                        return;
                    }
                }

                try {
                    await transferPortfolioContents(fromId, targetPortfolioId);
                } catch (transferError) {
                    const done = transferError.moved && transferError.moved.length > 0
                        ? `\n\nBereits übertragen: ${transferError.moved.join(', ')}.`
                        : '';
                    alert(`Die Übertragung wurde abgebrochen – das Portfolio wurde NICHT gelöscht.\n\n${transferError.message}${done}`);
                    return;
                }
            } else {
                // Ohne Ziel: Rechnungen (Aufbewahrungspflicht) und Darlehen nie mitlöschen
                if (impact.invoices === null || impact.loans === null || impact.properties === null) {
                    alert('Die abhängigen Daten konnten nicht vollständig ermittelt werden. Zur Sicherheit wird nicht gelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder versuchen Sie es später erneut.');
                    return;
                }
                if (n('invoices') > 0) {
                    alert(`Dieses Portfolio enthält ${n('invoices')} Rechnung(en). Rechnungen unterliegen Aufbewahrungspflichten (§ 147 AO, § 14b UStG) und werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio.`);
                    return;
                }
                if (n('loans') > 0) {
                    alert(`Dieses Portfolio enthält ${n('loans')} Darlehen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder löschen Sie die Darlehen zuerst unter „Finanzierungen".`);
                    return;
                }
                if (n('properties') > 0) {
                    if (!deleteProperties) {
                        alert('Dieses Portfolio enthält Immobilien. Bitte wählen Sie ein Ziel-Portfolio für die Übertragung aus ODER bestätigen Sie die endgültige Löschung.');
                        return;
                    }
                    if (n('documents') > 0 || n('claims') > 0) {
                        alert('Zu den Objekten gibt es noch Dokumente oder Forderungsakten. Diese verhindern das Löschen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder entfernen Sie Dokumente/Forderungen zuerst.');
                        return;
                    }
                    // Explicitly delete properties if user chose to not transfer and confirmed deletion
                    const { error: propDelError } = await supabase
                        .from('properties')
                        .delete()
                        .eq('portfolio_id', fromId);
                    if (propDelError) throw propDelError;
                }

                // Portfolio-eigene Vorlagen, die es schon als allgemeine Vorlage gibt, würden das
                // Löschen blockieren (eine allgemeine Vorlage je Typ) – diese entfallen.
                const { data: srcTemplates, error: tplError } = await supabase
                    .from('document_templates').select('id, type, user_id').eq('portfolio_id', fromId);
                if (tplError) throw tplError;
                if (srcTemplates && srcTemplates.length > 0) {
                    const { data: globalTemplates, error: globalError } = await supabase
                        .from('document_templates').select('type').is('portfolio_id', null).eq('user_id', user.id);
                    if (globalError) throw globalError;
                    const globalTypes = new Set((globalTemplates || []).map(t => t.type));
                    for (const tpl of srcTemplates) {
                        if (tpl.user_id === user.id && globalTypes.has(tpl.type)) {
                            const { error } = await supabase.from('document_templates').delete().eq('id', tpl.id);
                            if (error) throw error;
                        }
                    }
                }
            }

            // Delete the portfolio
            const { data: deleted, error: deleteError } = await supabase
                .from('portfolios')
                .delete()
                .eq('id', fromId)
                .select('id');

            if (deleteError) throw deleteError;
            if (!deleted || deleted.length === 0) {
                throw new Error('Das Portfolio wurde nicht gelöscht (keine Berechtigung).');
            }

            // Success
            setIsDeleteModalOpen(false);
            setPortfolioToDelete(null);

            // Reload to refresh context and UI
            window.location.reload();

        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsDeleting(false);
        }
    };

    const openShareModal = (row) => { setSharePortfolioId(row.id); setIsShareModalOpen(true); };

    // Aktionen je Portfolio: Teilen/Bearbeiten/Löschen nur für den Eigentümer
    const renderPortfolioActions = (row) => (
        isOwnPortfolio(row) ? (
            <>
                <Button variant="ghost" size="sm" icon={Share2} onClick={() => openShareModal(row)}>Teilen</Button>
                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditPortfolio(row)}>Bearbeiten</Button>
                {!row.is_primary && (
                    <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleOpenDeleteModal(row)}>Löschen</Button>
                )}
            </>
        ) : (
            <Button variant="ghost" size="sm" icon={LogOut} onClick={() => handleLeaveSharedPortfolio(row)}>Freigabe beenden</Button>
        )
    );

    const portfolioColumns = [
        {
            header: 'Name',
            accessor: 'name',
            render: row => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{row.name}</span>
                    {row.is_primary && isOwnPortfolio(row) && <Badge variant="blue">Hauptportfolio</Badge>}
                    {!isOwnPortfolio(row) && <Badge variant="warning">Für mich freigegeben</Badge>}
                </div>
            )
        },
        { header: 'Firma', accessor: 'company_name' },
        { header: 'Ort', accessor: 'city', render: row => `${row.zip || ''} ${row.city || ''}` },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                    {renderPortfolioActions(row)}
                </div>
            )
        }
    ];

    const handleUpdateEmail = async () => {
        if (!emailForm.newEmail || !emailForm.currentPassword) return alert('Bitte alle Felder ausfüllen.');

        try {
            // 1. Re-auth
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: emailForm.currentPassword
            });
            if (signInError) throw new Error('Das aktuelle Passwort ist falsch.');

            // 2. Update Email
            const { error: updateError } = await supabase.auth.updateUser({ email: emailForm.newEmail });
            if (updateError) throw updateError;

            alert('E-Mail geändert. Bitte bestätigen Sie die Änderung über den Link, der an Ihre neue E-Mail-Adresse gesendet wurde.');
            setIsEmailModalOpen(false);
            setEmailForm({ newEmail: '', currentPassword: '' });
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleUpdatePassword = async () => {
        if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
            return alert('Bitte alle Felder ausfüllen.');
        }
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            return alert('Die neuen Passwörter stimmen nicht überein.');
        }
        if (passwordForm.newPassword.length < MIN_PASSWORD_LENGTH) {
            return alert(`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
        }

        try {
            // 1. Re-auth
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: passwordForm.currentPassword
            });
            if (signInError) throw new Error('Das aktuelle Passwort ist falsch.');

            // 2. Update PW
            const { error: updateError } = await supabase.auth.updateUser({ password: passwordForm.newPassword });
            if (updateError) throw updateError;

            alert('Passwort erfolgreich geändert.');
            setIsPasswordModalOpen(false);
            setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (error) {
            alert(translateError(error));
        }
    };

    const navItems = [
        { key: 'dashboard', label: 'Dashboard' },
        { key: 'properties', label: 'Immobilien' },
        { key: 'tenants', label: 'Mietverhältnisse' },
        { key: 'finance', label: 'Finanzen' },
        { key: 'utility-costs', label: 'Nebenkosten' },
        { key: 'meters', label: 'Zähler' },
        { key: 'contacts', label: 'Kontakte' },
        { key: 'mieterportal', label: 'Mieterportal' },
        { key: 'investorportal', label: 'Investorportal' },
    ];

    const isNavVisible = (key) => navVisibility[key] !== false;

    const toggleNav = (key) => {
        const updated = { ...navVisibility, [key]: !isNavVisible(key) };
        setNavVisibility(updated);
        localStorage.setItem('navVisibility', JSON.stringify(updated));
        window.dispatchEvent(new Event('navVisibilityChanged'));
    };

    const tabs = [
        { id: 'profile', label: 'Stammdaten', icon: User },
        { id: 'general', label: 'Allgemeine Einstellungen', icon: SettingsIcon },
        { id: 'portfolios', label: 'Portfolios', icon: Briefcase },
        { id: 'pdf-template', label: 'PDF-Vorlage', icon: FileText, link: '/portfolio/settings/pdf-template' },
        { id: 'document-templates', label: 'Schreibvorlagen', icon: FileText },
        { id: 'expenses', label: 'Kostenarten', icon: Tag },
        { id: 'navigation', label: 'Navigationsleiste', icon: PanelLeft },
        { id: 'security', label: 'Sicherheit', icon: Lock },
        { id: 'import', label: 'Import', icon: Upload },
        { id: 'cloud', label: 'Cloud-Verbindungen', icon: Cloud },
        { id: 'email-settings', label: 'E-Mail-Einrichtung', icon: Mail },
        { id: 'billing', label: 'Abrechnung & Abo', icon: CreditCard },
        { id: 'help', label: 'Hilfe', icon: HelpCircle }
    ];

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '10px' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0 }}>Einstellungen</h1>
                {!isMobile && (
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        icon={PanelLeft} 
                        onClick={() => setIsSidebarCollapsed(prev => !prev)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        {isSidebarCollapsed ? 'Seitenmenü einblenden' : 'Seitenmenü ausblenden'}
                    </Button>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '100%' : (isSidebarCollapsed ? '1fr' : '250px 1fr'), gap: isMobile ? 'var(--spacing-xl)' : (isSidebarCollapsed ? '0px' : 'var(--spacing-xl)') }}>
                {/* Settings Sidebar */}
                {(!isMobile && isSidebarCollapsed) ? null : (
                    <Card style={{ padding: '0', height: 'fit-content', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', overflowX: isMobile ? 'auto' : 'visible' }}>
                            {tabs.map(tab => {
                                const isDisabled = onboardingLocked && tab.id !== 'profile';
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            if (!isDisabled) {
                                                if (tab.link) {
                                                    navigate(tab.link);
                                                } else {
                                                    setActiveTab(tab.id);
                                                    if (tab.id === 'document-templates') {
                                                        setIsSidebarCollapsed(true);
                                                    } else {
                                                        setIsSidebarCollapsed(false);
                                                    }
                                                }
                                            }
                                        }}
                                        disabled={isDisabled}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: 'var(--spacing-md)',
                                            backgroundColor: activeTab === tab.id ? '#F3F4F6' : 'transparent',
                                            borderLeft: !isMobile && activeTab === tab.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                                            borderBottom: isMobile && activeTab === tab.id ? '3px solid var(--primary-color)' : '1px solid var(--border-color)',
                                            textAlign: 'left',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            fontWeight: activeTab === tab.id ? 500 : 400,
                                            transition: 'background 0.2s',
                                            whiteSpace: 'nowrap',
                                            borderRight: isMobile ? '1px solid var(--border-color)' : 'none',
                                            opacity: isDisabled ? 0.4 : 1,
                                        }}
                                    >
                                        <tab.icon size={18} style={{ marginRight: '10px', color: activeTab === tab.id ? 'var(--primary-color)' : 'var(--text-secondary)' }} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </Card>
                )}

                {/* Content Area */}
                <div style={{ flex: 1 }}>
                    {activeTab === 'general' && (
                        <Card title="Allgemeine Einstellungen">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                {/* Opening Hours Toggle */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '16px',
                                    backgroundColor: 'var(--background-color)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '50%',
                                            backgroundColor: '#E0F2FE', color: 'var(--primary-color)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}>
                                            <Clock size={20} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Öffnungszeiten im Mieterportal</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Anzeige der Geschäftszeiten für Mieter ein- oder ausschalten.</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const newValue = !profileData.settings_opening_hours_visible;
                                            setProfileData(prev => ({ ...prev, settings_opening_hours_visible: newValue }));
                                        }}
                                        style={{
                                            width: '44px', height: '24px', borderRadius: '12px',
                                            backgroundColor: profileData.settings_opening_hours_visible ? 'var(--primary-color)' : '#D1D5DB',
                                            border: 'none', cursor: 'pointer',
                                            position: 'relative', transition: 'background-color 0.2s',
                                            flexShrink: 0
                                        }}
                                    >
                                        <div style={{
                                            width: '18px', height: '18px', borderRadius: '50%',
                                            backgroundColor: 'var(--surface-color)',
                                            position: 'absolute', top: '3px',
                                            left: profileData.settings_opening_hours_visible ? '23px' : '3px',
                                            transition: 'left 0.2s',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}></div>
                                    </button>
                                </div>

                                {/* Opening Hours Text */}
                                {profileData.settings_opening_hours_visible && (
                                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                        <Input
                                            label="Öffnungszeiten Text"
                                            placeholder="z.B. Montag-Freitag 9.00-17.00 Uhr"
                                            value={profileData.settings_opening_hours_text}
                                            onChange={e => setProfileData({ ...profileData, settings_opening_hours_text: e.target.value })}
                                        />
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            Dieser Text wird den Mietern im Portal oben rechts in der Kopfzeile angezeigt.
                                        </p>
                                    </div>
                                )}

                                {/* Push Notification Toggle */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '16px',
                                    backgroundColor: 'var(--background-color)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '50%',
                                            backgroundColor: '#FEF3C7', color: '#f59e0b',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}>
                                            <Bell size={20} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Push-Benachrichtigungen</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Benachrichtigungen für fällige Aufgaben und Sanierungsprojekte ein- oder ausschalten.</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const next = !pushEnabled;
                                            try { localStorage.setItem('pushNotificationsEnabled', next ? 'true' : 'false'); } catch { /* ignore */ }
                                            setPushEnabled(next);
                                        }}
                                        style={{
                                            width: '44px', height: '24px', borderRadius: '12px',
                                            backgroundColor: pushEnabled ? 'var(--primary-color)' : '#D1D5DB',
                                            border: 'none', cursor: 'pointer',
                                            position: 'relative', transition: 'background-color 0.2s',
                                            flexShrink: 0
                                        }}
                                    >
                                        <div style={{
                                            width: '18px', height: '18px', borderRadius: '50%',
                                            backgroundColor: 'var(--surface-color)',
                                            position: 'absolute', top: '3px',
                                            left: pushEnabled ? '23px' : '3px',
                                            transition: 'left 0.2s',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}></div>
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
                                    <Button onClick={handleSaveGeneralSettings} disabled={!!profileLoadError}>Einstellungen speichern</Button>
                                </div>
                            </div>
                        </Card>
                    )}

                    {activeTab === 'profile' && (
                        <Card title="Stammdaten bearbeiten">
                            {loadingProfile ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>
                            ) : (
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    {profileLoadError && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.9rem' }}>
                                            <AlertTriangle size={18} />
                                            <span style={{ flex: 1 }}>{profileLoadError}</span>
                                            <Button size="sm" variant="secondary" onClick={fetchProfile}>Erneut laden</Button>
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Anrede</label>
                                            <select
                                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                                                value={profileData.salutation}
                                                onChange={(e) => setProfileData({ ...profileData, salutation: e.target.value })}
                                            >
                                                <option value="Herr">Herr</option>
                                                <option value="Frau">Frau</option>
                                                <option value="Familie">Familie</option>
                                                <option value="Firma">Firma</option>
                                            </select>
                                        </div>
                                        <Input label="Zusatz" value={profileData.name_suffix} onChange={e => setProfileData({ ...profileData, name_suffix: e.target.value })} />
                                    </div>

                                    <Input label="Firma" value={profileData.company} onChange={e => setProfileData({ ...profileData, company: e.target.value })} />

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Vorname *" value={profileData.first_name} onChange={e => setProfileData({ ...profileData, first_name: e.target.value })} required />
                                        <Input label="Nachname *" value={profileData.last_name} onChange={e => setProfileData({ ...profileData, last_name: e.target.value })} required />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Straße *" value={profileData.street} onChange={e => setProfileData({ ...profileData, street: e.target.value })} required />
                                        <Input label="Hausnummer *" value={profileData.house_number} onChange={e => setProfileData({ ...profileData, house_number: e.target.value })} required />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="PLZ *" value={profileData.zip} onChange={e => setProfileData({ ...profileData, zip: e.target.value })} required />
                                        <Input label="Stadt *" value={profileData.city} onChange={e => setProfileData({ ...profileData, city: e.target.value })} required />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Telefon" value={profileData.phone} onChange={e => setProfileData({ ...profileData, phone: e.target.value })} />
                                        <Input label="Handynummer" value={profileData.mobile} onChange={e => setProfileData({ ...profileData, mobile: e.target.value })} />
                                    </div>

                                    <div>
                                        <Input label="E-Mailadresse" value={user?.email || ''} disabled />
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Hinweis: Die E-Mailadresse kann nur im Bereich Sicherheit geändert werden.
                                        </p>
                                    </div>

                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: 'var(--spacing-sm) 0' }}></div>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Portfolio</h3>

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Bezeichnung Portfolio *" placeholder="z.B. Mein Portfolio" value={profileData.portfolio_name} onChange={e => setProfileData({ ...profileData, portfolio_name: e.target.value })} required />
                                        <Input label="Eigentumsanteil (%) *" type="number" placeholder="100" value={profileData.ownership_percent} onChange={e => setProfileData({ ...profileData, ownership_percent: e.target.value })} required />
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-8px' }}>
                                        Ihr Hauptportfolio wird automatisch aus Ihren Stammdaten erstellt. Später geänderte Angaben (Name, Adresse, Bankverbindung, Steuerdaten) werden beim Übernehmen ins Hauptportfolio übertragen; nicht geänderte Felder lassen dort gepflegte Werte unberührt.
                                    </p>

                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: 'var(--spacing-sm) 0' }}></div>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bankverbindung & Steuer</h3>

                                    <Input label="Bank" value={profileData.bank_name} onChange={e => setProfileData({ ...profileData, bank_name: e.target.value })} />

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="IBAN" value={profileData.iban} onChange={e => setProfileData({ ...profileData, iban: e.target.value })} />
                                        <Input label="BIC" value={profileData.bic} onChange={e => setProfileData({ ...profileData, bic: e.target.value })} />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="USt-IdNr." value={profileData.vat_id} onChange={e => setProfileData({ ...profileData, vat_id: e.target.value })} />
                                        <Input label="Steuernummer" value={profileData.tax_number} onChange={e => setProfileData({ ...profileData, tax_number: e.target.value })} />
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
                                        <Button onClick={handleSaveProfile} disabled={!!profileLoadError}>Übernehmen</Button>
                                    </div>
                                </div>
                            )}
                        </Card>
                    )}

                    {activeTab === 'portfolios' && (
                        <div>
                            <PendingInvitations />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Portfolios verwalten</h2>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <Button icon={FileText} variant="secondary" onClick={() => navigate('/portfolio/settings/pdf-template')}>PDF-Vorlage</Button>
                                    <Button icon={Plus} onClick={handleNewPortfolio}>Neues Portfolio</Button>
                                </div>
                            </div>
                            <Card>
                                {loadingPortfolios ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>
                                ) : (
                                    portfolios.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                                            Noch keine Portfolios angelegt.
                                        </div>
                                    ) : (
                                        <>
                                            {/* Share Portfolio Modal */}
                                            <PortfolioShareModal 
                                                isOpen={isShareModalOpen} 
                                                onClose={() => { setIsShareModalOpen(false); setSharePortfolioId(null); }} 
                                                portfolioId={sharePortfolioId} 
                                                onShareSuccess={() => setActiveShareRefresh(prev => prev + 1)}
                                            />
                                            <div className="hidden-mobile">
                                                <Table columns={portfolioColumns} data={portfolios} />
                                            </div>

                                            {/* Mobile Card View */}
                                            <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                {portfolios.map((row) => (
                                                    <div key={row.id} style={{
                                                        border: '1px solid var(--border-color)',
                                                        borderRadius: 'var(--radius-md)',
                                                        padding: 'var(--spacing-md)',
                                                        backgroundColor: 'var(--surface-color)',
                                                        position: 'relative'
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                            <div>
                                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{row.name}</div>
                                                                {row.company_name && (
                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{row.company_name}</div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {(row.zip || row.city) && (
                                                            <div style={{ marginBottom: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                                {row.zip} {row.city}
                                                            </div>
                                                        )}

                                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            {row.is_primary && isOwnPortfolio(row) && (
                                                                <span style={{ marginRight: 'auto' }}><Badge variant="blue">Hauptportfolio</Badge></span>
                                                            )}
                                                            {!isOwnPortfolio(row) && (
                                                                <span style={{ marginRight: 'auto' }}><Badge variant="warning">Für mich freigegeben</Badge></span>
                                                            )}
                                                            {renderPortfolioActions(row)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )
                                )}
                            </Card>
                            
                            {/* Active Shares Section */}
                            <ActiveShares refreshTrigger={activeShareRefresh} />
                        </div>
                    )}

                    {activeTab === 'expenses' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Kostenarten verwalten</h2>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <Button onClick={() => setIsManageKeysModalOpen(true)}>Verteilerschlüssel verwalten</Button>
                                    <Button icon={Plus} onClick={handleNewCategory}>Neue Kostenart</Button>
                                </div>
                            </div>
                            <Card>
                                {loadingCategories ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>
                                ) : (
                                    <>
                                        <div className="hidden-mobile">
                                            <Table columns={categoryColumns} data={categories} />
                                        </div>

                                        {/* Mobile Card View */}
                                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            {categories.map((row) => (
                                                <div key={row.id} style={{
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: 'var(--radius-md)',
                                                    padding: 'var(--spacing-md)',
                                                    backgroundColor: 'var(--surface-color)',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{row.name}</div>
                                                        <Badge variant={row.is_recoverable ? 'success' : 'default'} size="sm">{row.is_recoverable ? 'Ja' : 'Nein'}</Badge>
                                                    </div>

                                                    <div style={{ marginBottom: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        Standard-Schlüssel: {row.distribution_key?.name || '-'}
                                                    </div>

                                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                                                        {renderCategoryActions(row)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </Card>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <Card title="Sicherheit & Login">
                            <div style={{ display: 'grid', gridTemplateColumns: '150px max-content max-content', gap: 'var(--spacing-xl)', alignItems: 'center', justifyContent: 'start' }}>

                                {/* Email */}
                                <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>E-Mailadresse</div>
                                <div style={{ fontWeight: 500 }}>{user?.email}</div>
                                <Button size="xs" style={{ whiteSpace: 'nowrap' }} onClick={() => { setEmailForm({ newEmail: '', currentPassword: '' }); setIsEmailModalOpen(true); }}>E-Mail ändern</Button>

                                {/* Password */}
                                <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Passwort</div>
                                <div style={{ fontFamily: 'monospace', letterSpacing: '2px', fontSize: '1.2rem', color: 'var(--text-secondary)' }}>•••••••••••••••</div>
                                <Button size="xs" style={{ whiteSpace: 'nowrap' }} onClick={() => { setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setIsPasswordModalOpen(true); }}>Passwort ändern</Button>

                            </div>

                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                <button
                                    onClick={async () => {
                                        if (window.confirm('Soll eine E-Mail zum Zurücksetzen des Passworts an Ihre E-Mail-Adresse gesendet werden?')) {
                                            const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                                                redirectTo: window.location.origin + '/reset-password',
                                            });
                                            if (error) alert('Fehler: ' + (error.message === 'User not found' ? 'Benutzer nicht gefunden' : error.message));
                                            else alert('E-Mail versendet. Bitte prüfen Sie Ihren Posteingang.');
                                        }
                                    }}
                                    style={{ background: 'none', border: 'none', color: 'var(--primary-color)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}
                                >
                                    Passwort vergessen?
                                </button>
                            </div>

                            <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                Aus Sicherheitsgründen zeigen wir dein Passwort nicht an.
                            </div>
                        </Card>
                    )}

                    {activeTab === 'import' && (
                        <div>
                            <ImportPage />
                        </div>
                    )}

                    {activeTab === 'cloud' && (
                        <div>
                            <CloudSettings portfolios={portfolios} />
                        </div>
                    )}

                    {activeTab === 'email-settings' && (
                        <div>
                            <EmailSettings />
                        </div>
                    )}

                    {activeTab === 'navigation' && (
                        <Card title="Navigationsleiste konfigurieren">
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
                                Wählen Sie, welche Menüpunkte in der Navigationsleiste angezeigt werden.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                                {navItems.map((item, idx) => (
                                    <div key={item.key} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '14px 16px',
                                        borderBottom: idx < navItems.length - 1 ? '1px solid var(--border-color)' : 'none',
                                    }}>
                                        <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>{item.label}</span>
                                        <button
                                            onClick={() => toggleNav(item.key)}
                                            style={{
                                                width: '44px', height: '24px', borderRadius: '12px',
                                                backgroundColor: isNavVisible(item.key) ? 'var(--primary-color)' : '#D1D5DB',
                                                border: 'none', cursor: 'pointer',
                                                position: 'relative', transition: 'background-color 0.2s',
                                                flexShrink: 0
                                            }}
                                        >
                                            <div style={{
                                                width: '18px', height: '18px', borderRadius: '50%',
                                                backgroundColor: 'var(--surface-color)',
                                                position: 'absolute', top: '3px',
                                                left: isNavVisible(item.key) ? '23px' : '3px',
                                                transition: 'left 0.2s',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                            }} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {activeTab === 'help' && (
                        <Card title="Support">
                            <p style={{ marginBottom: 'var(--spacing-md)' }}>Haben Sie Fragen oder benötigen Sie Unterstützung?</p>
                            <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--background-color)', borderRadius: '8px' }}>
                                <strong>E-Mail:</strong> support@immocontrol360.de
                            </div>
                        </Card>
                    )}

                    {activeTab === 'billing' && (
                        <Billing />
                    )}

                    {activeTab === 'document-templates' && (
                        <DocumentTemplates />
                    )}
                </div>
            </div>

            {/* Portfolio Modal */}
            <Modal
                isOpen={isPortfolioModalOpen}
                onClose={() => setIsPortfolioModalOpen(false)}
                title={editingPortfolio ? 'Portfolio bearbeiten' : 'Neues Portfolio'}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsPortfolioModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSavePortfolio}>Speichern</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Bezeichnung *"
                        placeholder="z.B. Eigenbestand"
                        value={portfolioForm.name}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, name: e.target.value })}
                    />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="Firmenname"
                        placeholder="Muster GmbH"
                        value={portfolioForm.company_name}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, company_name: e.target.value })}
                    />
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                            Rechtsform
                        </label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                outline: 'none',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={portfolioForm.entity_type}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, entity_type: e.target.value })}
                        >
                            <option value="private">Privat</option>
                            <option value="gbr">GbR</option>
                            <option value="gmbh">GmbH</option>
                            <option value="miteigentum">Miteigentum</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                    <Input
                        label="E-Mail"
                        value={portfolioForm.email}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, email: e.target.value })}
                    />
                    <Input
                        label="Telefon"
                        value={portfolioForm.phone}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, phone: e.target.value })}
                    />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="Steuernummer"
                        placeholder="z.B. 12/345/67890"
                        value={portfolioForm.tax_number || ''}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, tax_number: e.target.value })}
                    />
                    <Input
                        label="USt-IdNr."
                        placeholder="z.B. DE123456789"
                        value={portfolioForm.vat_id || ''}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, vat_id: e.target.value })}
                    />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Bankverbindung</h4>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Input
                            label="Bankname"
                            value={portfolioForm.bank_name || ''}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, bank_name: e.target.value })}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                        <Input
                            label="IBAN"
                            value={portfolioForm.iban || ''}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, iban: e.target.value })}
                        />
                        <Input
                            label="BIC"
                            value={portfolioForm.bic || ''}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, bic: e.target.value })}
                        />
                    </div>
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Adresse</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                        <Input
                            label="Straße"
                            value={portfolioForm.street}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, street: e.target.value })}
                        />
                        <Input
                            label="Nr."
                            value={portfolioForm.house_number}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, house_number: e.target.value })}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                        <Input
                            label="PLZ"
                            value={portfolioForm.zip}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, zip: e.target.value })}
                        />
                        <Input
                            label="Ort"
                            value={portfolioForm.city}
                            onChange={(e) => setPortfolioForm({ ...portfolioForm, city: e.target.value })}
                        />
                    </div>
                </div>

                <div style={{ marginTop: 'var(--spacing-md)' }}>
                    <RateInput
                        label="Eigentumsanteil (%)"
                        placeholder="100"
                        value={portfolioForm.ownership_percent}
                        onChange={(e) => setPortfolioForm({ ...portfolioForm, ownership_percent: e.target.value })}
                    />
                </div>
            </Modal>

            {/* Delete Portfolio Modal */}
            {(() => {
                const transferTargets = ownPortfolios.filter(p => p.id !== portfolioToDelete?.id);
                const impactEntries = deleteImpact
                    ? IMPACT_LABELS.filter(([key]) => deleteImpact[key] === null || deleteImpact[key] > 0)
                    : [];
                const n = (key) => (deleteImpact && deleteImpact[key]) || 0;
                const hasBlockingForDelete = !!deleteImpact && (n('invoices') > 0 || n('loans') > 0
                    || ((n('documents') > 0 || n('claims') > 0) && n('properties') > 0)
                    || deleteImpact.invoices === null || deleteImpact.loans === null || deleteImpact.properties === null);
                const deleteDisabled = isDeleting || loadingDeleteImpact
                    || (!targetPortfolioId && (hasBlockingForDelete || (n('properties') > 0 && !deleteProperties)));

                return (
                    <Modal
                        isOpen={isDeleteModalOpen}
                        onClose={() => { if (!isDeleting) setIsDeleteModalOpen(false); }}
                        title="Portfolio löschen"
                        maxWidth="620px"
                        footer={
                            <>
                                <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>Abbrechen</Button>
                                <Button variant="danger" onClick={handleExecuteDelete} disabled={deleteDisabled}>
                                    {isDeleting ? 'Wird ausgeführt...' : (targetPortfolioId ? 'Übertragen & Portfolio löschen' : 'Endgültig löschen')}
                                </Button>
                            </>
                        }
                    >
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <p style={{ marginBottom: 'var(--spacing-md)' }}>
                                Möchten Sie das Portfolio <strong>{portfolioToDelete?.name}</strong> wirklich löschen?
                            </p>

                            {/* Was hängt an diesem Portfolio? */}
                            <div style={{ backgroundColor: 'var(--background-color)', padding: '12px 15px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginBottom: 'var(--spacing-md)', fontSize: '0.875rem' }}>
                                <div style={{ fontWeight: 600, marginBottom: '6px' }}>An diesem Portfolio hängen:</div>
                                {loadingDeleteImpact ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                                        <Loader2 size={14} className="animate-spin" /> Daten werden gezählt...
                                    </div>
                                ) : impactEntries.length === 0 ? (
                                    <div style={{ color: 'var(--text-secondary)' }}>Keine Objekte, Rechnungen oder weiteren Daten.</div>
                                ) : (
                                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                                        {impactEntries.map(([key, label]) => (
                                            <li key={key}>{label}: <strong>{deleteImpact[key] === null ? 'unbekannt' : deleteImpact[key]}</strong></li>
                                        ))}
                                    </ul>
                                )}
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '8px' }}>
                                    Freigaben an andere Nutzer und die Cloud-Ordner-Verknüpfung dieses Portfolios werden in jedem Fall entfernt (Dateien in der Cloud bleiben erhalten).
                                </div>
                            </div>

                            {transferTargets.length > 0 && (
                                <div style={{ backgroundColor: 'var(--surface-color)', padding: '15px', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA', marginBottom: 'var(--spacing-md)' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#991B1B' }}>
                                        Inhalte übertragen an (empfohlen):
                                    </label>
                                    <p style={{ fontSize: '0.8rem', color: '#B91C1C', marginBottom: '10px' }}>
                                        Übertragen werden Objekte samt Einheiten, Mietverträgen, Mietkonto, Zahlungen, Abrechnungen, Dokumenten und Forderungen,
                                        außerdem Zähler und Zählerstände, Rechnungen mit Rechnungsnummern-Zähler, Darlehen und Deals. Portfolio-eigene
                                        Schreibvorlagen und die PDF-Vorlage werden übernommen, sofern das Zielportfolio keine gleichartige hat (sonst entfallen sie).
                                    </p>
                                    <select
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA', opacity: deleteProperties ? 0.5 : 1 }}
                                        value={targetPortfolioId}
                                        onChange={(e) => {
                                            setTargetPortfolioId(e.target.value);
                                            if (e.target.value) setDeleteProperties(false);
                                        }}
                                        disabled={deleteProperties || isDeleting}
                                    >
                                        <option value="">Bitte wählen...</option>
                                        {transferTargets.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {!targetPortfolioId && hasBlockingForDelete && (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', backgroundColor: '#FEF2F2', padding: '12px 15px', borderRadius: 'var(--radius-md)', border: '1px solid #FCA5A5', marginBottom: 'var(--spacing-md)', color: '#991B1B', fontSize: '0.85rem' }}>
                                    <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                                    <div>
                                        Endgültiges Löschen ist nicht möglich:
                                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
                                            {n('invoices') > 0 && <li>Rechnungen unterliegen Aufbewahrungspflichten (§ 147 AO, § 14b UStG) und werden nicht mitgelöscht.</li>}
                                            {n('loans') > 0 && <li>Darlehen müssen zuerst übertragen oder unter „Finanzierungen" gelöscht werden.</li>}
                                            {(n('documents') > 0 || n('claims') > 0) && n('properties') > 0 && <li>Dokumente bzw. Forderungsakten zu den Objekten verhindern das Löschen.</li>}
                                            {deleteImpact && (deleteImpact.invoices === null || deleteImpact.loans === null || deleteImpact.properties === null) && <li>Die abhängigen Daten konnten nicht vollständig ermittelt werden.</li>}
                                        </ul>
                                        {transferTargets.length > 0 ? 'Bitte übertragen Sie die Inhalte in ein anderes Portfolio.' : 'Legen Sie ggf. zuerst ein weiteres Portfolio an und übertragen Sie die Inhalte dorthin.'}
                                    </div>
                                </div>
                            )}

                            {n('properties') > 0 && !hasBlockingForDelete && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: '#FEF2F2', padding: '15px', borderRadius: 'var(--radius-md)', border: '1px solid #FCA5A5' }}>
                                    <input
                                        type="checkbox"
                                        id="deleteProperties"
                                        checked={deleteProperties}
                                        onChange={(e) => {
                                            setDeleteProperties(e.target.checked);
                                            if (e.target.checked) setTargetPortfolioId('');
                                        }}
                                        disabled={isDeleting}
                                        style={{ width: '18px', height: '18px', accentColor: 'var(--danger-color)', flexShrink: 0, marginTop: '2px' }}
                                    />
                                    <label htmlFor="deleteProperties" style={{ fontSize: '0.875rem', color: '#991B1B', fontWeight: 500, cursor: 'pointer' }}>
                                        Ich möchte stattdessen alles endgültig löschen: alle Objekte mit Einheiten, Mietverträgen, Mietkonto,
                                        Mietzahlungen, Nebenkostenabrechnungen, Zählern und Zählerständen (siehe Aufstellung oben).
                                        Das kann nicht rückgängig gemacht werden.
                                    </label>
                                </div>
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* Manage Keys List Modal */}
            <Modal
                isOpen={isManageKeysModalOpen}
                onClose={() => setIsManageKeysModalOpen(false)}
                title="Verteilerschlüssel verwalten"
                maxWidth="800px"
                footer={
                    <Button variant="secondary" onClick={() => setIsManageKeysModalOpen(false)}>Schließen</Button>
                }
            >
                <div>
                    {/* Doppelte Standardschlüssel werden zusammengefasst; eigene Schlüssel immer angezeigt */}
                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Verfügbare Verteilerschlüssel</h4>
                    <div className="hidden-mobile">
                        <Table
                            data={visibleKeys}
                            columns={[
                                { header: 'Name', accessor: 'name', render: r => <strong>{r.name}</strong> },
                                { header: 'Typ', accessor: 'calculation_type', render: r => <Badge>{keyTypeLabel(r.calculation_type)}</Badge> },
                                { header: 'Beschreibung', accessor: 'description' },
                                { header: '', accessor: 'actions', render: r => <span style={{ fontSize: '0.8rem', color: '#9CA3AF', fontStyle: 'italic' }}>{r.user_id ? 'Eigener' : 'Standard'}</span> }
                            ]}
                        />
                    </div>

                    {/* Mobile Card View for Available Keys */}
                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {visibleKeys.map((row) => (
                            <div key={row.id} style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                backgroundColor: 'var(--surface-color)',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                                    <Badge>{keyTypeLabel(row.calculation_type)}</Badge>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                    {row.description}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#9CA3AF', fontStyle: 'italic', textAlign: 'right' }}>
                                    {row.user_id ? 'Eigener' : 'Standard'}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ color: 'var(--text-secondary)', margin: 0 }}>Eigene Verteilerschlüssel</h4>
                        <Button icon={Plus} size="sm" onClick={() => openKeyEdit(null)}>Eigene hinzufügen</Button>
                    </div>
                    <div className="hidden-mobile">
                        <Table
                            data={distributionKeys.filter(k => k.user_id)} // Filter for user-defined keys
                            columns={[
                                { header: 'Name', accessor: 'name', render: r => <strong>{r.name}</strong> },
                                { header: 'Typ', accessor: 'calculation_type', render: r => <Badge>{keyTypeLabel(r.calculation_type)}</Badge> },
                                { header: 'Beschreibung', accessor: 'description' },
                                {
                                    header: '',
                                    accessor: 'actions',
                                    align: 'right',
                                    render: r => (
                                        <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                                            <Button variant="ghost" size="sm" icon={Edit2} onClick={() => openKeyEdit(r)} />
                                            <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteKey(r.id)} />
                                        </div>
                                    )
                                }
                            ]}
                        />
                    </div>

                    {/* Mobile Card View for Own Keys */}
                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {distributionKeys.filter(k => k.user_id).map((row) => (
                            <div key={row.id} style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                backgroundColor: 'var(--surface-color)',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                                    <Badge>{keyTypeLabel(row.calculation_type)}</Badge>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                    {row.description}
                                </div>
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <Button variant="ghost" size="sm" icon={Edit2} onClick={() => openKeyEdit(row)}>Bearbeiten</Button>
                                    <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteKey(row.id)}>Löschen</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {distributionKeys.filter(k => k.user_id).length === 0 && (
                        <div style={{ padding: '1rem', fontStyle: 'italic', color: 'var(--text-secondary)', textAlign: 'center' }}>Keine eigenen Schlüssel angelegt.</div>
                    )}
                </div>
            </Modal>

            {/* Edit Key Modal */}
            <Modal
                isOpen={isKeyEditModalOpen}
                onClose={() => setIsKeyEditModalOpen(false)}
                title={editingKey ? 'Schlüssel bearbeiten' : 'Neuer Verteilerschlüssel'}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsKeyEditModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveKey}>Speichern</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <Input
                        label="Bezeichnung"
                        value={keyForm.name}
                        onChange={e => setKeyForm({ ...keyForm, name: e.target.value })}
                        placeholder="z.B. Sonderumlage"
                    />
                    {/* Only Name & Description requested. Type hidden, defaulting to 'custom' via state init and handleSaveKey logic */}
                    <Input
                        label="Beschreibung (optional)"
                        value={keyForm.description}
                        onChange={e => setKeyForm({ ...keyForm, description: e.target.value })}
                    />
                </div>
            </Modal>

            {/* Category Modal */}
            <Modal
                isOpen={isCategoryModalOpen}
                onClose={() => setIsCategoryModalOpen(false)}
                title={editingCategory ? 'Kostenart bearbeiten' : 'Neue Kostenart'}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCategoryModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveCategory}>Speichern</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="Bezeichnung"
                        value={categoryForm.name}
                        onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                        placeholder="z.B. Heizkosten"
                    />
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Standard-Verteilerschlüssel</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={categoryForm.distribution_key_id}
                            onChange={e => setCategoryForm({ ...categoryForm, distribution_key_id: e.target.value })}
                        >
                            <option value="">Bitte wählen...</option>
                            {/* Standardschlüssel zusammengefasst, eigene Schlüssel gekennzeichnet */}
                            {visibleKeys.map(k => (
                                <option key={k.id} value={k.id}>{k.user_id ? `${k.name} (eigener)` : k.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                            <input
                                type="checkbox"
                                checked={categoryForm.is_recoverable}
                                onChange={(e) => setCategoryForm({ ...categoryForm, is_recoverable: e.target.checked })}
                                style={{ width: '16px', height: '16px' }}
                            />
                            Umlagefähig (auf Mieter)
                        </label>
                    </div>
                </div>
            </Modal>

            {/* Email Modal */}
            <Modal
                isOpen={isEmailModalOpen}
                onClose={() => setIsEmailModalOpen(false)}
                title="E-Mailadresse ändern"
                footer={<><Button variant="secondary" onClick={() => setIsEmailModalOpen(false)}>Abbrechen</Button><Button onClick={handleUpdateEmail}>Speichern</Button></>}
            >
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <form autoComplete="off" style={{ display: 'contents' }}>
                        {/* Hidden inputs to trick browser managers */}
                        <input style={{ display: 'none' }} type="text" name="fakeusernameremembered" />
                        <input style={{ display: 'none' }} type="password" name="fakepasswordremembered" />

                        <Input
                            label="Neue E-Mailadresse"
                            type="email"
                            value={emailForm.newEmail}
                            onChange={e => setEmailForm({ ...emailForm, newEmail: e.target.value })}
                            autoComplete="off"
                            name="new_email_custom_field"
                        />
                        <Input
                            label="Bestätigung: Aktuelles Passwort"
                            type="password"
                            value={emailForm.currentPassword}
                            onChange={e => setEmailForm({ ...emailForm, currentPassword: e.target.value })}
                            autoComplete="new-password"
                            name="current_password_confirm_custom"
                        />
                    </form>
                </div>
            </Modal>

            {/* Password Modal */}
            <Modal
                isOpen={isPasswordModalOpen}
                onClose={() => setIsPasswordModalOpen(false)}
                title="Passwort ändern"
                footer={<><Button variant="secondary" onClick={() => setIsPasswordModalOpen(false)}>Abbrechen</Button><Button onClick={handleUpdatePassword}>Speichern</Button></>}
            >
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <form autoComplete="off" style={{ display: 'contents' }}>
                        {/* Hidden inputs to trick browser managers */}
                        <input style={{ display: 'none' }} type="text" name="fakeusernameremembered2" />
                        <input style={{ display: 'none' }} type="password" name="fakepasswordremembered2" />

                        <Input
                            label="Bestätigung: Aktuelles Passwort"
                            type="password"
                            value={passwordForm.currentPassword}
                            onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                            autoComplete="new-password"
                            name="current_pass_verify_custom"
                        />
                        <hr style={{ border: '0', borderTop: '1px solid var(--border-color)', margin: '0' }} />
                        <Input
                            label="Neues Passwort"
                            type="password"
                            value={passwordForm.newPassword}
                            onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                            autoComplete="new-password"
                            name="new_pass_custom"
                        />
                        <Input
                            label="Neues Passwort wiederholen"
                            type="password"
                            value={passwordForm.confirmPassword}
                            onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                            autoComplete="new-password"
                            name="confirm_pass_custom"
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</p>
                    </form>
                </div>
            </Modal>
        </div>
    );
};

export default Settings;
