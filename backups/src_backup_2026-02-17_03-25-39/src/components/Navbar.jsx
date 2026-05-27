import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const Navbar = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const location = useLocation();
    const isLanding = location.pathname === '/landing' || location.pathname === '/investor';

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Close mobile menu on route change
    useEffect(() => {
        setIsOpen(false);
    }, [location]);

    if (isLanding) {
        return (
            <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-3' : 'bg-transparent py-5'}`}>
                <div className="container flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2">
                        <img src="/logo.png" alt="ImmoControlPro360" className="h-10 w-auto" />
                    </Link>
                    <div className="hidden md:flex items-center gap-4">
                        <Link to="/login" className="text-slate-600 hover:text-blue-600 font-medium text-sm transition-colors">
                            Login
                        </Link>
                    </div>
                </div>
            </nav>
        );
    }

    return (
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-3' : 'bg-transparent py-5'}`}>
            <div className="container flex items-center justify-between">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-2">
                    <img src="/images/logo.png" alt="ImmoControlPro360" className="h-10 w-auto" />
                </Link>

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-8">
                    <Link to="/" className="text-slate-600 hover:text-blue-600 font-medium transition-colors">Startseite</Link>
                    <Link to="/funktionen" className="text-slate-600 hover:text-blue-600 font-medium transition-colors">Was du bekommst</Link>
                    <Link to="/preise" className="text-slate-600 hover:text-blue-600 font-medium transition-colors">Preise</Link>
                    <Link to="/faq" className="text-slate-600 hover:text-blue-600 font-medium transition-colors">FAQ</Link>
                </div>

                {/* Desktop Actions */}
                <div className="hidden md:flex items-center gap-6">
                    <a href="http://localhost:5173/login" className="text-slate-600 hover:text-blue-600 font-medium text-sm transition-colors">
                        Login
                    </a>
                    <Link to="/register-trial" className="btn-primary flex items-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30">
                        10 Tage kostenlos testen <ArrowRight size={16} />
                    </Link>
                </div>

                {/* Mobile Toggle */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="md:hidden z-50 relative p-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label="Menu"
                >
                    {isOpen ? <X size={24} /> : <Menu size={24} />}
                </button>

                {/* Mobile Menu Overlay */}
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="absolute top-0 left-0 right-0 bg-white shadow-xl border-b border-slate-100 p-5 pt-24 md:hidden flex flex-col gap-4"
                        >
                            <Link to="/" className="text-lg font-medium text-slate-800 py-2 border-b border-slate-50">Startseite</Link>
                            <Link to="/funktionen" className="text-lg font-medium text-slate-800 py-2 border-b border-slate-50">Was du bekommst</Link>
                            <Link to="/preise" className="text-lg font-medium text-slate-800 py-2 border-b border-slate-50">Preise</Link>
                            <Link to="/faq" className="text-lg font-medium text-slate-800 py-2 border-b border-slate-50">FAQ</Link>
                            <a href="http://localhost:5173/login" className="text-lg font-medium text-slate-800 py-2 border-b border-slate-50">Login</a>
                            <Link to="/register-trial" className="btn-primary w-full justify-center mt-2">
                                Jetzt kostenlos testen
                            </Link>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>


            {/* Page Load Progress Bar */}
            <motion.div
                key={location.pathname}
                initial={{ width: "0%", opacity: 1 }}
                animate={{ width: "100%", opacity: 0 }}
                transition={{ duration: 0.8, ease: "circOut", opacity: { delay: 0.5, duration: 0.3 } }}
                className="absolute bottom-0 left-0 h-[3px] bg-gradient-to-r from-blue-400 via-primary to-blue-600 z-50 shadow-[0_0_10px_rgba(14,165,233,0.5)]"
            />
        </nav >
    );
};

export default Navbar;
