// Env values that end up in HTTP headers (API keys) must be pure ASCII.
// Keys pasted from a UTF-8-with-BOM file or a rich-text editor pick up invisible
// characters — a leading BOM (U+FEFF) makes fetch throw:
//   "Cannot convert argument to a ByteString because the character at index 0
//    has a value of 65279 which is greater than 255"
// Strip them at read time so a bad paste can't take down every model call.
const INVISIBLE = /[﻿​-‍⁠]/g

export function cleanEnv(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const cleaned = raw.replace(INVISIBLE, '').trim()
  return cleaned === '' ? undefined : cleaned
}

export function requireEnv(name: string): string {
  const value = cleanEnv(name)
  if (!value) throw new Error(`${name} is not set (or is empty after stripping invisible characters)`)
  return value
}
