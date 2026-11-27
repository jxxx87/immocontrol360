/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0ea5e9',
          hover: '#0284c7',
          active: '#0369a1',
        },
        neutral: {
          900: '#0f172a',
          700: '#334155',
          500: '#64748b',
          100: '#f1f5f9',
          50: '#f8fafc',
        },
        success: '#10b981',
        warning: '#f59e0b',
        accent: '#6366f1',
      },
      fontFamily: {
        // Inter, sonst die Systemschrift des Geräts – die Seite bleibt auch ohne nachgeladene Webfont
        // (z. B. nach Entfernen des Google-Fonts-Imports, W1b-03/W1c-01) ordentlich lesbar.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '4px',
      },
    },
  },
  plugins: [],
}
