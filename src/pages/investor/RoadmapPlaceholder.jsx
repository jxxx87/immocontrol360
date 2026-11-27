import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Platzhalter für geplante Investor-Module (Roadmap). Verweist auf die Stelle,
 * an der die vorhandene Funktion heute schon genutzt werden kann.
 */
const RoadmapPlaceholder = ({ title, subtitle, icon: Icon, hint, linkTo, linkLabel }) => (
    <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>{title}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
            {subtitle}
        </p>
        <div style={{
            backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)', padding: '60px 40px', textAlign: 'center'
        }}>
            {Icon && <Icon size={48} color="var(--border-color)" />}
            <p style={{ color: 'var(--text-secondary)', marginTop: '12px', fontWeight: 600 }}>
                Geplantes Modul – noch nicht verfügbar.
            </p>
            {hint && (
                <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '0.88rem' }}>
                    {hint}
                </p>
            )}
            {linkTo && (
                <Link to={linkTo} className="btn btn-primary btn-md" style={{ display: 'inline-flex', marginTop: '16px', textDecoration: 'none' }}>
                    {linkLabel}
                </Link>
            )}
        </div>
    </div>
);

export default RoadmapPlaceholder;
