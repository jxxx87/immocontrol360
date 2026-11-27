import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Home from './pages/Home';
import Pricing from './pages/Pricing';
import Landing from './pages/Landing';
import NotFound from './components/NotFound';
import RouteMeta from './components/RouteMeta';
import { APP_URL } from './components/siteConfig';

// Seltener besuchte Seiten erst bei Bedarf laden, damit die Startseite schneller ist (W1b-14).
// Schlägt das Nachladen nach einem neuen Deploy fehl, lädt der ErrorBoundary (main.jsx) die Seite neu.
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'));
const FAQPage = lazy(() => import('./pages/FAQPage'));
const Legal = lazy(() => import('./pages/Legal'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const Paywall = lazy(() => import('./pages/Paywall'));
const Success = lazy(() => import('./pages/billing/Success'));
const Cancel = lazy(() => import('./pages/billing/Cancel'));

// Helper for external redirects
const ExternalRedirect = ({ to }) => {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 text-slate-500">
      <meta name="robots" content="noindex" />
      <p>Weiterleitung …</p>
      <a href={to} className="text-primary underline underline-offset-4">Weiter</a>
    </div>
  );
};

const PageFallback = () => <div className="min-h-screen" aria-busy="true" />;

function App() {
  return (
    // Animationen von framer-motion folgen der Systemeinstellung "Bewegung reduzieren" (W1b-17)
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <RouteMeta />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/preise" element={<Pricing />} />
            <Route path="/funktionen" element={<FeaturesPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/landing" element={<Landing />} />

            <Route path="/investor" element={<Landing />} />

            {/* Billing Flow */}
            <Route path="/billing/success" element={<Success />} />
            <Route path="/billing/cancel" element={<Cancel />} />

            {/* Paywall (after trial expires) */}
            <Route path="/paywall" element={<Paywall />} />

            {/* Legal Pages */}
            <Route path="/impressum" element={<Legal type="impressum" />} />
            <Route path="/datenschutz" element={<Legal type="datenschutz" />} />
            <Route path="/agb" element={<Legal type="agb" />} />

            {/* Checkout Flow */}
            <Route path="/abo-starten" element={<CheckoutPage />} />
            <Route path="/checkout" element={<Navigate to="/abo-starten" replace />} />
            <Route path="/register-trial" element={<Navigate to="/abo-starten" replace />} />

            {/* Login Redirect */}
            <Route path="/login" element={<ExternalRedirect to={`${APP_URL}/login`} />} />

            {/* Unbekannte Adressen: eigene 404-Seite (noindex) statt stiller Weiterleitung (W1b-12) */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </MotionConfig>
  );
}

export default App;
