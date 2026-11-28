import React from 'react';
import { getImageVariants } from '../lib/images';

// Bild mit WebP-Varianten aus public/images (W1b-10). Moderne Browser laden die passende WebP-Datei,
// alle anderen das PNG. width/height (aus den Bilddaten) reservieren den Platz vorab, damit nichts springt.
// sizes: angezeigte Breite für die Auswahl aus mehreren Breiten (Standard: volle Fensterbreite).
// <picture> nimmt per "display: contents" nicht am Layout teil – das <img> verhält sich wie bisher.
const OptimizedImage = ({ src, alt, sizes = '100vw', width, height, ...imgProps }) => {
    const variants = getImageVariants(src);

    if (!variants) {
        return <img src={src} alt={alt} width={width} height={height} {...imgProps} />;
    }

    return (
        <picture className="contents">
            <source type="image/webp" srcSet={variants.srcSet} sizes={variants.usesSizes ? sizes : undefined} />
            <img
                src={variants.fallback}
                alt={alt}
                width={width ?? variants.width}
                height={height ?? variants.height}
                {...imgProps}
            />
        </picture>
    );
};

export default OptimizedImage;
