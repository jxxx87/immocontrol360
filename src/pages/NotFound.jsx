import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import Card from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';

// Unbekannte Adresse innerhalb der App (statt stiller Umleitung zur Startseite)
const NotFound = () => {
    const { userRole } = useAuth();
    const location = useLocation();
    const homePath = userRole === 'tenant' ? '/tenant' : '/';

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-xl) var(--spacing-md)' }}>
            <Card style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--spacing-md)', color: 'var(--text-secondary)' }}>
                    <SearchX size={40} aria-hidden="true" />
                </div>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--spacing-sm)' }}>
                    Seite nicht gefunden
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    Die Adresse <code>{location.pathname}</code> gibt es in ImmoControl360 nicht.
                    Möglicherweise ist der Link veraltet oder falsch geschrieben.
                </p>
                <Link to={homePath} className="btn btn-primary btn-md">
                    Zur Startseite
                </Link>
            </Card>
        </div>
    );
};

export default NotFound;
