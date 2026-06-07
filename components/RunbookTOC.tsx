'use client'

import { useEffect, useState } from 'react'
import type { RunbookChapter } from '@/content/runbooks/types'

const TIER_ACTIVE: Record<number, string> = {
  1: 'text-violet-300 bg-violet-500/10 font-medium',
  2: 'text-blue-300 bg-blue-500/10 font-medium',
  3: 'text-emerald-300 bg-emerald-500/10 font-medium',
}

type TOCItem = {
  id: string
  icon: string
  title: string
}

interface Props {
  chapters: Pick<RunbookChapter, 'id' | 'icon' | 'title'>[]
  tier: 1 | 2 | 3
}

export function RunbookTOC({ chapters, tier }: Props) {
  const [activeId, setActiveId] = useState(chapters[0]?.id ?? '')

  const items: TOCItem[] = [
    ...chapters.map(c => ({ id: c.id, icon: c.icon, title: c.title })),
    { id: 'technical', icon: '⚙️', title: 'Technical Details' },
  ]

  useEffect(() => {
    const ids = items.map(i => i.id)
    const obs = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-10% 0px -78% 0px', threshold: 0 }
    )
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeClass = TIER_ACTIVE[tier] ?? TIER_ACTIVE[1]

  return (
    <nav className="flex flex-col gap-0.5 py-1">
      {items.map(item => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors ${
            activeId === item.id
              ? activeClass
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
          }`}
        >
          <span className="text-sm leading-none shrink-0">{item.icon}</span>
          <span className="leading-snug">{item.title}</span>
        </a>
      ))}
    </nav>
  )
}
