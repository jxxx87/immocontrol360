import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

export const ProtectedRoute = ({ children }) => {
    const { session, loading } = useAuth();

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Lade...</div>;
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return children;
};
