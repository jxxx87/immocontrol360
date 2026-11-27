import React from 'react';
import { Link } from 'react-router-dom';
import { LogIn, ArrowRight } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { motion } from 'framer-motion';
import { APP_URL } from '../../components/siteConfig';

// Die Website kann den Zahlungs-/Abo-Status nicht prüfen (kein Backend-Abgleich der session_id).
// Die App nutzt für Stripe eigene Rückkehr-Seiten; diese Seite meldet daher keinen Erfolg,
// sondern verweist neutral auf die App, in der der tatsächliche Abo-Status angezeigt wird.
const Success = () => {
    return (
        <MainLayout>
            <title>Weiter zur App | ImmoControlPro360</title>
            <meta name="robots" content="noindex" />

            <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-green-400/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative z-10 bg-white p-12 rounded-2xl shadow-xl max-w-lg w-full text-center border border-slate-100"
                >
                    <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <LogIn size={40} className="text-primary" />
                    </div>

                    <h1 className="text-3xl font-bold text-slate-900 mb-4">
                        Weiter zur App
                    </h1>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                        Den aktuellen Stand deiner Testphase bzw. deines Abos siehst du nach der Anmeldung in der App
                        unter „Einstellungen → Abrechnung & Abo“.
                    </p>

                    <a
                        href={`${APP_URL}/login`}
                        className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-lg shadow-lg shadow-green-500/20 hover:shadow-green-500/30 bg-green-600 hover:bg-green-700 border-none"
                    >
                        Zur App wechseln <ArrowRight size={18} />
                    </a>

                    <Link
                        to="/preise"
                        className="mt-4 w-full py-3 flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        Zu den Preisen
                    </Link>
                </motion.div>
            </div>
        </MainLayout>
    );
};

export default Success;
