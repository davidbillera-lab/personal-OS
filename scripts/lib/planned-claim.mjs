// Gap A1 (second-half relay): pure eligibility check for claiming a Hermes-deposited
// plan row. Kept dependency-free (no supabase client) so it can be unit-tested without a
// live DB. The dispatcher only calls the DB-touching claim path when this would be true —
// see claimPlannedOne() in dispatcher.mjs.
export function isClaimablePlanned(row, claimPlanned) {
  if (!claimPlanned) return false
  if (!row) return false
  return row.status === 'submitted' && row.phase === 'planned' && row.plan != null
}
