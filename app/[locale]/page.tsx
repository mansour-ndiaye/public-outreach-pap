import { LoginForm } from '@/components/auth/LoginForm'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import Image from 'next/image'

export default function LoginPage() {
  return (
    <main className="relative min-h-screen w-full flex flex-col overflow-hidden bg-white dark:bg-[#0f1035]">

      {/* ── Background layers ── */}
      {/* Radial gradient blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-brand-navy/5 dark:bg-brand-navy/30 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-brand-teal/5 dark:bg-brand-teal/20 blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-brand-red/3 dark:bg-brand-navy/20 blur-[100px]" />
      </div>

      {/* Noise texture overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-noise opacity-[0.4] dark:opacity-[0.15]"
      />

      {/* ── Top bar ── */}
      <div className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        {/* Logo mark */}
        <div className="flex items-center gap-3">
          <Image
            src="/assets/logo.jpeg"
            alt="Public Outreach"
            width={36}
            height={36}
            className="rounded-full"
            priority
          />
          <span className="hidden sm:block font-display text-sm font-semibold tracking-wide text-brand-navy dark:text-white/90">
            Public Outreach
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* ── Center content ── */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px] animate-slide-up">

          {/* Brand banner (desktop) */}
          <div className="hidden sm:block mb-8 overflow-hidden rounded-2xl shadow-navy-md">
            <Image
              src="/assets/banner.jpeg"
              alt="Public Outreach"
              width={840}
              height={200}
              className="w-full object-cover"
              priority
            />
          </div>

          {/* Login card */}
          <LoginForm />

        </div>
      </div>

      {/* ── Footer ── */}
      <div className="relative z-10 py-6 text-center">
        <p className="text-xs text-slate-400 dark:text-white/30 font-body">
          © {new Date().getFullYear()} Public Outreach™. All rights reserved.
        </p>
      </div>

    </main>
  )
}
