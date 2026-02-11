import React, { useState, useEffect } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { Plus, Printer, FileText, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';

const Invoices = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchInvoices = async () => {
        try {
            setLoading(true);
            let query = supabase
                .from('invoices')
                .select(`
                    *,
                    contact:contacts(name)
                `)
                .order('invoice_date', { ascending: false });

            if (selectedPortfolioID) {
                query = query.eq('portfolio_id', selectedPortfolioID);
            }

            const { data, error } = await query;
            if (error) throw error;
            setInvoices(data || []);
        } catch (error) {
            console.error('Error fetching invoices:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchInvoices();
        }
    }, [user, selectedPortfolioID]);

    const columns = [
        { header: 'Rechnungs-Nr.', accessor: 'invoice_number' },
        {
            header: 'Datum',
            accessor: 'invoice_date',
            render: (row) => row.invoice_date ? new Date(row.invoice_date).toLocaleDateString() : '-'
        },
        {
            header: 'Empfänger',
            accessor: 'contact',
            render: (row) => row.contact?.name || '-'
        },
        {
            header: 'Typ',
            accessor: 'type',
            render: () => 'Rechnung' // Static for now, could be dynamic based on other fields
        },
        {
            header: 'Brutto Betrag',
            accessor: 'gross_amount',
            align: 'right',
            render: (row) => <span style={{ fontWeight: 600 }}>{Number(row.gross_amount || 0).toFixed(2)} €</span>
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => {
                const variants = {
                    'paid': 'success',
                    'sent': 'blue',
                    'draft': 'default',
                    'canceled': 'danger'
                };
                // Map DB status to Display status
                const labels = {
                    'paid': 'Bezahlt',
                    'sent': 'Versendet',
                    'draft': 'Entwurf',
                    'canceled': 'Storniert'
                };
                return <Badge variant={variants[row.status] || 'default'}>{labels[row.status] || row.status}</Badge>;
            }
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: () => (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={Printer} />
                    <Button variant="ghost" size="sm" icon={FileText} />
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Rechnungen</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Rechnungen</p>
                </div>
                <Button icon={Plus} onClick={() => setIsModalOpen(true)}>Neue Rechnung</Button>
            </div>

            <Card>
                {invoices.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Rechnungen gefunden.
                    </div>
                ) : (
                    <Table columns={columns} data={invoices} />
                )}
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Neue Rechnung erstellen"
                footer={<Button onClick={() => setIsModalOpen(false)}>Erstellen (Demo)</Button>}
            >
                <div style={{ padding: 'var(--spacing-lg)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Die Rechnungserstellung mit automatischer Nummernvergabe wird im nächsten Schritt implementiert.
                </div>
            </Modal>
        </div>
    );
};

export default Invoices;
