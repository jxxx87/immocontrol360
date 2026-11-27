import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Check, X, Star } from 'lucide-react';
import MainLayout from '../layouts/MainLayout';
import { APP_URL, SITE_URL } from '../components/siteConfig';
import { getPlan, normalizePlanId, normalizeCycle, getPriceInfo, VAT_NOTE, TRIAL_DAYS, TRIAL_MAX_UNITS } from '../lib/plans';

const CheckoutPage = () => {
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    // Nur bekannte Werte übernehmen: unbekannter Tarif → Professional, unbekannte Zahlweise → keine Angabe
    const planId = normalizePlanId(queryParams.get('plan'));
    const cycle = normalizeCycle(queryParams.get('cycle'));
    const plan = getPlan(planId);
    const monthly = getPriceInfo(plan, false);
    const yearly = getPriceInfo(plan, true);

    const handleRedirect = () => {
        const params = new URLSearchParams({ plan: planId });
        // Gewählte Zahlweise mitgeben; verbindlich gewählt wird sie beim Abo-Abschluss in der App
        if (cycle) params.set('cycle', cycle);
        window.location.assign(`${APP_URL}/register?${params.toString()}`);
    };

    let priceText;
    if (cycle === 'yearly') {
        priceText = `${yearly.perMonth} € / Monat bei jährlicher Zahlung (${yearly.yearlyTotal} € pro Jahr im Voraus), ${VAT_NOTE}`;
    } else if (cycle === 'monthly') {
        priceText = `${monthly.perMonth} € / Monat bei monatlicher Zahlung, ${VAT_NOTE}`;
    } else {
        priceText = `${monthly.perMonth} € / Monat bei monatlicher Zahlung oder ${yearly.perMonth} € / Monat bei jährlicher Zahlung (${yearly.yearlyTotal} € pro Jahr), ${VAT_NOTE}`;
    }

    return (
        <MainLayout>
            <title>Kostenlos testen | ImmoControlPro360</title>
            <meta name="description" content={`Erstelle deinen ImmoControlPro360-Account und teste ${TRIAL_DAYS} Tage kostenlos – ohne Kreditkarte, die Testphase endet automatisch.`} />
            <link rel="canonical" href={`${SITE_URL}/abo-starten`} />

            <div className="bg-slate-50 min-h-screen py-20 px-4 flex items-center justify-center font-sans text-slate-900">
                <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-0 bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">

                    {/* LEFT: Benefits / Visual */}
                    <div className="text-white p-12 flex flex-col justify-between relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #0ea5e9 35%, #0284c7 70%, #0c4a6e 100%)' }}>
                        {/* Background Decoration */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                        <div className="relative">
                            <div className="flex items-center gap-2 text-white font-bold mb-6 tracking-wide uppercase text-xs">
                                <Star size={14} fill="currentColor" /> {TRIAL_DAYS} Tage kostenlos testen
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
                                Starte jetzt dein Immobilien-Business.
                            </h1>
                            <p className="text-blue-50 text-lg mb-6 leading-relaxed">
                                Erstelle deinen Account in unter 1 Minute. Keine Kreditkarte erforderlich. Die Testphase endet automatisch – du musst nichts kündigen.
                            </p>

                            <p className="text-sm text-white bg-white/10 border border-white/20 rounded-lg p-3 mb-8 leading-relaxed">
                                In der Testphase sind alle Funktionen freigeschaltet – inklusive Mieter- und Investorportal, bis zu {TRIAL_MAX_UNITS} Einheiten.
                            </p>

                            {/* Leistungen des gewählten Tarifs (gelten nach Abschluss des Abos) */}
                            <p className="text-white font-semibold mb-4">Im Tarif {plan.title} enthalten:</p>
                            <ul className="space-y-4">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className={`flex items-center gap-3 ${feature.included ? 'text-white' : 'text-blue-100'}`}>
                                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                            {feature.included ? (
                                                <Check size={14} className="text-white" />
                                            ) : (
                                                <X size={14} className="text-blue-100" />
                                            )}
                                        </div>
                                        {feature.text}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="relative mt-12 text-xs text-blue-50 flex items-center gap-2">
                            <ShieldCheck size={14} /> Deine Daten werden verschlüsselt übertragen.
                        </div>
                    </div>

                    {/* RIGHT: Redirect Action */}
                    <div className="p-12 flex flex-col justify-center bg-white relative">
                        <div className="mb-8 text-center">
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">Account erstellen</h2>
                            <p className="text-slate-500 text-sm">Starte jetzt deine {TRIAL_DAYS}-tägige Testphase.</p>
                        </div>

                        {/* Plan Info */}
                        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 text-center mb-8">
                            <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">Gewählter Tarif</p>
                            <h3 className="text-2xl font-bold text-blue-600 mb-2">{plan.title}</h3>
                            <p className="text-sm text-slate-600 leading-relaxed">{priceText}</p>
                            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                                Kosten entstehen erst, wenn du in der App ein Abo abschließt – Tarif und Zahlweise kannst du dabei noch ändern.{' '}
                                <Link to="/preise" className="underline hover:text-blue-600">Anderen Tarif ansehen</Link>
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={handleRedirect}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all flex items-center justify-center gap-2"
                        >
                            Jetzt kostenlos registrieren <ArrowRight size={20} />
                        </button>

                        <p className="mt-6 text-center text-xs text-slate-500">
                            Du wirst zu unserer sicheren Registrierungsseite in der App weitergeleitet.<br />
                            Es gelten unsere <Link to="/agb" className="underline hover:text-blue-600">AGB</Link>. Informationen zur Verarbeitung deiner Daten findest du in unserer <Link to="/datenschutz" className="underline hover:text-blue-600">Datenschutzerklärung</Link>.
                        </p>
                    </div>
                </div>
            </div>
        </MainLayout>
    );
};

export default CheckoutPage;
