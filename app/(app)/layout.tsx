import Nav from '@/components/Nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[oklch(0.13_0.012_265)]">
      {/* Subtle top-right ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-violet-900/20 blur-[140px]" />
        <div className="absolute top-1/2 -left-64 h-[400px] w-[400px] rounded-full bg-blue-900/10 blur-[140px]" />
      </div>
      <Nav />
      <main className="relative flex-1 container mx-auto px-4 py-6 max-w-7xl">
        {children}
      </main>
    </div>
  )
}
