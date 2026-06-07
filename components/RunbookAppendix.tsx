'use client'

import { useState } from 'react'
import type { TechnicalAppendix } from '@/content/runbooks/types'

export function RunbookAppendix({ technical }: { technical: TechnicalAppendix }) {
  const [open, setOpen] = useState(false)

  return (
    <div id="technical" className="rounded-xl border border-white/[0.08] bg-white/[0.02] scroll-mt-24">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left group"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">⚙️</span>
          <div>
            <h2 className="text-sm font-semibold text-white">Technical Details</h2>
            <p className="text-xs text-gray-600 mt-0.5">How the sausage is made — stack, integrations, architecture</p>
          </div>
        </div>
        <span className="text-[11px] text-gray-600 group-hover:text-gray-400 transition shrink-0">
          {open ? '▲ Collapse' : '▼ Expand'}
        </span>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-white/[0.06] pt-5 flex flex-col gap-6">
          {technical.stack.length > 0 && (
            <div>
              <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                Stack
              </h3>
              <div className="flex flex-wrap gap-2">
                {technical.stack.map(s => (
                  <span
                    key={s}
                    className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-gray-300 border border-white/[0.06]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {technical.integrations.length > 0 && (
            <div>
              <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                Integrations
              </h3>
              <div className="flex flex-wrap gap-2">
                {technical.integrations.map(i => (
                  <span
                    key={i}
                    className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-gray-300 border border-white/[0.06]"
                  >
                    {i}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
              How It Works
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">{technical.how_it_works}</p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs border-t border-white/[0.06] pt-4">
            <div>
              <span className="text-gray-600">Owner: </span>
              <span className="text-gray-300">{technical.owner}</span>
            </div>
            {technical.repo && (
              <div>
                <span className="text-gray-600">Repo: </span>
                <span className="text-gray-300 font-mono">{technical.repo}</span>
              </div>
            )}
          </div>

          {technical.notes && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
              <p className="text-xs text-amber-300/90 leading-relaxed">{technical.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
