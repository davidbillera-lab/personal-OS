import { login } from './actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[oklch(0.13_0.012_265)]">
      {/* Radial glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            <span className="text-violet-400">Mission</span> Control
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">Portfolio operating system</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 shadow-2xl backdrop-blur-sm">
          <form action={login} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="bg-white/[0.05] border-white/10 text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:ring-violet-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="bg-white/[0.05] border-white/10 text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:ring-violet-500/20"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-medium mt-2"
            >
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
