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
import Loans from './pages/Loans';
import Documents from './pages/Documents';
import Settings from './pages/Settings';
import Import from './pages/Import';
import PlaceholderPage from './pages/PlaceholderPage';
import BuyAndHold from './pages/investor/BuyAndHold';
import FixAndFlip from './pages/investor/FixAndFlip';
import TaxAndExit from './pages/investor/TaxAndExit';
import AssetManagement from './pages/investor/AssetManagement';
import InvestorPortal from './pages/InvestorPortal';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ResetPassword from './pages/auth/ResetPassword';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { ProtectedRoute } from './ProtectedRoute';
import { ViewModeProvider } from './context/ViewModeContext';

// ── Tenant Portal Pages ──
import TenantDashboard from './pages/tenant/TenantDashboard';
import TenantTickets from './pages/tenant/TenantTickets';
import TenantMessages from './pages/tenant/TenantMessages';
import TenantAnnouncements from './pages/tenant/TenantAnnouncements';
import TenantDocuments from './pages/tenant/TenantDocuments';

// ── Investor Portal Pages ──
import TenantManagement from './pages/TenantManagement';
import TicketKanban from './pages/TicketKanban';
import Announcements from './pages/Announcements';
import InvestorMessages from './pages/InvestorMessages';

// Helper to redirect authenticated users away from auth pages
const AuthRoute = ({ children }) => {
  const { session } = useAuth();
  if (session) return <Navigate to="/" replace />;
  return children;
};

// Role-based index: redirect tenant users to /tenant, investors to /
const RoleBasedIndex = () => {
  const { userRole } = useAuth();
  if (userRole === 'tenant') return <Navigate to="/tenant" replace />;
  return <Dashboard />;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <PortfolioProvider>
          <ViewModeProvider>
            <Routes>
              {/* Public Auth Routes */}
              <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
              <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
              <Route path="/reset-password" element={<AuthRoute><ResetPassword /></AuthRoute>} />

              {/* Protected App Routes */}
              <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<RoleBasedIndex />} />
                <Route path="properties" element={<Properties />} />

                <Route path="tenants" element={<Tenants />} />
                <Route path="finance" element={<Finance />} />
                <Route path="loans" element={<Loans />} />
                <Route path="utility-costs" element={<UtilityCosts />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="invoices/new" element={<InvoiceForm />} />
                <Route path="invoices/edit/:id" element={<InvoiceForm />} />
                <Route path="meters" element={<Meters />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="documents" element={<Documents />} />
                <Route path="settings" element={<Settings />} />
                <Route path="security" element={<PlaceholderPage title="Sicherheit" />} />
                <Route path="import" element={<Import />} />
                <Route path="help" element={<PlaceholderPage title="Hilfe" />} />

                {/* ── Investor Portal Routes ── */}
                <Route path="tenant-management" element={<TenantManagement />} />
                <Route path="ticket-board" element={<TicketKanban />} />
                <Route path="announcements" element={<Announcements />} />
                <Route path="investor-messages" element={<InvestorMessages />} />

                {/* ── Investorportal Routes ── */}
                <Route path="buy-and-hold" element={<BuyAndHold />} />
                <Route path="fix-and-flip" element={<FixAndFlip />} />
                <Route path="tax-and-exit" element={<TaxAndExit />} />
                <Route path="asset-management" element={<AssetManagement />} />
                <Route path="investor-portal" element={<InvestorPortal />} />

                {/* ── Tenant Portal Routes ── */}
                <Route path="tenant" element={<TenantDashboard />} />
                <Route path="tenant/tickets" element={<TenantTickets />} />
                <Route path="tenant/messages" element={<TenantMessages />} />
                <Route path="tenant/announcements" element={<TenantAnnouncements />} />
                <Route path="tenant/documents" element={<TenantDocuments />} />
              </Route>
            </Routes>
          </ViewModeProvider>
        </PortfolioProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
