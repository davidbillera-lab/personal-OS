// Prices are per 1M tokens (USD). Update when provider pricing changes.
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 0.80,  out: 4.00  },
  'claude-sonnet-4-6':         { in: 3.00,  out: 15.00 },
  'claude-opus-4-7':           { in: 15.00, out: 75.00 },
  'gpt-4o-mini':               { in: 0.15,  out: 0.60  },
  'gpt-4o':                    { in: 2.50,  out: 10.00 },
  'codex-mini-latest':         { in: 1.50,  out: 6.00  },
  'gemini-1.5-flash':          { in: 0.075, out: 0.30  },
  'gemini-1.5-pro':            { in: 3.50,  out: 10.50 },
}

export function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out
}
