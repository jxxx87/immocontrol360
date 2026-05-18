import React from 'react';
import { BarChart3 } from 'lucide-react';

const AssetManagement = () => (
    <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>Asset Management</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
            Portfolio-Überblick und Vermögensverwaltung.
        </p>
        <div style={{
            backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)', padding: '60px 40px', textAlign: 'center'
        }}>
            <BarChart3 size={48} color="var(--border-color)" />
            <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                Dieses Modul wird in Kürze verfügbar sein.
            </p>
        </div>
    </div>
);

export default AssetManagement;
