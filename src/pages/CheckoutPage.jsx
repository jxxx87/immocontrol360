import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Check, Star } from 'lucide-react';
import MainLayout from '../layouts/MainLayout';

const CheckoutPage = () => {
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const planId = queryParams.get('plan') || 'professional';

    const handleRedirect = () => {
        const appUrl = import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.immocontrol360.de';
        window.location.href = `${appUrl}/register?plan=${planId}`;
    };

    return (
        <MainLayout>
            <div className="bg-slate-50 min-h-screen py-20 px-4 flex items-center justify-center font-sans text-slate-900">
                <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-0 bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">

                    {/* LEFT: Benefits / Visual */}
                    <div className="text-white p-12 flex flex-col justify-between relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #0ea5e9 35%, #0284c7 70%, #0c4a6e 100%)' }}>
                        {/* Background Decoration */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                        <div>
                            <div className="flex items-center gap-2 text-blue-400 font-bold mb-6 tracking-wide uppercase text-xs">
                                <Star size={14} fill="currentColor" /> 10 Tage Premium Testphase
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
                                Starte jetzt dein Immobilien-Business.
                            </h1>
                            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
                                Erstelle deinen Account in unter 1 Minute. Keine Kreditkarte erforderlich. Automatische Kündigung.
                            </p>

                            <ul className="space-y-4">
                                {[
                                    'Vollzugriff auf alle Pro-Features',
                                    'Mieter- & Investorportal inklusive',
                                    'Bis zu 50 Einheiten verwalten',
                                    'DSGVO-konforme Datenspeicherung'
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                                            <Check size={14} className="text-blue-400" />
                                        </div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="mt-12 text-xs text-slate-500 flex items-center gap-2">
                            <ShieldCheck size={14} /> Deine Daten sind sicher und verschlüsselt.
                        </div>
                    </div>

                    {/* RIGHT: Redirect Action */}
                    <div className="p-12 flex flex-col justify-center bg-white relative">
                        <div className="mb-8 text-center">
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">Account erstellen</h2>
                            <p className="text-slate-500 text-sm">Starte jetzt deine 10-tägige Testphase.</p>
                        </div>

                        {/* Plan Info */}
                        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 text-center mb-8">
                            <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">Gewählter Plan</p>
                            <h3 className="text-2xl font-bold text-blue-600 capitalize">{planId}</h3>
                        </div>

                        <button
                            onClick={handleRedirect}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all flex items-center justify-center gap-2"
                        >
                            Jetzt kostenlos registrieren <ArrowRight size={20} />
                        </button>

                        <p className="mt-6 text-center text-xs text-slate-400">
                            Du wirst zu unserer sicheren Anmeldeseite weitergeleitet.<br />
                            Mit der Registrierung stimmst du unseren <Link to="/datenschutz" className="underline hover:text-blue-600">Datenschutzbestimmungen</Link> zu.
                        </p>
                    </div>
                </div>
            </div>
        </MainLayout>
    );
};

export default CheckoutPage;
