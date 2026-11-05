// Write contract for mc_requests (migration 029): updated_at is the row's version token and
// every UPDATE must carry `.eq('updated_at', <token>)` using the raw string from a read.
// The dispatcher's claim-time token goes stale during a long build for innocent reasons, so
// writes that land after one (approval request, build-failed, push gate, completion) first
// re-read the row, check it is still THIS attempt's in an allowed state, and CAS on the
// fresh token. Pure apart from the `sb` argument — unit-tested with a tiny fake.

// Returns { ok: true, fresh } when the row is still ours and writable, else
// { ok: false, reason: 'error' | 'gone' | 'moved-on', error? }.
//   'error'    — the read itself failed (transport); the caller should retry, not conclude.
//   'gone'     — no such row.
//   'moved-on' — attempt_id changed, status not in `statuses`, or phase != `phase`.
// `fresh.updated_at` is passed through untouched (never via new Date(): that drops the
// microseconds the CAS compares on).
export async function rereadForWrite(sb, row, statuses, { phase } = {}) {
  const { data, error } = await sb.from('mc_requests')
    .select('status, phase, attempt_id, updated_at').eq('id', row.id).maybeSingle()
  if (error) return { ok: false, reason: 'error', error }
  if (!data) return { ok: false, reason: 'gone' }
  if (data.attempt_id !== row.attempt_id || !statuses.includes(data.status)) return { ok: false, reason: 'moved-on' }
  if (phase !== undefined && data.phase !== phase) return { ok: false, reason: 'moved-on' }
  return { ok: true, fresh: data }
}
