import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import RateInput from '../components/ui/RateInput';
import { User, Lock, HelpCircle, Briefcase, Plus, Edit2, Loader2, Trash2, Tag, Check, X, Upload, PanelLeft, Settings as SettingsIcon, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { translateError } from '../lib/errorTranslator';
import ImportPage from './Import'; // Import the Import page component

const Settings = () => {
    const { user } = useAuth();
    const { refreshPortfolios } = usePortfolio(); // Determine if we need to refresh global context
    const location = useLocation();
    const [activeTab, setActiveTab] = useState('profile');

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
        }
    }, [location]);

    // Profile State
    const [loadingProfile, setLoadingProfile] = useState(false);
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
        settings_opening_hours_visible: true,
        settings_opening_hours_text: 'Mo-Fr 9:00 - 17:00 Uhr'
    });

    const fetchProfile = async () => {
        try {
            if (!user) return;
            setLoadingProfile(true);
            const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
            if (data) {
                setProfileData({
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
                    settings_opening_hours_visible: data.settings_opening_hours_visible !== false,
                    settings_opening_hours_text: data.settings_opening_hours_text || 'Mo-Fr 9:00 - 17:00 Uhr'
                });
            }
        } catch (error) {
            // Ignore error if row doesn't exist yet
            console.log('Profile fetch error or no profile:', error.message);
        } finally {
            setLoadingProfile(false);
        }
    };

    const handleSaveProfile = async () => {
        try {
            const { error } = await supabase.from('profiles').upsert({
                id: user.id,
                updated_at: new Date(),
                ...profileData
            });

            if (error) throw error;
            alert('Stammdaten gespeichert.');
        } catch (error) {
            alert(translateError(error));
        }
    };

    // Portfolio State
    const [portfolios, setPortfolios] = useState([]);
    const [loadingPortfolios, setLoadingPortfolios] = useState(false);
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [editingPortfolio, setEditingPortfolio] = useState(null);
    const [portfolioForm, setPortfolioForm] = useState({
        name: '',
        company_name: '',
        contact_person: '',
        email: '',
        phone: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        bank_name: '',
        iban: '',
        bic: '',
        ownership_percent: '',
        entity_type: 'private',
        notes: ''
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
            const { data, error } = await supabase
                .from('expense_categories')
                .select(`*, distribution_key:distribution_keys(name)`)
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

    useEffect(() => {
        if (user) {
            fetchProfile();
            fetchPortfolios();
            fetchCategories();
            fetchDistributionKeys();
        }
    }, [user, refreshPortfolios]);

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
                user_id: user.id,
                name: categoryForm.name,
                is_recoverable: categoryForm.is_recoverable,
                distribution_key_id: categoryForm.distribution_key_id || null
            };

            if (editingCategory) {
                const { error } = await supabase.from('expense_categories').update(payload).eq('id', editingCategory.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('expense_categories').insert([payload]);
                if (error) throw error;
            }
            setIsCategoryModalOpen(false);
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!window.confirm('Kostenart löschen?')) return;
        try {
            const { error } = await supabase.from('expense_categories').delete().eq('id', id);
            if (error) throw error;
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const categoryColumns = [
        { header: 'Bezeichnung', accessor: 'name', render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span> },
        { header: 'Umlagefähig', accessor: 'is_recoverable', render: (row) => <Badge variant={row.is_recoverable ? 'success' : 'default'}>{row.is_recoverable ? 'Ja' : 'Nein'}</Badge> },
        { header: 'Standard-Schlüssel', accessor: 'distribution_key', render: (row) => row.distribution_key?.name || '-' },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditCategory(row)}>Bearbeiten</Button>
                    <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteCategory(row.id)}>Löschen</Button>
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
                user_id: user.id,
                name: keyForm.name,
                description: keyForm.description,
                calculation_type: 'custom' // Always custom for user defined
            };
            if (editingKey) {
                const { error } = await supabase.from('distribution_keys').update(payload).eq('id', editingKey.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('distribution_keys').insert([payload]);
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
            const { error } = await supabase.from('distribution_keys').delete().eq('id', id);
            if (error) throw error;
            fetchDistributionKeys();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // ... (rest of component)

    const handleEditPortfolio = (portfolio) => {
        setEditingPortfolio(portfolio);
        setPortfolioForm({
            name: portfolio.name || '',
            company_name: portfolio.company_name || '',
            contact_person: portfolio.contact_person || '',
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
            ownership_percent: portfolio.ownership_percent || '',
            entity_type: portfolio.entity_type || 'private',
            notes: portfolio.notes || ''
        });
        setIsPortfolioModalOpen(true);
    };

    const handleNewPortfolio = () => {
        setEditingPortfolio(null);
        setPortfolioForm({
            name: '',
            company_name: '',
            contact_person: '',
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
            entity_type: 'private',
            notes: ''
        });
        setIsPortfolioModalOpen(true);
    };

    const handleSavePortfolio = async () => {
        try {
            const dataToSave = {
                user_id: user.id,
                name: portfolioForm.name,
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
                ownership_percent: parseFloat(portfolioForm.ownership_percent) || null,
                entity_type: portfolioForm.entity_type,
            };

            // Hack: If contact_person is requested but might not exist, we check if we should try inserting it.
            // For now, I'll include it. If it fails, I'd need to remove it.
            // dataToSave.contact_person = portfolioForm.contact_person; 

            let error;
            if (editingPortfolio) {
                const { error: updateError } = await supabase
                    .from('portfolios')
                    .update(dataToSave)
                    .eq('id', editingPortfolio.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('portfolios')
                    .insert([dataToSave]);
                error = insertError;
            }

            if (error) throw error;

            setIsPortfolioModalOpen(false);
            fetchPortfolios();
            if (refreshPortfolios) refreshPortfolios();

        } catch (error) {
            console.error('Save error:', error);
            alert(translateError(error));
        }
    };

    const handleOpenDeleteModal = (portfolio) => {
        setPortfolioToDelete(portfolio);
        setTargetPortfolioId('');
        setIsDeleteModalOpen(true);
    };

    const handleExecuteDelete = async () => {
        if (!portfolioToDelete) return;

        try {
            // Check if there are other portfolios avail
            const otherPortfolios = portfolios.filter(p => p.id !== portfolioToDelete.id);

            // If user selected a target, transfer properties
            if (targetPortfolioId) {
                const { error: updateError } = await supabase
                    .from('properties')
                    .update({ portfolio_id: targetPortfolioId })
                    .eq('portfolio_id', portfolioToDelete.id);

                if (updateError) throw updateError;
            } else if (otherPortfolios.length > 0) {
                // Check if properties exist
                const { count, error: countError } = await supabase
                    .from('properties')
                    .select('*', { count: 'exact', head: true })
                    .eq('portfolio_id', portfolioToDelete.id);

                if (countError) throw countError;

                if (count > 0 && !targetPortfolioId) {
                    alert('Dieses Portfolio enthält Immobilien. Bitte wählen Sie ein Ziel-Portfolio für den Transfer aus.');
                    return;
                }
            }

            // Delete the portfolio
            const { error: deleteError } = await supabase
                .from('portfolios')
                .delete()
                .eq('id', portfolioToDelete.id);

            if (deleteError) throw deleteError;

            // Success
            setIsDeleteModalOpen(false);
            setPortfolioToDelete(null);

            // Reload to refresh context and UI
            window.location.reload();

        } catch (error) {
            alert(translateError(error));
        }
    };

    const portfolioColumns = [
        { header: 'Name', accessor: 'name', render: row => <div style={{ fontWeight: 600 }}>{row.name}</div> },
        { header: 'Firma', accessor: 'company_name' },
        { header: 'Ort', accessor: 'city', render: row => `${row.zip || ''} ${row.city || ''}` },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditPortfolio(row)}>Bearbeiten</Button>
                    <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleOpenDeleteModal(row)}>Löschen</Button>
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
        if (passwordForm.newPassword.length < 6) {
            return alert('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
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
        { id: 'expenses', label: 'Kostenarten', icon: Tag },
        { id: 'navigation', label: 'Navigationsleiste', icon: PanelLeft },
        { id: 'security', label: 'Sicherheit', icon: Lock },
        { id: 'import', label: 'Import', icon: Upload },
        { id: 'help', label: 'Hilfe', icon: HelpCircle }
    ];

    return (
        <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xl)' }}>Einstellungen</h1>

            <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 'var(--spacing-xl)' }}>
                {/* Settings Sidebar */}
                <Card style={{ padding: '0', height: 'fit-content' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: activeTab === tab.id ? '#F3F4F6' : 'transparent',
                                    borderLeft: activeTab === tab.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    fontWeight: activeTab === tab.id ? 500 : 400,
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid var(--border-color)'
                                }}
                            >
                                <tab.icon size={18} style={{ marginRight: '10px', color: activeTab === tab.id ? 'var(--primary-color)' : 'var(--text-secondary)' }} />
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </Card>

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

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-md)' }}>
                                    <Button onClick={handleSaveProfile}>Einstellungen speichern</Button>
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
                                        <Input label="Vorname" value={profileData.first_name} onChange={e => setProfileData({ ...profileData, first_name: e.target.value })} />
                                        <Input label="Nachname" value={profileData.last_name} onChange={e => setProfileData({ ...profileData, last_name: e.target.value })} />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Straße" value={profileData.street} onChange={e => setProfileData({ ...profileData, street: e.target.value })} />
                                        <Input label="Hausnummer" value={profileData.house_number} onChange={e => setProfileData({ ...profileData, house_number: e.target.value })} />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="PLZ" value={profileData.zip} onChange={e => setProfileData({ ...profileData, zip: e.target.value })} />
                                        <Input label="Stadt" value={profileData.city} onChange={e => setProfileData({ ...profileData, city: e.target.value })} />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Telefon" value={profileData.phone} onChange={e => setProfileData({ ...profileData, phone: e.target.value })} />
                                        <Input label="Handynummer" value={profileData.mobile} onChange={e => setProfileData({ ...profileData, mobile: e.target.value })} />
                                    </div>

                                    <div>
                                        <Input label="E-Mailadresse" value={profileData.email} disabled />
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Hinweis: Die E-Mailadresse kann nur im Bereich Sicherheit geändert werden.
                                        </p>
                                    </div>

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
                                        <Button onClick={handleSaveProfile}>Übernehmen</Button>
                                    </div>
                                </div>
                            )}
                        </Card>
                    )}

                    {activeTab === 'portfolios' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Portfolios verwalten</h2>
                                <Button icon={Plus} onClick={handleNewPortfolio}>Neues Portfolio</Button>
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

                                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                            <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditPortfolio(row)}>Bearbeiten</Button>
                                                            <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleOpenDeleteModal(row)}>Löschen</Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )
                                )}
                            </Card>
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

                                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                        <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditCategory(row)}>Bearbeiten</Button>
                                                        <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteCategory(row.id)}>Löschen</Button>
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
                                                redirectTo: window.location.origin + '/update-password',
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
                                <strong>Support-Hotline:</strong> 0800 - 123 456<br />
                                <strong>E-Mail:</strong> support@immocontrol360.de
                            </div>
                        </Card>
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
            <Modal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                title="Portfolio löschen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>Abbrechen</Button>
                        <Button variant="danger" onClick={handleExecuteDelete}>Löschen</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <p style={{ marginBottom: 'var(--spacing-md)' }}>
                        Möchten Sie das Portfolio <strong>{portfolioToDelete?.name}</strong> wirklich löschen?
                    </p>

                    {portfolios.filter(p => p.id !== portfolioToDelete?.id).length > 0 && (
                        <div style={{ backgroundColor: 'var(--surface-color)', padding: '15px', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#991B1B' }}>
                                Immobilien übertragen an:
                            </label>
                            <p style={{ fontSize: '0.8rem', color: '#B91C1C', marginBottom: '10px' }}>
                                Wenn dieses Portfolio Immobilien enthält, müssen diese einem anderen Portfolio zugewiesen werden.
                            </p>
                            <select
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}
                                value={targetPortfolioId}
                                onChange={(e) => setTargetPortfolioId(e.target.value)}
                            >
                                <option value="">Bitte wählen...</option>
                                {portfolios.filter(p => p.id !== portfolioToDelete?.id).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {portfolios.filter(p => p.id !== portfolioToDelete?.id).length === 0 && (
                        <div style={{ color: 'var(--danger-color)', fontSize: '0.875rem' }}>
                            Warnung: Dies ist ihr einziges Portfolio. Löschen ist nur möglich, wenn keine Immobilien mehr zugeordnet sind.
                        </div>
                    )}
                </div>
            </Modal>

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
                    {/* Filter local duplicates if any exist (e.g. standard key also in user keys with same name) */}
                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Verfügbare Verteilerschlüssel</h4>
                    <div className="hidden-mobile">
                        <Table
                            data={distributionKeys.filter((k, index, self) =>
                                index === self.findIndex((t) => (
                                    t.name === k.name
                                ))
                            )}
                            columns={[
                                { header: 'Name', accessor: 'name', render: r => <strong>{r.name}</strong> },
                                { header: 'Typ', accessor: 'calculation_type', render: r => <Badge>{r.calculation_type === 'area' ? 'Fläche' : r.calculation_type === 'persons' ? 'Personen' : r.calculation_type === 'units' ? 'Wohneinheiten' : r.calculation_type === 'equal' ? 'Gleich' : r.calculation_type === 'direct' ? 'Direkt' : r.calculation_type === 'mea' ? 'MEA' : 'Manuell'}</Badge> },
                                { header: 'Beschreibung', accessor: 'description' },
                                { header: '', accessor: 'actions', render: r => <span style={{ fontSize: '0.8rem', color: '#9CA3AF', fontStyle: 'italic' }}>{r.user_id ? 'Eigener' : 'Standard'}</span> }
                            ]}
                        />
                    </div>

                    {/* Mobile Card View for Available Keys */}
                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {distributionKeys.filter((k, index, self) =>
                            index === self.findIndex((t) => (
                                t.name === k.name
                            ))
                        ).map((row) => (
                            <div key={row.id} style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                backgroundColor: 'var(--surface-color)',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                                    <Badge>{row.calculation_type === 'area' ? 'Fläche' : row.calculation_type === 'persons' ? 'Personen' : row.calculation_type === 'units' ? 'Wohneinheiten' : row.calculation_type === 'equal' ? 'Gleich' : row.calculation_type === 'direct' ? 'Direkt' : row.calculation_type === 'mea' ? 'MEA' : 'Manuell'}</Badge>
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
                                { header: 'Typ', accessor: 'calculation_type', render: r => <Badge>{r.calculation_type === 'area' ? 'Fläche' : r.calculation_type === 'persons' ? 'Personen' : r.calculation_type === 'units' ? 'Wohneinheiten' : r.calculation_type === 'equal' ? 'Gleich' : r.calculation_type === 'direct' ? 'Direkt' : r.calculation_type === 'mea' ? 'MEA' : 'Manuell'}</Badge> },
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
                                    <Badge>{row.calculation_type === 'area' ? 'Fläche' : row.calculation_type === 'persons' ? 'Personen' : row.calculation_type === 'units' ? 'Wohneinheiten' : row.calculation_type === 'equal' ? 'Gleich' : row.calculation_type === 'direct' ? 'Direkt' : row.calculation_type === 'mea' ? 'MEA' : 'Manuell'}</Badge>
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
                            {/* Deduplicate keys for dropdown */}
                            {distributionKeys.filter((k, index, self) =>
                                index === self.findIndex((t) => (
                                    t.name === k.name
                                ))
                            ).map(k => (
                                <option key={k.id} value={k.id}>{k.name}</option>
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
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mindestens 6 Zeichen.</p>
                    </form>
                </div>
            </Modal>
        </div>
    );
};

export default Settings;
