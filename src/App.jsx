import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Pricing from './pages/Pricing';
import Landing from './pages/Landing';
import Legal from './pages/Legal';
import FAQPage from './pages/FAQPage';
import FeaturesPage from './pages/FeaturesPage';
import CheckoutPage from './pages/CheckoutPage';
import Paywall from './pages/Paywall';
import Success from './pages/billing/Success';
import Cancel from './pages/billing/Cancel';

// Helper for external redirects
const ExternalRedirect = ({ to }) => {
  useEffect(() => {
    window.location.href = to;
  }, [to]);
  return <div className="h-screen flex items-center justify-center text-slate-500">Redirecting...</div>;
};

function App() {
  return (
    <BrowserRouter>
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
        <Route path="/login" element={<ExternalRedirect to={import.meta.env.DEV ? 'http://localhost:5173/login' : 'https://app.immocontrol360.de/login'} />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
