import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './config.js'

const key = Buffer.from(env.APP_ENCRYPTION_KEY.slice('base64:'.length), 'base64')
if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes')

/** AES-256-GCM: ciphertext includes a unique IV and authentication tag. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}
export function decryptSecret(payload: string): string {
  const [ivText, tagText, dataText] = payload.split('.')
  if (!ivText || !tagText || !dataText) throw new Error('Malformed encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
}
