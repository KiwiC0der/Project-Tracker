import { WebGLShader } from '@/components/ui/web-gl-shader'
import { ArrowRight } from 'lucide-react'

/** Scene 2 — prism hero. */
export function HeroScene({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="scene-enter relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden px-5">
      <WebGLShader className="pointer-events-none fixed inset-0 block h-full w-full" />

      <div className="relative mx-auto w-full max-w-3xl border border-[#27272a] p-2">
        {/* The shader runs bright directly behind this panel — a scrim keeps the
            copy readable without hiding the effect. */}
        <main className="relative overflow-hidden border border-[#27272a] bg-black/45 px-6 py-12 text-center backdrop-blur-[2px]">
          <h1 className="mb-3 text-5xl font-extrabold tracking-tighter text-white sm:text-6xl md:text-[clamp(2.5rem,8vw,5.5rem)]">
            Project Tracker
          </h1>

          <p className="mx-auto max-w-xl text-xs text-white/60 md:text-sm lg:text-base">
            Plan projects, break them into tasks, and drag them to done. Your board,
            your account, synced and saved.
          </p>

          <div className="my-8 flex items-center justify-center gap-1.5">
            <span className="relative flex h-3 w-3 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            <p className="text-xs text-green-500">System operational</p>
          </div>

          <button
            type="button"
            onClick={onEnter}
            className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.03] active:scale-95"
          >
            Get started
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </button>

          <p className="mt-5 text-[0.7rem] text-white/40">
            Sign in or create an account on the next screen.
          </p>
        </main>
      </div>
    </div>
  )
}
