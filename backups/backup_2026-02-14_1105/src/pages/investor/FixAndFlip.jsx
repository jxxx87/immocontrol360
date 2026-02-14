import React from 'react';
import { Hammer } from 'lucide-react';

const FixAndFlip = () => (
    <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>Fix & Flip</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
            Immobilien-Flipping-Projekte planen und verfolgen.
        </p>
        <div style={{
            backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)', padding: '60px 40px', textAlign: 'center'
        }}>
            <Hammer size={48} color="var(--border-color)" />
            <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                Dieses Modul wird in Kürze verfügbar sein.
            </p>
        </div>
    </div>
);

export default FixAndFlip;
