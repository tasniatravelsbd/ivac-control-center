import 'dotenv/config'
import { prisma } from './prisma.js'

// Schedule every few minutes. Removes expired OTP ciphertext while preserving redacted SMS audit records.
const now = new Date()
const expired = await prisma.otpMatch.findMany({ where: { expiresAt: { lt: now } }, select: { smsMessageId: true, automationJobId: true } })
await prisma.otpMatch.deleteMany({ where: { expiresAt: { lt: now } } })
if (expired.length) {
  await prisma.smsMessage.updateMany({ where: { id: { in: expired.map(x => x.smsMessageId) } }, data: { encryptedOtpCandidate: null, processedAt: now, status: 'EXPIRED' } })
  await prisma.automationJobEvent.createMany({ data: expired.filter(x => x.automationJobId).map(x => ({ jobId: x.automationJobId!, state: 'WAITING_FOR_OTP', message: 'OTP_EXPIRED' })) })
}
await prisma.$disconnect()
