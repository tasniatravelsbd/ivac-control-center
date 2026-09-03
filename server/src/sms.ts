import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { prisma } from './prisma.js'
import { encryptSecret } from './crypto.js'
import { env } from './config.js'

const patterns = [
  /\b(?:otp|one[- ]?time(?:\s+password)?|verification(?:\s+code)?|security\s+code|code)\D{0,18}(\d{4,8})\b/i,
  /\b(\d{4,8})\b\s+(?:is|for)\s+(?:your\s+)?(?:otp|verification|code)/i
]
export function normalizeBangladeshPhone(value: string): string | null {
  const raw = value.replace(/[\s().-]/g, '')
  const digits = raw.replace(/^\+/, '')
  if (/^8801\d{9}$/.test(digits)) return `+${digits}`
  if (/^01\d{9}$/.test(digits)) return `+880${digits.slice(1)}`
  if (/^1\d{9}$/.test(digits)) return `+880${digits}`
  return null
}
export function detectOtp(message: string): string | null { for (const pattern of patterns) { const match = message.match(pattern); if (match?.[1]) return match[1] } return null }
export function maskOtp(value: string) { return value.length < 3 ? '••••' : `${value.slice(0, 1)}${'•'.repeat(value.length - 2)}${value.slice(-1)}` }
export function redactOtp(message: string, otp: string | null) { return otp ? message.replace(otp, maskOtp(otp)) : message }
function isTestMessage(sender: string, receiver: string) { return /^(?:test|test[-_ ]?sim)$/i.test(sender.trim()) || /^(?:test|test[-_ ]?sim)$/i.test(receiver.trim()) }
export async function authenticateCollector(deviceIdentifier: string, apiKey: string) {
  const collector = await prisma.smsCollector.findUnique({ where: { deviceIdentifier } })
  if (!collector || collector.status === 'DISABLED' || !(await bcrypt.compare(apiKey, collector.apiKeyHash))) { const error: any = new Error('Unknown or unauthorized collector'); error.status = 401; throw error }
  return collector
}
export async function provisionCollector(input: { deviceName: string; deviceIdentifier: string; phoneNumber: string }) {
  const apiKey = randomBytes(32).toString('base64url')
  const collector = await prisma.smsCollector.create({ data: { ...input, phoneNumber: normalizeBangladeshPhone(input.phoneNumber) ?? input.phoneNumber, apiKeyHash: await bcrypt.hash(apiKey, 12), events: { create: { type: 'PROVISIONED', message: 'Collector provisioned by an operator' } } } })
  return { collector, apiKey }
}
export async function matchIncomingSms(collectorId: string, payload: { messageUid: string; receiverNumber: string; senderNumber: string; message: string; receivedAt: Date }) {
  const receiver = normalizeBangladeshPhone(payload.receiverNumber)
  const otp = detectOtp(payload.message)
  const now = new Date()
  const expiresAt = new Date(payload.receivedAt.getTime() + env.OTP_MATCH_TTL_SECONDS * 1000)
  const testMessage = isTestMessage(payload.senderNumber, payload.receiverNumber)
  const message = await prisma.$transaction(async tx => {
    const created = await tx.smsMessage.create({
      data: {
        collectorId,
        messageUid: payload.messageUid,
        receiverNumber: receiver ?? payload.receiverNumber,
        senderNumber: payload.senderNumber,
        messageText: redactOtp(payload.message, otp),
        encryptedOtpCandidate: otp && !testMessage && expiresAt > now ? encryptSecret(otp) : null,
        receivedAt: payload.receivedAt,
        status: testMessage ? 'IGNORED' : expiresAt <= now ? 'EXPIRED' : receiver && otp ? 'NEW' : 'UNMATCHED',
      },
    })
    await tx.collectorEvent.create({ data: { collectorId, type: 'SMS_RECEIVED', message: 'SMS received by collector' } })
    return created
  })
  if (testMessage || expiresAt <= now || !receiver || !otp) return message

  const candidates = await prisma.application.findMany({
    where: { status: 'ACTIVE' },
    include: {
      credentials: true,
      automationJobs: { where: { state: 'WAITING_FOR_OTP' }, select: { id: true } },
    },
  })
  const eligible = candidates.flatMap(application => {
    const matchesPhone = normalizeBangladeshPhone(application.otpReceiverPhone) === receiver || normalizeBangladeshPhone(application.credentials?.loginPhone ?? '') === receiver
    return matchesPhone ? application.automationJobs.map(job => ({ application, job })) : []
  })
  if (eligible.length !== 1) {
    return prisma.smsMessage.update({ where: { id: message.id }, data: { status: eligible.length > 1 ? 'NEEDS_REVIEW' : 'UNMATCHED' } })
  }

  const { application, job } = eligible[0]
  return prisma.$transaction(async tx => {
    const currentJob = await tx.automationJob.findFirst({ where: { id: job.id, applicationId: application.id, state: 'WAITING_FOR_OTP' }, select: { id: true } })
    if (!currentJob) return tx.smsMessage.update({ where: { id: message.id }, data: { status: 'UNMATCHED' } })
    const updated = await tx.smsMessage.update({ where: { id: message.id }, data: { status: 'MATCHED', matchedApplicationId: application.id, processedAt: now } })
    await tx.otpMatch.create({ data: { smsMessageId: message.id, applicationId: application.id, automationJobId: currentJob.id, encryptedOtpValue: encryptSecret(otp), expiresAt } })
    await tx.applicationEvent.create({ data: { applicationId: application.id, actorId: application.createdBy, type: 'OTP_MATCHED', message: 'OTP matched to waiting automation job', metadata: { smsMessageId: message.id, jobId: currentJob.id } } })
    await tx.automationJobEvent.create({ data: { jobId: currentJob.id, state: 'WAITING_FOR_OTP', message: 'OTP_AVAILABLE', diagnostics: { smsMessageId: message.id } } })
    return updated
  })
}
