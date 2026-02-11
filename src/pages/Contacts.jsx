import React, { useState, useEffect } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { Plus, Phone, Mail, MapPin, Loader2, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

const Contacts = () => {
    const { user } = useAuth();
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        contact_type: 'other',
        email: '',
        phone: '',
        street: '',
        zip: '',
        city: ''
    });

    const fetchContacts = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('contacts')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setContacts(data || []);
        } catch (error) {
            console.error('Error fetching contacts:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchContacts();
        }
    }, [user]);

    const handleSave = async () => {
        try {
            const { error } = await supabase.from('contacts').insert([
                {
                    user_id: user.id,
                    name: formData.name,
                    contact_type: formData.contact_type,
                    email: formData.email,
                    phone: formData.phone,
                    street: formData.street,
                    zip: formData.zip,
                    city: formData.city
                }
            ]);

            if (error) throw error;
            setIsModalOpen(false);
            setFormData({
                name: '', contact_type: 'other', email: '', phone: '',
                street: '', zip: '', city: ''
            });
            fetchContacts();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const columns = [
        {
            header: 'Name',
            accessor: 'name',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: '#F1F5F9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: 'var(--text-secondary)'
                    }}>
                        <User size={16} />
                    </div>
                    <span style={{ fontWeight: 600 }}>{row.name}</span>
                </div>
            )
        },
        {
            header: 'Kategorie',
            accessor: 'contact_type',
            render: (row) => {
                const map = {
                    'guest': 'Gast',
                    'tenant': 'Mieter',
                    'vendor': 'Dienstleister',
                    'other': 'Sonstiges'
                };
                return <Badge variant={row.contact_type === 'vendor' ? 'blue' : 'default'}>
                    {map[row.contact_type] || row.contact_type}
                </Badge>;
            }
        },
        {
            header: 'Kontakt',
            accessor: 'contact',
            render: (row) => (
                <div>
                    {row.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            <Phone size={12} /> {row.phone}
                        </div>
                    )}
                    {row.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            <Mail size={12} /> {row.email}
                        </div>
                    )}
                </div>
            )
        },
        {
            header: 'Adresse',
            accessor: 'address',
            render: (row) => (
                <div style={{ fontSize: '0.875rem' }}>
                    {row.street && <div>{row.street}</div>}
                    {(row.zip || row.city) && <div style={{ color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>}
                </div>
            )
        },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: () => <Button variant="ghost" size="sm">Bearbeiten</Button>
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Kontakte</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Dienstleister, Mieter und Partner verwalten</p>
                </div>
                <Button icon={Plus} onClick={() => setIsModalOpen(true)}>Kontakt erstellen</Button>
            </div>

            <Card>
                {contacts.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Kontakte gefunden.
                    </div>
                ) : (
                    <Table columns={columns} data={contacts} />
                )}
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Neuen Kontakt anlegen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSave}>Speichern</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Typ
                    </label>
                    <select
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            outline: 'none',
                        }}
                        value={formData.contact_type}
                        onChange={(e) => setFormData({ ...formData, contact_type: e.target.value })}
                    >
                        <option value="other">Sonstiges</option>
                        <option value="vendor">Dienstleister / Handwerker</option>
                        <option value="tenant">Mieter</option>
                        <option value="guest">Gast</option>
                    </select>
                </div>

                <Input
                    label="Name / Firma"
                    placeholder="Muster GmbH"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="E-Mail"
                        type="email"
                        placeholder="info@..."
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <Input
                        label="Telefon"
                        placeholder="+49..."
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                </div>

                <Input
                    label="Straße & Nr."
                    placeholder=""
                    value={formData.street}
                    onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="PLZ"
                        placeholder=""
                        value={formData.zip}
                        onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                    />
                    <Input
                        label="Ort"
                        placeholder=""
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default Contacts;
