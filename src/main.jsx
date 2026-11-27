import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Fängt Render-Fehler ab, damit statt einer weißen Seite ein Hinweis erscheint.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unerwarteter Fehler in der Oberfläche:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'inherit' }}>
          <div style={{ maxWidth: '460px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '12px' }}>Es ist ein Fehler aufgetreten</h1>
            <p style={{ color: '#6B7280', marginBottom: '20px' }}>
              Die Seite konnte nicht angezeigt werden. Bitte laden Sie die Seite neu. Nicht gespeicherte Eingaben gehen dabei verloren.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#0EA5E9', color: 'white', cursor: 'pointer', fontWeight: 600 }}
            >
              Seite neu laden
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
