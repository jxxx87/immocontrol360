import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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

// Weiterleitung in die App; mit keepQuery bleiben Query-String und Anker erhalten (z. B. session_id von Stripe)
const AppRedirect = ({ path, keepQuery = false }) => {
  const { search, hash } = useLocation();
  return <ExternalRedirect to={`${APP_URL}${path}${keepQuery ? `${search}${hash}` : ''}`} />;
};

// Interne Weiterleitung, die Query-String und Anker übernimmt (z. B. ?plan=business&cycle=yearly, W7 D-3)
const RedirectKeepQuery = ({ to }) => {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
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

            {/* Alte Adressen ohne eigene Seite (W7 D-10/D-11/D-12): Stripe kehrt in die App zurück
                (success_url <App>/billing/success, cancel_url <App>/settings?tab=billing), das Abo wird in der
                App abgeschlossen. Nur noch Weiterleitungen, damit alte Links/Lesezeichen nicht auf der 404 landen. */}
            <Route path="/billing/success" element={<AppRedirect path="/billing/success" keepQuery />} />
            <Route path="/billing/cancel" element={<AppRedirect path="/settings?tab=billing" />} />
            <Route path="/paywall" element={<AppRedirect path="/login" />} />

            {/* Legal Pages */}
            <Route path="/impressum" element={<Legal type="impressum" />} />
            <Route path="/datenschutz" element={<Legal type="datenschutz" />} />
            <Route path="/agb" element={<Legal type="agb" />} />

            {/* Checkout Flow */}
            <Route path="/abo-starten" element={<CheckoutPage />} />
            <Route path="/checkout" element={<RedirectKeepQuery to="/abo-starten" />} />
            <Route path="/register-trial" element={<RedirectKeepQuery to="/abo-starten" />} />

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
