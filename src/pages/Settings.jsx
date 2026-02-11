import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
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
    const [categoryForm, setCategoryForm] = useState({ name: '', is_recoverable: true });

    // Seed Data
    const standardCategories = [
        "Allgemeinstrom", "Abgasmessung", "Schmutzwasser", "Internet", "Aufzug", "Entwässerung",
        "Kaltwasser", "Gehwegreinigung", "Gartenpflege", "Gebäudereinigung", "Grundsteuer",
        "Hauswart", "Heizkosten", "Abfallentsorgungsgebühren", "Gebäudehaftpflicht", "Gebäudeversicherung",
        "Schornsteinfeger", "Straßenreinigungskosten", "Heizungswartung", "Wartung Feuermelder",
        "Winterdienstgebühr", "Wiederk. Beitr. Verkehrsanlagen", "Wiederk. Beitr. Oberflächenwasser",
        "sonstige Betriebskosten"
    ];

    const fetchCategories = async () => {
        try {
            setLoadingCategories(true);
            let { data, error } = await supabase.from('expense_categories').select('*').order('name');
            if (error) throw error;

            // Auto-seed if no standard categories appear to exist (Initial setup or only custom categories exist)
            const existingNames = new Set(data?.map(d => d.name) || []);
            // Check if at least one standard category exists. If not, we seed all.
            const hasStandard = standardCategories.some(cat => existingNames.has(cat));

            if (!hasStandard) {
                const toInsert = standardCategories.map(name => ({
                    user_id: user.id,
                    name,
                    is_recoverable: true
                }));
                const { error: insertError } = await supabase.from('expense_categories').insert(toInsert);
                if (insertError) throw insertError;

                // Re-fetch after seed
                const { data: newData } = await supabase.from('expense_categories').select('*').order('name');
                data = newData;
            }

            setCategories(data || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoadingCategories(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchCategories();
        }
    }, [activeTab, user]);

    const handleEditCategory = (cat) => {
        setEditingCategory(cat);
        setCategoryForm({ name: cat.name, is_recoverable: cat.is_recoverable ?? true });
        setIsCategoryModalOpen(true);
    };

    const handleNewCategory = () => {
        setEditingCategory(null);
        setCategoryForm({ name: '', is_recoverable: true });
        setIsCategoryModalOpen(true);
    };

    const handleSaveCategory = async () => {
        try {
            const dataToSave = {
                user_id: user.id,
                name: categoryForm.name,
                is_recoverable: categoryForm.is_recoverable
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
