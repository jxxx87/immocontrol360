import React from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import { Plus, Zap, Droplets, Flame } from 'lucide-react';
import { meters, properties, units } from '../data/mockData';

const Meters = () => {
    const getIcon = (type) => {
        switch (type) {
            case 'Strom': return <Zap size={18} />;
            case 'Wasser': return <Droplets size={18} />;
            case 'Gas': return <Flame size={18} />;
            default: return <Zap size={18} />;
        }
    };

    const enrichedMeters = meters.map(m => ({
        ...m,
        propertyName: properties.find(p => p.id === m.propertyId)?.name || '-',
        unitName: units.find(u => u.id === m.unitId)?.name || 'Hauptzähler'
    }));

    const columns = [
        {
            header: 'Typ',
            accessor: 'type',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        padding: '4px',
                        borderRadius: '4px',
                        backgroundColor: '#F3F4F6',
                        display: 'flex',
                        color: 'var(--text-secondary)'
                    }}>
                        {getIcon(row.type)}
                    </div>
                    {row.type}
                </div>
            )
        },
        { header: 'Zählernummer', accessor: 'number' },
        { header: 'Immobilie', accessor: 'propertyName' },
        { header: 'Zuordnung', accessor: 'unitName' },
        { header: 'Letzter Stand', accessor: 'lastReading', align: 'right' },
        { header: 'Ablesedatum', accessor: 'lastDate', align: 'right' },
        { header: 'Nächste Ablesung', accessor: 'nextDate', align: 'right' },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: () => <Button variant="ghost" size="sm">Ablesen</Button>
        }
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Zählerstände</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht und Erfassung von Verbrauchswerten</p>
                </div>
                <Button icon={Plus}>Zähler hinzufügen</Button>
            </div>

            <Card>
                <Table columns={columns} data={enrichedMeters} />
            </Card>
        </div>
    );
};

export default Meters;
