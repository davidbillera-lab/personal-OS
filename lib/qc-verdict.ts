// Pure, client-safe QC report parsing. lib/codex-qc.ts (server-only) re-exports it.

export type QcVerdict = 'SHIP' | 'FIX-FIRST' | 'RECONSIDER'

// Reads the **Verdict:** line. Exactly one verdict word must be present; an echoed template
// ("SHIP | FIX-FIRST | RECONSIDER"), a missing line or garbage yields null.
export function parseVerdict(report: string): QcVerdict | null {
  const line = report.match(/\*\*Verdict:?\*\*:?\s*(.+)/i)?.[1]
  if (!line) return null
  const found = (['SHIP', 'FIX-FIRST', 'RECONSIDER'] as const).filter(v => new RegExp(`\\b${v}\\b`, 'i').test(line))
  return found.length === 1 ? found[0] : null
}

// Only an explicit SHIP passes. Anything unparseable must never mark a task done.
export function qcStatusFor(report: string): 'passed' | 'issues_found' {
  return parseVerdict(report) === 'SHIP' ? 'passed' : 'issues_found'
}

// Stored notes start with "_Reviewed by <model>[ at <sha7>]_" (written by lib/codex-qc.ts); older gpt-4o notes have neither.
export function qcReportMeta(notes: string): { verdict: QcVerdict | null; model: string | null } {
  const m = notes.match(/^_Reviewed by ([\w.-]+)( at [0-9a-f]{7})?_/)
  return { verdict: parseVerdict(notes), model: m ? `${m[1]}${m[2] ?? ''}` : null }
}
