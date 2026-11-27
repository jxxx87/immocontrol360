import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazyPage } from './lib/lazyPage';
import PageLoader from './components/ui/PageLoader';
import Layout from './components/layout/Layout';
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const Properties = lazyPage(() => import('./pages/Properties'));

const Tenants = lazyPage(() => import('./pages/Tenants'));
const TenantDetail = lazyPage(() => import('./pages/TenantDetail'));
const Finance = lazyPage(() => import('./pages/Finance'));
const BankReconciliation = lazyPage(() => import('./pages/BankReconciliation'));
const UtilityCosts = lazyPage(() => import('./pages/UtilityCosts'));
const Invoices = lazyPage(() => import('./pages/Invoices'));
const InvoiceForm = lazyPage(() => import('./pages/InvoiceForm'));
const Meters = lazyPage(() => import('./pages/Meters'));
const Contacts = lazyPage(() => import('./pages/Contacts'));
const Claims = lazyPage(() => import('./pages/Claims'));
const ClaimDetail = lazyPage(() => import('./pages/ClaimDetail'));
const ClaimPortal = lazyPage(() => import('./pages/ClaimPortal'));
const TenantDataUpdatePortal = lazyPage(() => import('./pages/TenantDataUpdatePortal'));
const Loans = lazyPage(() => import('./pages/Loans'));
const Documents = lazyPage(() => import('./pages/Documents'));
const CloudExplorer = lazyPage(() => import('./pages/CloudExplorer'));
const Settings = lazyPage(() => import('./pages/Settings'));
const Letting = lazyPage(() => import('./pages/Letting'));
const PublicLettingPortal = lazyPage(() => import('./pages/tenant/PublicLettingPortal'));
const PublicViewingBooking = lazyPage(() => import('./pages/tenant/PublicViewingBooking'));
const CloudCallback = lazyPage(() => import('./pages/settings/CloudCallback').then((mod) => ({ default: mod.CloudCallback })));
const Import = lazyPage(() => import('./pages/Import'));
const Privacy = lazyPage(() => import('./pages/Privacy'));
const Terms = lazyPage(() => import('./pages/Terms'));
const BuyAndHold = lazyPage(() => import('./pages/investor/BuyAndHold'));
const FixAndFlip = lazyPage(() => import('./pages/investor/FixAndFlip'));
const TaxAndExit = lazyPage(() => import('./pages/investor/TaxAndExit'));
const AssetManagement = lazyPage(() => import('./pages/investor/AssetManagement'));
const InvestorPortal = lazyPage(() => import('./pages/InvestorPortal'));
const RenovationManager = lazyPage(() => import('./pages/renovation/RenovationManager'));
const RenovationWizard = lazyPage(() => import('./pages/renovation/RenovationWizard'));
const RenovationProjectDetail = lazyPage(() => import('./pages/renovation/RenovationProjectDetail'));
const RenovationCalculatorDetail = lazyPage(() => import('./pages/renovation/RenovationCalculatorDetail'));
const FloorPlanEditor = lazyPage(() => import('./pages/renovation/FloorPlanEditor'));
const PdfTemplateEditor = lazyPage(() => import('./pages/pdf-template/PdfTemplateEditor'));
const Login = lazyPage(() => import('./pages/auth/Login'));
const Register = lazyPage(() => import('./pages/auth/Register'));
const PasswordRecovery = lazyPage(() => import('./components/layout/PasswordRecovery'));
import { AuthProvider, useAuth } from './context/AuthContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { PermissionProvider } from './context/PermissionContext';
import { ProtectedRoute, InvestorRoute, TenantRoute } from './ProtectedRoute';
import { ViewModeProvider } from './context/ViewModeContext';
import { NotificationProvider } from './context/NotificationContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import PaywallModal from './components/subscription/PaywallModal';
const BillingSuccess = lazyPage(() => import('./pages/BillingSuccess'));
import ToastContainer from './components/ui/ToastContainer';

// ── Tenant Portal Pages ──
const TenantDashboard = lazyPage(() => import('./pages/tenant/TenantDashboard'));
const TenantTickets = lazyPage(() => import('./pages/tenant/TenantTickets'));
const TenantMessages = lazyPage(() => import('./pages/tenant/TenantMessages'));
const TenantAnnouncements = lazyPage(() => import('./pages/tenant/TenantAnnouncements'));
const TenantDocuments = lazyPage(() => import('./pages/tenant/TenantDocuments'));
const TenantStamdaten = lazyPage(() => import('./pages/tenant/TenantStamdaten'));

// ── Investor Portal Pages ──
const TenantManagement = lazyPage(() => import('./pages/TenantManagement'));
const TicketKanban = lazyPage(() => import('./pages/TicketKanban'));
const Announcements = lazyPage(() => import('./pages/Announcements'));
const InvestorMessages = lazyPage(() => import('./pages/InvestorMessages'));
const ObjectCalendar = lazyPage(() => import('./pages/ObjectCalendar'));

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
                  <Suspense fallback={<PageLoader />}>
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
                  </Suspense>
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
