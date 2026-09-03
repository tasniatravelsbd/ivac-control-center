import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/crypto.js'

describe('credential encryption', () => {
  it('uses non-deterministic authenticated encryption', () => {
    const first = encryptSecret('do-not-store-me'); const second = encryptSecret('do-not-store-me')
    expect(first).not.toContain('do-not-store-me'); expect(second).not.toBe(first)
    expect(decryptSecret(first)).toBe('do-not-store-me')
  })
})
