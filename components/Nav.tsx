'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { logout } from '@/app/login/actions'

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/ship', label: 'Ship' },
  { href: '/vault', label: 'Vault' },
  { href: '/guide', label: 'Guide' },
  { href: '/runbook', label: 'Runbook' },
  { href: '/finance', label: 'Finance' },
  { href: '/creative', label: 'Creative' },
  { href: '/crm', label: 'CRM' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <header className="border-b border-white/[0.06] bg-black/40 backdrop-blur-xl sticky top-0 z-10">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex h-14 items-center gap-6">
          <span className="font-semibold text-sm tracking-tight text-white">
            <span className="text-violet-400">M</span>ission{' '}
            <span className="text-violet-400">C</span>ontrol
          </span>
          <nav className="flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150',
                  pathname === href
                    ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.06]'
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form action={logout} className="ml-auto">
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-400 transition-all duration-150 hover:text-gray-100 hover:bg-white/[0.06]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
