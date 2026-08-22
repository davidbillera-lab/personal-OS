// The push workspace is DERIVED, never trusted.
//
// gatedPush() used to take mc_requests.workspace_ref as given: it checked the directory
// existed and then ran git in it. workspace_ref is an ordinary text column, so anything able
// to write the row could aim the push at any git repo on the rig — including one whose HEAD
// happens to equal the approved sha for unrelated reasons. The workspace for an attempt is
// fully determined by (builds dir, request id, attempt id), so derive it and require the
// stored value to canonicalize to exactly that.

import { resolve } from 'path'

// Both ids become path segments. They are uuid columns in Postgres, but a value that is not
// a uuid must never reach resolve(): '..' segments would climb straight out of the builds
// directory. Validate the shape before building any path from them.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value)

// The one and only workspace this attempt may be pushed from — the exact path runAttempt()
// builds in. null means it is not derivable, which callers must treat as a gate failure.
export function expectedWorkspace(buildsDir, requestId, attemptId) {
  if (!buildsDir || !isUuid(requestId) || !isUuid(attemptId)) return null
  return resolve(buildsDir, requestId, attemptId)
}

// null when workspace_ref is exactly this attempt's workspace; otherwise why it is not.
export function workspaceBindingError(buildsDir, row) {
  if (!isUuid(row?.id)) return `request id is not a uuid: ${row?.id ?? 'null'}`
  if (!isUuid(row?.attempt_id)) return `attempt_id is not a uuid: ${row?.attempt_id ?? 'null'}`
  if (typeof row.workspace_ref !== 'string' || row.workspace_ref.trim() === '') return 'workspace_ref missing'
  const expected = expectedWorkspace(buildsDir, row.id, row.attempt_id)
  if (!expected) return 'workspace could not be derived'
  // resolve() normalizes '..' segments and mixed separators, so a traversal attempt simply
  // lands on a path that is not the expected one and is rejected on the comparison below.
  if (resolve(row.workspace_ref) !== expected) {
    return `workspace_ref is not this attempt's workspace (expected ${expected})`
  }
  return null
}
