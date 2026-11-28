import React from 'react';
import OptimizedImage from './OptimizedImage';

// loading/fetchPriority steuerbar: Bilder im sichtbaren Startbereich (Hero) mit
// loading="eager" und fetchPriority="high" übergeben, alles darunter bleibt lazy (W1b-10).
// Bilder aus public/images werden als WebP in passender Breite geladen (OptimizedImage);
// sizes = angezeigte Breite, wenn das Gerät schmaler als die volle Seitenbreite dargestellt wird.
const LAPTOP_SIZES = '(min-width: 1024px) 1024px, 100vw';
const PHONE_SIZES = '300px';

export const LaptopMockup = ({ src, alt, className = '', children, loading = 'lazy', fetchPriority, sizes = LAPTOP_SIZES }) => {
    return (
        <div className={`relative mx-auto ${className}`}>
            {/* Laptop Screen */}
            <div className="relative bg-white rounded-t-xl border-[8px] border-neutral-900 border-b-0 shadow-2xl overflow-hidden aspect-[16/10]">
                {/* Camera */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-4 bg-neutral-900 rounded-b-lg flex items-center justify-center z-20 pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-700 ml-1"></div>
                </div>

                {/* Content: Either Image or Children (Custom UI) */}
                <div className="w-full h-full overflow-hidden bg-white relative z-0">
                    {children ? (
                        children
                    ) : (
                        <OptimizedImage
                            src={src}
                            alt={alt}
                            sizes={sizes}
                            className="w-full h-full object-cover object-top"
                            loading={loading}
                            decoding="async"
                            fetchPriority={fetchPriority}
                        />
                    )}
                </div>

                {/* Reflection overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none z-10 mix-blend-overlay" />
            </div>
            {/* Laptop Base */}
            <div className="relative bg-neutral-800 h-4 rounded-b-lg shadow-lg mx-auto w-full z-20">
                <div className="absolute left-1/2 -translate-x-1/2 top-0 w-16 h-1 bg-neutral-700 rounded-b-md"></div>
            </div>
        </div>
    );
};

export const PhoneMockup = ({ src, alt, className = '', children, loading = 'lazy', fetchPriority, sizes = PHONE_SIZES }) => {
    return (
        <div className={`relative mx-auto ${className}`} style={{ maxWidth: '300px' }}>
            <div className="relative bg-white rounded-[2.5rem] border-[8px] border-neutral-900 shadow-2xl overflow-hidden aspect-[9/19]">
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-neutral-900 rounded-b-2xl z-20 pointer-events-none"></div>

                {/* Content: Either Image or Children (Custom UI) */}
                <div className="w-full h-full overflow-hidden bg-white relative z-0">
                    {children ? (
                        children
                    ) : (
                        <OptimizedImage
                            src={src}
                            alt={alt}
                            sizes={sizes}
                            className="w-full h-full object-cover"
                            loading={loading}
                            decoding="async"
                            fetchPriority={fetchPriority}
                        />
                    )}
                </div>

                {/* Reflection overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none z-10 mix-blend-overlay" />
            </div>
        </div>
    );
};
