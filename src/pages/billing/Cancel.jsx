import React from 'react';
import { Link } from 'react-router-dom';
import { XCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { motion } from 'framer-motion';

const Cancel = () => {
    return (
        <MainLayout>
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

                    <h1 className="text-3xl font-bold text-slate-900 mb-4">Checkout abgebrochen</h1>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                        Die Zahlung wurde nicht abgeschlossen. Es wurden keine Kosten verursacht.
                        Falls es Probleme gab, kannst du es erneut versuchen.
                    </p>

                    <div className="flex flex-col gap-3">
                        <Link
                            to="/abo-starten?plan=professional"
                            className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                        >
                            <RefreshCw size={18} /> Erneut versuchen
                        </Link>

                        <Link
                            to="/preise"
                            className="w-full py-3 flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <ArrowLeft size={18} /> Zurück zur Übersicht
                        </Link>
                    </div>

                    <p className="mt-8 text-xs text-slate-400">
                        Fragen? <a href="mailto:support@immocontrolpro360.de" className="underline hover:text-primary">Support kontaktieren</a>
                    </p>
                </motion.div>
            </div>
        </MainLayout>
    );
};

export default Cancel;
