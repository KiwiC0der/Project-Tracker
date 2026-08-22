import { useState, type FormEvent } from 'react'
import { DotMatrixShader } from '@/components/ui/dot-matrix-shader'
import { signIn, signUp, usingRealBackend, validateUsername, type User } from '@/lib/store'
import { Loader2, AtSign, Lock, UserRound, AlertCircle, CheckCircle2 } from 'lucide-react'

/** Scene 3 — login / signup. Identity is a username; see store.ts AUTH_EMAIL_DOMAIN. */
export function AuthScene({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    const name = username.trim()
    // One rule, defined in store.ts, enforced identically on both forms.
    const badUsername = validateUsername(name)
    if (badUsername) {
      setError(badUsername)
      return
    }
    if (!password) {
      setError('Password is required.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setBusy(true)
    try {
      const result = isLogin
        ? await signIn(name, password)
        : await signUp(name, password, displayName.trim() || name)

      if (result.error) {
        setError(result.error)
      } else if (result.needsConfirmation) {
        setNotice('Your account was created. Sign in to continue.')
        setIsLogin(true)
      } else if (result.user) {
        onAuthed(result.user)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function switchMode(login: boolean) {
    setIsLogin(login)
    setError(null)
    setNotice(null)
  }

  return (
    <div className="scene-enter relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-5 py-10">
      <DotMatrixShader className="pointer-events-none fixed inset-0 block h-full w-full opacity-60" />

      <div className="relative w-full max-w-[26rem] rounded-2xl border border-border bg-surface/85 p-7 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-brand-soft">
            <CheckCircle2 size={20} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isLogin ? 'Sign in to reach your board.' : 'Start tracking in under a minute.'}
          </p>
        </div>

        {/* mode toggle */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-background p-1"
        >
          {([true, false] as const).map((login) => (
            <button
              key={String(login)}
              role="tab"
              type="button"
              aria-selected={isLogin === login}
              onClick={() => switchMode(login)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isLogin === login
                  ? 'bg-surface-2 text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {login ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
          {!isLogin && (
            <Field
              icon={<UserRound size={15} />}
              label="Display name"
              id="displayName"
              type="text"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          )}

          <Field
            icon={<AtSign size={15} />}
            label="Username"
            id="username"
            type="text"
            value={username}
            onChange={setUsername}
            placeholder="yourname"
            autoComplete="username"
            required
            // Sign-up only. There is no address on file, so a forgotten password
            // cannot be reset today — say so rather than implying recovery exists.
            hint={
              isLogin
                ? undefined
                : '3–30 characters: letters, digits, underscores or hyphens. No email needed — you can add a recovery email later, and until you do, a forgotten password cannot be reset.'
            }
          />

          <Field
            icon={<Lock size={15} />}
            label="Password"
            id="password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              <AlertCircle size={14} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
            >
              <CheckCircle2 size={14} className="mt-px shrink-0" />
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {!usingRealBackend && (
          <p className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200/90">
            <strong className="font-semibold">Demo mode.</strong> No Supabase credentials are
            configured, so accounts and tasks are stored in this browser only. Add your keys to
            enable real accounts — see the README.
          </p>
        )}
      </div>
    </div>
  )
}

function Field({
  icon,
  label,
  id,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  hint,
}: {
  icon: React.ReactNode
  label: string
  id: string
  type: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  required?: boolean
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-brand"
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-[0.7rem] leading-relaxed text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
