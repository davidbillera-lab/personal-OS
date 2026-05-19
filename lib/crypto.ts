import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_HEX = process.env.CREDENTIAL_ENCRYPTION_KEY ?? ''

function getKey(): Buffer {
  if (KEY_HEX.length !== 64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(KEY_HEX, 'hex')
}

// Stored format: iv(24 hex) + authTag(32 hex) + ciphertext(hex)
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

export function decrypt(ciphertext: string): string {
  const key = getKey()
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex')
  const tag = Buffer.from(ciphertext.slice(24, 56), 'hex')
  const encrypted = Buffer.from(ciphertext.slice(56), 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

export function maskValue(plaintext: string): string {
  if (plaintext.length <= 4) return '••••••••'
  return '••••••••' + plaintext.slice(-4)
}
