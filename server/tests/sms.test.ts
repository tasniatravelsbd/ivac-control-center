import { describe, expect, it } from 'vitest'
import { detectOtp, maskOtp, normalizeBangladeshPhone, redactOtp } from '../src/sms.js'

describe('Bangladesh phone normalization', () => {
  it('normalizes common local and international formats', () => { expect(normalizeBangladeshPhone('01712-345678')).toBe('+8801712345678'); expect(normalizeBangladeshPhone('+880 1712 345678')).toBe('+8801712345678'); expect(normalizeBangladeshPhone('123')).toBeNull() })
})
describe('OTP detection and redaction', () => {
  it('detects contextual numeric codes but not incidental numbers', () => { expect(detectOtp('Your IVAC OTP is 538921. Do not share it.')).toBe('538921'); expect(detectOtp('Verification code: 4728')).toBe('4728'); expect(detectOtp('Your balance is 5200 BDT')).toBeNull() })
  it('does not retain a full OTP in redacted display text', () => { expect(redactOtp('OTP is 538921', '538921')).toBe('OTP is 5••••1'); expect(maskOtp('4728')).toBe('4••8') })
})
