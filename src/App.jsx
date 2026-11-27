import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';

import Tenants from './pages/Tenants';
import TenantDetail from './pages/TenantDetail';
import Finance from './pages/Finance';
import BankReconciliation from './pages/BankReconciliation';
import UtilityCosts from './pages/UtilityCosts';
import Invoices from './pages/Invoices';
import InvoiceForm from './pages/InvoiceForm';
import Meters from './pages/Meters';
import Contacts from './pages/Contacts';
import Claims from './pages/Claims';
import ClaimDetail from './pages/ClaimDetail';
import ClaimPortal from './pages/ClaimPortal';
import TenantDataUpdatePortal from './pages/TenantDataUpdatePortal';
import Loans from './pages/Loans';
import Documents from './pages/Documents';
import CloudExplorer from './pages/CloudExplorer';
import Settings from './pages/Settings';
import Letting from './pages/Letting';
import PublicLettingPortal from './pages/tenant/PublicLettingPortal';
import PublicViewingBooking from './pages/tenant/PublicViewingBooking';
import { CloudCallback } from './pages/settings/CloudCallback';
import Import from './pages/Import';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import BuyAndHold from './pages/investor/BuyAndHold';
import FixAndFlip from './pages/investor/FixAndFlip';
import TaxAndExit from './pages/investor/TaxAndExit';
import AssetManagement from './pages/investor/AssetManagement';
import InvestorPortal from './pages/InvestorPortal';
import RenovationManager from './pages/renovation/RenovationManager';
import RenovationWizard from './pages/renovation/RenovationWizard';
import RenovationProjectDetail from './pages/renovation/RenovationProjectDetail';
import RenovationCalculatorDetail from './pages/renovation/RenovationCalculatorDetail';
import FloorPlanEditor from './pages/renovation/FloorPlanEditor';
import PdfTemplateEditor from './pages/pdf-template/PdfTemplateEditor';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import PasswordRecovery from './components/layout/PasswordRecovery';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { PermissionProvider } from './context/PermissionContext';
import { ProtectedRoute, InvestorRoute, TenantRoute } from './ProtectedRoute';
import { ViewModeProvider } from './context/ViewModeContext';
import { NotificationProvider } from './context/NotificationContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import PaywallModal from './components/subscription/PaywallModal';
import BillingSuccess from './pages/BillingSuccess';
import ToastContainer from './components/ui/ToastContainer';

// ── Tenant Portal Pages ──
import TenantDashboard from './pages/tenant/TenantDashboard';
import TenantTickets from './pages/tenant/TenantTickets';
import TenantMessages from './pages/tenant/TenantMessages';
import TenantAnnouncements from './pages/tenant/TenantAnnouncements';
import TenantDocuments from './pages/tenant/TenantDocuments';
import TenantStamdaten from './pages/tenant/TenantStamdaten';

// ── Investor Portal Pages ──
import TenantManagement from './pages/TenantManagement';
import TicketKanban from './pages/TicketKanban';
import Announcements from './pages/Announcements';
import InvestorMessages from './pages/InvestorMessages';
import ObjectCalendar from './pages/ObjectCalendar';

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

// Kurzformen für die Routen-Guards (Rolle + Leserecht der Freigabe-Kategorie)
const inv = (element, category) => <InvestorRoute category={category}>{element}</InvestorRoute>;
const ten = (element) => <TenantRoute>{element}</TenantRoute>;

function App() {
  return (
    <Router>
      <AuthProvider>
        <PortfolioProvider>
          <PermissionProvider>
            <SubscriptionProvider>
              <ViewModeProvider>
                <NotificationProvider>
                  <Routes>
                    {/* Public Auth Routes */}
                    <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
                    <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
                    {/* Nicht hinter AuthRoute: der Reset-Link meldet an, danach folgt "Neues Passwort festlegen" */}
                    <Route path="/reset-password" element={<PasswordRecovery />} />
                    <Route path="/update-password" element={<PasswordRecovery />} />
                    <Route path="/billing/success" element={<BillingSuccess />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/forderung/portal/:token" element={<ClaimPortal />} />
                    <Route path="/mieterdaten/portal/:token" element={<TenantDataUpdatePortal />} />
                    <Route path="/vermietung/:token" element={<PublicLettingPortal />} />
                    <Route path="/besichtigung/:token" element={<PublicViewingBooking />} />

                    {/* Protected App Routes */}
                    <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                      <Route index element={<RoleBasedIndex />} />
                      <Route path="properties" element={inv(<Properties />, 'immobilien')} />

                      <Route path="tenants" element={inv(<Tenants />, 'mietverhaeltnisse')} />
                      <Route path="tenants/:id" element={inv(<TenantDetail />, 'mietverhaeltnisse')} />
                      <Route path="forderungen" element={inv(<Claims />, 'finanzen')} />
                      <Route path="forderungen/:claimId" element={inv(<ClaimDetail />, 'finanzen')} />
                      <Route path="finance" element={inv(<Finance />, 'finanzen')} />
                      <Route path="bank-reconciliation" element={inv(<BankReconciliation />, 'finanzen')} />
                      <Route path="loans" element={inv(<Loans />, 'finanzen')} />
                      <Route path="utility-costs" element={inv(<UtilityCosts />, 'nebenkosten')} />
                      <Route path="invoices" element={inv(<Invoices />, 'finanzen')} />
                      <Route path="invoices/new" element={inv(<InvoiceForm />, 'finanzen')} />
                      <Route path="invoices/edit/:id" element={inv(<InvoiceForm />, 'finanzen')} />
                      <Route path="meters" element={inv(<Meters />, 'zaehler')} />
                      <Route path="contacts" element={inv(<Contacts />, 'kontakte')} />
                      <Route path="documents" element={inv(<Documents />, 'immobilien')} />
                      <Route path="cloud-documents" element={inv(<CloudExplorer />, 'immobilien')} />
                      <Route path="settings" element={inv(<Settings />)} />
                      <Route path="settings/cloud/callback" element={inv(<CloudCallback />)} />
                      {/* Frühere Platzhalter-Seiten: auf die passenden Einstellungs-Reiter umleiten */}
                      <Route path="security" element={inv(<Navigate to="/settings" replace state={{ activeTab: 'security' }} />)} />
                      <Route path="import" element={inv(<Import />)} />
                      <Route path="help" element={inv(<Navigate to="/settings" replace state={{ activeTab: 'help' }} />)} />

                      {/* ── Investor Portal Routes ── */}
                      <Route path="letting" element={inv(<Letting />, 'mieterportal')} />
                      <Route path="tenant-management" element={inv(<TenantManagement />, 'mieterportal')} />
                      <Route path="ticket-board" element={inv(<TicketKanban />, 'mieterportal')} />
                      <Route path="announcements" element={inv(<Announcements />, 'mieterportal')} />
                      <Route path="investor-messages" element={inv(<InvestorMessages />, 'mieterportal')} />
                      {/* Objektkalender wird auch im Mieterportal genutzt */}
                      <Route path="object-calendar" element={<InvestorRoute category="immobilien" allowTenant><ObjectCalendar /></InvestorRoute>} />

                      {/* ── Investorportal Routes ── */}
                      <Route path="buy-and-hold" element={inv(<BuyAndHold />, 'investorportal')} />
                      <Route path="fix-and-flip" element={inv(<FixAndFlip />, 'investorportal')} />
                      <Route path="tax-and-exit" element={inv(<TaxAndExit />, 'investorportal')} />
                      <Route path="asset-management" element={inv(<AssetManagement />, 'investorportal')} />
                      <Route path="investor-portal" element={inv(<InvestorPortal />, 'investorportal')} />

                      {/* ── Sanierungsmanager Routes ── */}
                      <Route path="renovation" element={inv(<RenovationManager />, 'immobilien')} />
                      <Route path="renovation/new" element={inv(<RenovationWizard />, 'immobilien')} />
                      <Route path="renovation/:id" element={inv(<RenovationProjectDetail />, 'immobilien')} />
                      <Route path="renovation/calculator/:id" element={inv(<RenovationCalculatorDetail />, 'immobilien')} />
                      <Route path="renovation/floorplan/:id" element={inv(<FloorPlanEditor />, 'immobilien')} />

                      {/* ── PDF Template Route ── */}
                      <Route path="portfolio/settings/pdf-template" element={inv(<PdfTemplateEditor />)} />

                      {/* ── Tenant Portal Routes ── */}
                      <Route path="tenant" element={ten(<TenantDashboard />)} />
                      <Route path="tenant/tickets" element={ten(<TenantTickets />)} />
                      <Route path="tenant/messages" element={ten(<TenantMessages />)} />
                      <Route path="tenant/announcements" element={ten(<TenantAnnouncements />)} />
                      <Route path="tenant/documents" element={ten(<TenantDocuments />)} />
                      <Route path="tenant/stammdaten" element={ten(<TenantStamdaten />)} />
                    </Route>
                    {/* Catch-all route to redirect back to main index */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                  <ToastContainer />
                </NotificationProvider>
              </ViewModeProvider>
              <PaywallModal />
            </SubscriptionProvider>
          </PermissionProvider>
        </PortfolioProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
