import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';

import Tenants from './pages/Tenants';
import Finance from './pages/Finance';
import UtilityCosts from './pages/UtilityCosts';
import Invoices from './pages/Invoices';
import InvoiceForm from './pages/InvoiceForm';
import Meters from './pages/Meters';
import Contacts from './pages/Contacts';
import Documents from './pages/Documents';
import Settings from './pages/Settings';
import PlaceholderPage from './pages/PlaceholderPage';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ResetPassword from './pages/auth/ResetPassword';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { ProtectedRoute } from './ProtectedRoute';

// Helper to redirect authenticated users away from auth pages
const AuthRoute = ({ children }) => {
  const { session } = useAuth();
  if (session) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <PortfolioProvider>
          <Routes>
            {/* Public Auth Routes */}
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
            <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
            <Route path="/reset-password" element={<AuthRoute><ResetPassword /></AuthRoute>} />

            {/* Protected App Routes */}
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="properties" element={<Properties />} />

              <Route path="tenants" element={<Tenants />} />
              <Route path="finance" element={<Finance />} />
              <Route path="utility-costs" element={<UtilityCosts />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="invoices/new" element={<InvoiceForm />} />
              <Route path="invoices/edit/:id" element={<InvoiceForm />} />
              <Route path="meters" element={<Meters />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="documents" element={<Documents />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </PortfolioProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
