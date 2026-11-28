import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build-Ausgaben, natives Android-Projekt (enthält kopierte Build-Dateien), Backups, Archiv,
  // Deno-Functions und lokale (gitignorierte) Wegwerf-Skripte nicht prüfen
  globalIgnores(['dist', 'android', 'backups', '.agent', 'archive', 'supabase/functions', 'scratch', 'scratch_*', 'temp_deploy']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // React-Contexts exportieren bewusst Provider UND zugehörigen Hook/Context aus einer Datei.
  // Fast Refresh lädt solche Dateien dann komplett neu – für Contexts gewollt, daher hier keine Meldung.
  {
    files: ['src/context/**/*.{js,jsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Node-Dateien (Build-/Tool-Konfiguration, Hilfsskripte): Node-Globals statt Browser-Globals
  {
    files: ['*.config.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
])
