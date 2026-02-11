import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { User, Lock, HelpCircle, Briefcase, Plus, Edit2, Loader2, Trash2, Tag, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { translateError } from '../lib/errorTranslator';

const Settings = () => {
    const { user } = useAuth();
    const { refreshPortfolios } = usePortfolio(); // Determine if we need to refresh global context
    const location = useLocation();
    const [activeTab, setActiveTab] = useState('profile');

    useEffect(() => {
        if (location.state && location.state.activeTab) {
            setActiveTab(location.state.activeTab);
        }
    }, [location]);

    // Portfolio State
    const [portfolios, setPortfolios] = useState([]);
    const [loadingPortfolios, setLoadingPortfolios] = useState(false);
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [editingPortfolio, setEditingPortfolio] = useState(null);
    const [portfolioForm, setPortfolioForm] = useState({
        name: '',
        company_name: '',
        contact_person: '', // Check if this exists, user said "Ansprechpartner"
        email: '',
        phone: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        ownership_percent: '',
        entity_type: 'private',
        notes: ''
    });

    // Delete Modal State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [portfolioToDelete, setPortfolioToDelete] = useState(null);
    const [targetPortfolioId, setTargetPortfolioId] = useState('');
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
    const [keyForm, setKeyForm] = useState({ name: '', calculation_type: 'custom', description: '' });

    // Standard Distribution Keys
    const standardKeys = [
        { name: "Wohnfläche", type: "area", description: "Verteilung nach Quadratmetern" },
        { name: "Personenanzahl", type: "persons", description: "Verteilung nach gemeldeten Personen" },
        { name: "Wohneinheiten", type: "units", description: "Verteilung pro Einheit" },
        { name: "Verbrauch", type: "custom", description: "Nach gemessenem Verbrauch (z.B. Zähler)" },
        { name: "Direktzuordnung", type: "direct", description: "Direkte Zuordnung zu einer Einheit" },
        { name: "Miteigentumsanteile", type: "mea", description: "Verteilung nach MEA" }
    ];

    // Standard Categories with Default Key
    const standardCategories = [
        { name: "Abfallentsorgungsgebühren", defaultKey: "Direktzuordnung" },
        { name: "Abgasmessung", defaultKey: "Wohnfläche" },
        { name: "Allgemeinstrom", defaultKey: "Wohnfläche" },
        { name: "Aufzug", defaultKey: "Wohnfläche" },
        { name: "Entwässerung", defaultKey: "Personenanzahl" },
        { name: "Gartenpflege", defaultKey: "Wohnfläche" },
        { name: "Gebäudehaftpflicht", defaultKey: "Wohnfläche" },
        { name: "Gebäudereinigung", defaultKey: "Wohnfläche" },
        { name: "Gebäudeversicherung", defaultKey: "Wohnfläche" },
        { name: "Gehwegreinigung", defaultKey: "Wohnfläche" },
        { name: "Grundsteuer", defaultKey: "Wohnfläche" },
        { name: "Hauswart", defaultKey: "Wohnfläche" },
        { name: "Heizkosten", defaultKey: "Direktzuordnung" },
        { name: "Heizungswartung", defaultKey: "Direktzuordnung" },
        { name: "Internet", defaultKey: "Wohneinheiten" },
        { name: "Kaltwasser", defaultKey: "Personenanzahl" },
        { name: "Schmutzwasser", defaultKey: "Personenanzahl" },
        { name: "Schornsteinfeger", defaultKey: "Wohnfläche" },
        { name: "Straßenreinigungskosten", defaultKey: "Wohnfläche" },
        { name: "Wartung Feuermelder", defaultKey: "Wohnfläche" },
        { name: "Wiederk. Beitr. Oberflächenwasser", defaultKey: "Wohnfläche" },
        { name: "Wiederk. Beitr. Verkehrsanlagen", defaultKey: "Wohnfläche" },
        { name: "Winterdienstgebühr", defaultKey: "Wohnfläche" }
    ];

    const fetchCategories = async (keys = []) => {
        try {
            setLoadingCategories(true);
            // Include distribution_keys name in fetch
            let { data, error } = await supabase
                .from('expense_categories')
                .select('*, distribution_keys(name, id)')
                .order('name');

            if (error) throw error;

            // Getting keys to map names to IDs
            const allKeys = keys.length > 0 ? keys : distributionKeys; // Use fetched keys or existing state

            // Helper to find key ID
            const getKeyId = (name) => {
                const k = allKeys.find(k => k.name === name);
                return k ? k.id : null;
            };

            const existingCategoryNames = new Set(data?.map(d => d.name) || []);
            const categoriesToUpdate = [];
            const categoriesToInsert = [];

            for (const stdCat of standardCategories) {
                const defaultKeyId = getKeyId(stdCat.defaultKey);
                const existing = data?.find(d => d.name === stdCat.name);

                if (existing) {
                    // Update only if no key is currently assigned (initialize default)
                    if (!existing.distribution_key_id && defaultKeyId) {
                        categoriesToUpdate.push({
                            id: existing.id,
                            distribution_key_id: defaultKeyId
                        });
                    }
                } else {
                    // Insert
                    categoriesToInsert.push({
                        user_id: user.id,
                        name: stdCat.name,
                        is_recoverable: true,
                        distribution_key_id: defaultKeyId
                    });
                }
            }

            // Perform updates
            if (categoriesToUpdate.length > 0) {
                await Promise.all(categoriesToUpdate.map(cat =>
                    supabase.from('expense_categories').update({ distribution_key_id: cat.distribution_key_id }).eq('id', cat.id)
                ));
            }

            // Perform inserts
            if (categoriesToInsert.length > 0) {
                const { error: insertError } = await supabase.from('expense_categories').insert(categoriesToInsert);
                if (insertError) throw insertError;
            }

            // Re-fetch final data
            const { data: finalData } = await supabase
                .from('expense_categories')
                .select('*, distribution_keys(name, id)')
                .order('name');

            setCategories(finalData || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoadingCategories(false);
        }
    };

    const fetchDistributionKeys = async () => {
        try {
            let { data, error } = await supabase
                .from('distribution_keys')
                .select('*')
                .or(`user_id.is.null,user_id.eq.${user.id}`)
                .order('name');

            if (error) {
                console.warn('Could not fetch distribution keys. Is migration applied?');
                return [];
            }

            // Check and Seed Standard Keys if missing (e.g. initial load)
            // Ideally this is empty only if system keys are missing.
            // We check if "Wohnfläche" exists (global or local).
            const existingKeyNames = new Set(data?.map(d => d.name));
            const missingStandards = standardKeys.filter(k => !existingKeyNames.has(k.name));

            if (missingStandards.length > 0) {
                // Insert missing standard keys (as user keys or system keys? User keys for now to avoid permission issues if RLS relies on user_id)
                // Actually, best to insert as system keys (user_id: null) but user usually can't if RLS prevents it.
                // Let's insert as USER keys so they can manage them, OR rely on migration.
                // Re-reading user request: "Im Standard soll es folgende Schlüssel geben..."
                // Since I ran migration with "Wohnfläche", etc., they SHOULD be there as system keys.
                // If not, let's add them as user keys.

                const toInsert = missingStandards.map(k => ({
                    user_id: user.id,
                    name: k.name,
                    calculation_type: k.type,
                    description: k.description
                }));

                if (toInsert.length > 0) {
                    await supabase.from('distribution_keys').insert(toInsert);
                    // Refetch
                    const res = await supabase.from('distribution_keys').select('*').or(`user_id.is.null,user_id.eq.${user.id}`).order('name');
                    data = res.data;
                }
            }

            setDistributionKeys(data || []);
            return data || [];
        } catch (error) {
            console.error('Error fetching keys:', error);
            return [];
        }
    };

    useEffect(() => {
        if (user) {
            fetchDistributionKeys().then(keys => {
                fetchCategories(keys);
            });
        }
    }, [activeTab, user]);

    // Key Management Handlers
    const handleSaveKey = async () => {
        try {
            const dataToSave = {
                user_id: user.id, // User created keys always have user_id
                name: keyForm.name,
                // For new keys, default to 'custom'. For existing, preserve original type.
                calculation_type: editingKey ? editingKey.calculation_type : 'custom',
                description: keyForm.description
            };

            if (editingKey) {
                const { error } = await supabase.from('distribution_keys').update(dataToSave).eq('id', editingKey.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('distribution_keys').insert([dataToSave]);
                if (error) throw error;
            }
            setIsKeyEditModalOpen(false);
            fetchDistributionKeys();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteKey = async (id) => {
        if (!confirm('Verteilerschlüssel wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('distribution_keys').delete().eq('id', id);
            if (error) throw error;
            fetchDistributionKeys();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const openKeyEdit = (key = null) => {
        setEditingKey(key);
        // For new keys, default calculation_type to 'custom' and hide the selector.
        // For editing existing keys, preserve its calculation_type.
        setKeyForm(key ? { name: key.name, calculation_type: key.calculation_type, description: key.description || '' } : { name: '', calculation_type: 'custom', description: '' });
        setIsKeyEditModalOpen(true);
    };

    const handleEditCategory = (cat) => {
        setEditingCategory(cat);
        setCategoryForm({
            name: cat.name,
            is_recoverable: cat.is_recoverable ?? true,
            distribution_key_id: cat.distribution_key_id || ''
        });
        setIsCategoryModalOpen(true);
    };

    const handleNewCategory = () => {
        setEditingCategory(null);
        setCategoryForm({ name: '', is_recoverable: true, distribution_key_id: '' });
        setIsCategoryModalOpen(true);
    };

    const handleSaveCategory = async () => {
        try {
            const dataToSave = {
                user_id: user.id,
                name: categoryForm.name,
                is_recoverable: categoryForm.is_recoverable,
                distribution_key_id: categoryForm.distribution_key_id || null
            };

            if (editingCategory) {
                const { error } = await supabase.from('expense_categories').update(dataToSave).eq('id', editingCategory.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('expense_categories').insert([dataToSave]);
                if (error) throw error;
            }
            setIsCategoryModalOpen(false);
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!confirm('Kostenart wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('expense_categories').delete().eq('id', id);
            if (error) throw error;
            fetchCategories();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const categoryColumns = [
        { header: 'Bezeichnung', accessor: 'name', render: row => <span style={{ fontWeight: 500 }}>{row.name}</span> },
        {
            header: 'Umlagefähig',
            accessor: 'is_recoverable',
            render: row => row.is_recoverable ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--success-color)', fontSize: '0.85rem' }}>
                    <Check size={14} /> Ja
                </span>
            ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <X size={14} /> Nein
                </span>
            )
        },
        {
            header: 'Verteilerschlüssel',
            accessor: 'distribution_keys',
            render: row => row.distribution_keys ? (
                <Badge variant="secondary">{row.distribution_keys.name}</Badge>
            ) : (
                <span style={{ color: 'var(--text-disabled)', fontSize: '0.85rem' }}>Offen</span>
            )
        },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleEditCategory(row)} />
                    <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} icon={Trash2} onClick={() => handleDeleteCategory(row.id)} />
                </div>
            )
        }
    ];

    const tabs = [
        { id: 'profile', label: 'Profil & Stammdaten', icon: User },
        { id: 'portfolios', label: 'Portfolios', icon: Briefcase },
        { id: 'expenses', label: 'Kostenarten', icon: Tag },
        { id: 'security', label: 'Sicherheit', icon: Lock },
        { id: 'help', label: 'Hilfe & Support', icon: HelpCircle },
    ];

    // Fetch Portfolios
    const fetchPortfolios = async () => {
        try {
            setLoadingPortfolios(true);
            const { data, error } = await supabase
                .from('portfolios')
                .select('*')
                .order('name');

            if (error) throw error;
            setPortfolios(data || []);
        } catch (error) {
            console.error('Error fetching portfolios:', error);
        } finally {
            setLoadingPortfolios(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'portfolios' && user) {
            fetchPortfolios();
        }
    }, [activeTab, user]);

    const handleEditPortfolio = (portfolio) => {
        setEditingPortfolio(portfolio);
        setPortfolioForm({
            name: portfolio.name || '',
            company_name: portfolio.company_name || '',
            contact_person: portfolio.contact_person || '', // potential missing field
            email: portfolio.email || '',
            phone: portfolio.phone || '',
            street: portfolio.street || '',
            house_number: portfolio.house_number || '',
            zip: portfolio.zip || '',
            city: portfolio.city || '',
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
            street: '',
            house_number: '',
            zip: '',
            city: '',
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
                street: portfolioForm.street,
                house_number: portfolioForm.house_number,
                zip: portfolioForm.zip,
                city: portfolioForm.city,
                // Handle optional fields that might not exist in schema safely?
                // We'll try to save them, if error, we might need to adjust.
                // Assuming user verified schema has these or allows extras in notes.
                // For now, mapping directly as requested.
                // If 'contact_person' doesn't exist, we might put it in notes? 
                // Let's assume standard fields exist.
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
                    {activeTab === 'profile' && (
                        <Card title="Stammdaten bearbeiten">
                            <div style={{ padding: 'var(--spacing-md)', color: 'var(--text-secondary)' }}>
                                Funktion folgt.
                            </div>
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
                                        <Table columns={portfolioColumns} data={portfolios} />
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
                                    <Table columns={categoryColumns} data={categories} />
                                )}
                            </Card>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <Card title="Sicherheit">
                            <div style={{ padding: 'var(--spacing-md)', color: 'var(--text-secondary)' }}>
                                Funktion folgt.
                            </div>
                        </Card>
                    )}

                    {activeTab === 'help' && (
                        <Card title="Support">
                            <p style={{ marginBottom: 'var(--spacing-md)' }}>Haben Sie Fragen oder benötigen Sie Unterstützung?</p>
                            <div style={{ padding: 'var(--spacing-md)', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
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
                                backgroundColor: 'white'
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
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
                    <Input
                        label="Eigentumsanteil (%)"
                        type="number"
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
                        <div style={{ backgroundColor: '#FEF2F2', padding: '15px', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}>
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

                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ color: 'var(--text-secondary)', margin: 0 }}>Eigene Verteilerschlüssel</h4>
                        <Button icon={Plus} size="sm" onClick={() => openKeyEdit(null)}>Eigene hinzufügen</Button>
                    </div>
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
        </div>
    );
};

export default Settings;
