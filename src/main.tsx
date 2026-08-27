import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastPortal } from '@/components/ui/toast'
import { installGlobalErrorHandlers } from '@/lib/report'
import './index.css'

/* Before the first render, so a throw inside module init of a lazily imported
   scene chunk is still caught by something. Idempotent — see report.ts. */
installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The last line of defence. Nothing above this catches, so anything that
        escapes here is the blank page this boundary exists to prevent — which
        is why it wraps the toast portal too: a crash in the portal would take
        the app down with it, and the portal is not more important than the app. */}
    <ErrorBoundary full>
      <App />
      {/* Mounted above every scene so a toast survives a scene swap. Renders
          nothing when ENHANCEMENTS.toasts is off — see src/lib/enhancements.ts. */}
      <ToastPortal />
    </ErrorBoundary>
  </StrictMode>,
)
