// Open Sans wird lokal ausgeliefert (@fontsource/open-sans) – keine Verbindung zu Google Fonts.
// Die App lädt die Schrift über main.jsx; Druck- und Vorschaufenster bekommen dieselben
// Schriftdateien per @font-face mit absoluten URLs (gleiche Dateien = gleiche Zeilen- und
// Seitenumbrüche wie im Vorlagen-Editor).
import latin400 from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff2?url';
import latin500 from '@fontsource/open-sans/files/open-sans-latin-500-normal.woff2?url';
import latin600 from '@fontsource/open-sans/files/open-sans-latin-600-normal.woff2?url';
import latin700 from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff2?url';
import latinExt400 from '@fontsource/open-sans/files/open-sans-latin-ext-400-normal.woff2?url';
import latinExt500 from '@fontsource/open-sans/files/open-sans-latin-ext-500-normal.woff2?url';
import latinExt600 from '@fontsource/open-sans/files/open-sans-latin-ext-600-normal.woff2?url';
import latinExt700 from '@fontsource/open-sans/files/open-sans-latin-ext-700-normal.woff2?url';

// Unicode-Bereiche wie in @fontsource/open-sans
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FACES = [
    [400, latin400, latinExt400],
    [500, latin500, latinExt500],
    [600, latin600, latinExt600],
    [700, latin700, latinExt700],
];

const absoluteUrl = (url) => new URL(url, window.location.href).href;

// Herkunft der Schriftdateien (für font-src in der CSP der Druckfenster)
export const fontOrigin = () => window.location.origin;

// @font-face-Regeln für Druck-/Vorschaufenster (about:blank bzw. blob:)
export const openSansFontFaceCss = () => FACES.map(([weight, latin, latinExt]) => [
    `@font-face{font-family:'Open Sans';font-style:normal;font-display:swap;font-weight:${weight};src:url('${absoluteUrl(latinExt)}') format('woff2');unicode-range:${LATIN_EXT_RANGE};}`,
    `@font-face{font-family:'Open Sans';font-style:normal;font-display:swap;font-weight:${weight};src:url('${absoluteUrl(latin)}') format('woff2');unicode-range:${LATIN_RANGE};}`,
].join('\n')).join('\n');
