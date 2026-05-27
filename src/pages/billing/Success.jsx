import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { motion } from 'framer-motion';

const Success = () => {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get('session_id');
    const isTrial = searchParams.get('trial') === 'true';

    React.useEffect(() => {
        if (!isTrial) {
            const timer = setTimeout(() => {
                window.location.href = import.meta.env.DEV ? 'http://localhost:5173/' : 'https://app.immocontrol360.de/';
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [isTrial]);

    return (
        <MainLayout>
            <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-green-400/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative z-10 bg-white p-12 rounded-2xl shadow-xl max-w-lg w-full text-center border border-slate-100"
                >
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle size={40} className="text-green-600" />
                    </div>

                    {isTrial ? (
                        <>
                            <h1 className="text-3xl font-bold text-slate-900 mb-4">
                                Trial erfolgreich gestartet! 🎉
                            </h1>
                            <p className="text-slate-500 mb-8 leading-relaxed">
                                Dein 10-Tage-Testzeitraum hat begonnen. Du hast jetzt vollen Zugriff auf alle Features deines gewählten Plans.
                            </p>

                            <div className="bg-indigo-50 rounded-lg p-4 mb-8 text-sm text-indigo-700 border border-indigo-100 flex items-center gap-3">
                                <Sparkles size={20} className="shrink-0" />
                                <span>Nach Ablauf der 10 Tage kannst du nahtlos ein Abo abschließen.</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <h1 className="text-3xl font-bold text-slate-900 mb-4">
                                Abo erfolgreich aktiviert!
                            </h1>
                            <p className="text-slate-500 mb-8 leading-relaxed">
                                Vielen Dank für dein Vertrauen. Dein Account wurde erfolgreich aufgewertet. Du hast jetzt Zugriff auf alle Premium-Features.
                            </p>

                            <div className="bg-slate-50 rounded-lg p-4 mb-8 text-sm text-slate-600 border border-slate-100">
                                Eine Bestätigung wurde an deine E-Mail gesendet.
                                {sessionId && (
                                    <span className="block mt-2 text-xs text-slate-400 font-mono">
                                        Ref: {sessionId.slice(0, 8)}...
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {isTrial ? (
                        <Link
                            to="/"
                            className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-lg shadow-lg shadow-green-500/20 hover:shadow-green-500/30 bg-green-600 hover:bg-green-700 border-none"
                        >
                            Zur Startseite <ArrowRight size={18} />
                        </Link>
                    ) : (
                        <a
                            href={import.meta.env.DEV ? 'http://localhost:5173/' : 'https://app.immocontrol360.de/'}
                            className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-lg shadow-lg shadow-green-500/20 hover:shadow-green-500/30 bg-green-600 hover:bg-green-700 border-none"
                        >
                            Zur App wechseln <ArrowRight size={18} />
                        </a>
                    )}

                    {!isTrial && (
                        <p className="mt-4 text-xs text-slate-400">
                            Du wirst automatisch zur App weitergeleitet.
                        </p>
                    )}
                </motion.div>
            </div>
        </MainLayout>
    );
};

export default Success;
