import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // backups/ enthält nur alte Quellstände (nicht im Build) und wird nicht mitgeprüft
  globalIgnores(['dist', 'backups']),
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
      // ESLint 9 erkennt Verwendungen in JSX nicht (<motion.div>, <Icon /> aus Destrukturierung):
      // Großgeschriebene Namen und das framer-motion-Objekt "motion" gelten daher als verwendet.
      'no-unused-vars': ['error', { varsIgnorePattern: '^(?:[A-Z_]|motion$)', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
