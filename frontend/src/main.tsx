import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The theme is applied by an inline script in index.html, before this bundle
// is even fetched. Doing it here as well only reapplied it a second too late.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
