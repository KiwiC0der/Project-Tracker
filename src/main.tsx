import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastPortal } from '@/components/ui/toast'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Mounted above every scene so a toast survives a scene swap. Renders
        nothing when ENHANCEMENTS.toasts is off — see src/lib/enhancements.ts. */}
    <ToastPortal />
  </StrictMode>,
)
