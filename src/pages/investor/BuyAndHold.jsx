import React from 'react';
import { TrendingUp } from 'lucide-react';

const BuyAndHold = () => (
    <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>Buy & Hold</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
            Langfristige Immobilieninvestments analysieren und verwalten.
        </p>
        <div style={{
            backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)', padding: '60px 40px', textAlign: 'center'
        }}>
            <TrendingUp size={48} color="var(--border-color)" />
            <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                Dieses Modul wird in Kürze verfügbar sein.
            </p>
        </div>
    </div>
);

export default BuyAndHold;
