# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Development (Local)

1.  **Start the development server:**
    ```bash
    npm run dev
    ```
2.  **Open in Browser:**
    The terminal will show a local URL (usually `http://localhost:5173`). Open this to see your changes instantly.
3.  **Work on the App:**
    Edit files in `src/`. The browser will automatically reload when you save changes.

4.  **PDF Server (Required for Invoices):**
    To generate perfect PDFs for invoices, you must run the local PDF server:
    ```bash
    cd server
    node server.js
    ```
    Keep this terminal window open while using the app.

## Database Updates
This project uses Supabase for the database. When pulling code updates that involve database schema changes, you must apply the migrations:

```bash
npx supabase login
npx supabase link --project-ref agsmqvvwfufenaiekuox
npx supabase db push
```

## Deployment to Hostinger (Live)

Since you have connected your GitHub repository to Hostinger:

1.  **Commit & Push your changes:**
    When you are happy with your local changes, run these commands in the terminal:
    ```bash
    git add .
    git commit -m "Describe your changes here"
    git push origin master
    ```
2.  **Hostinger Updates Automatically:**
    Hostinger will detect the new code on GitHub, build it, and update your website automatically (usually within a few minutes).

---

### Alternative: Manual Deployment (Fallback)

If the automatic deployment fails, you can upload manually:

1.  **Build the project:**
    ```bash
    npm run build
    ```
    This creates a `dist` folder.
2.  **Upload to Hostinger:**
    - Go to Hostinger File Manager (`public_html`).
    - Upload the **contents** of the `dist` folder.
3.  **Routing:**
    - Ensure the `.htaccess` file is present (it is automatically copied to `dist/` during build).
