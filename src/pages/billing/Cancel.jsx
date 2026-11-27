import React from 'react';
import { Link } from 'react-router-dom';
import { XCircle, ArrowLeft, LogIn } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { motion } from 'framer-motion';
import { APP_URL, SUPPORT_EMAIL } from '../../components/siteConfig';

// Abos werden in der App abgeschlossen (Einstellungen → Abrechnung & Abo). Ein erneuter Versuch
// führt deshalb zur Anmeldung in der App – nicht in eine Neuregistrierung mit festem Tarif.
const Cancel = () => {
    return (
        <MainLayout>
            <title>Bezahlvorgang abgebrochen | ImmoControlPro360</title>
            <meta name="robots" content="noindex" />

            <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-red-400/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative z-10 bg-white p-12 rounded-2xl shadow-xl max-w-lg w-full text-center border border-slate-100"
                >
                    <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle size={40} className="text-red-500" />
                    </div>

                    <h1 className="text-3xl font-bold text-slate-900 mb-4">Bezahlvorgang abgebrochen</h1>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                        Der Bezahlvorgang wurde nicht abgeschlossen. Du kannst dein Abo jederzeit in der App
                        unter „Einstellungen → Abrechnung & Abo“ abschließen.
                    </p>

                    <div className="flex flex-col gap-3">
                        <a
                            href={`${APP_URL}/login`}
                            className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                        >
                            <LogIn size={18} /> Zur App
                        </a>

                        <Link
                            to="/preise"
                            className="w-full py-3 flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <ArrowLeft size={18} /> Zurück zur Übersicht
                        </Link>
                    </div>

                    <p className="mt-8 text-xs text-slate-500">
                        Fragen? <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-primary">Support kontaktieren</a>
                    </p>
                </motion.div>
            </div>
        </MainLayout>
    );
};

export default Cancel;
