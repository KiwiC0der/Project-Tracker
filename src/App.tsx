import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react'
import { HamsterLoader } from '@/components/ui/hamster-loader'
import { getCurrentUser, type User } from '@/lib/store'

// Lazy so the three.js chunk isn't fetched until a shader scene actually mounts.
// The loader is a static import — it has to paint immediately.
const HeroScene = lazy(() => import('@/scenes/HeroScene').then((m) => ({ default: m.HeroScene })))
const AuthScene = lazy(() => import('@/scenes/AuthScene').then((m) => ({ default: m.AuthScene })))
const DashboardScene = lazy(() =>
  import('@/scenes/DashboardScene').then((m) => ({ default: m.DashboardScene })),
)

type Scene = 'loading' | 'hero' | 'auth' | 'dashboard'

export default function App() {
  const [scene, setScene] = useState<Scene>('loading')
  const [user, setUser] = useState<User | null>(null)

  // Scene 1 -> restore any existing session, then hand off to hero or dashboard.
  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()

    ;(async () => {
      let existing: User | null = null
      try {
        existing = await getCurrentUser()
      } catch {
        /* treat an unreachable backend as signed-out */
      }
      if (cancelled) return

      // Hold the loader long enough to actually read it.
      const elapsed = Date.now() - startedAt
      const wait = Math.max(0, 1400 - elapsed)
      setTimeout(() => {
        if (cancelled) return
        if (existing) {
          setUser(existing)
          setScene('dashboard')
        } else {
          setScene('hero')
        }
      }, wait)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (scene === 'loading') return <LoadingScreen />

  const authScene = (
    <AuthScene
      onAuthed={(u) => {
        setUser(u)
        setScene('dashboard')
      }}
    />
  )

  return (
    <Suspense fallback={<LoadingScreen />}>
      {scene === 'hero' && <HeroScene onEnter={() => setScene('auth')} />}
      {scene === 'auth' && authScene}
      {scene === 'dashboard' &&
        (user ? (
          <DashboardScene
            user={user}
            onSignOut={() => {
              setUser(null)
              setScene('hero')
            }}
          />
        ) : (
          // Defensive: the session vanished mid-flight.
          authScene
        ))}
    </Suspense>
  )
}

/** Scene 1 — also the Suspense fallback while a scene chunk downloads. */
function LoadingScreen(): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background">
      <HamsterLoader label="Loading Project Tracker" />
      <p className="text-xs uppercase tracking-[0.2em] text-muted">Loading</p>
    </div>
  )
}
