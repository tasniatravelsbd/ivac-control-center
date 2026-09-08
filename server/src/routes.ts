import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import multer from 'multer'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { AuthRequest, signAccessToken } from './auth.js'
import { applicationInput, updateApplicationInput } from './validation.js'
import { applicationInclude, assertApplicationAccess, event, writePrivatePdf } from './application-service.js'
import { env } from './config.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authenticateCollector, authenticateRegistration, matchIncomingSms, normalizeBangladeshPhone, provisionCollector, requestDeviceRegistration } from './sms.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.DOCUMENT_MAX_SIZE_MB * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && file.originalname.toLowerCase().endsWith('.pdf')) })

function maskPhone(phone: string) {
  const visible = phone.slice(-4)
  return `${'•'.repeat(Math.max(0, phone.length - visible.length))}${visible}`
}

function diagnosticsOf(event: { diagnostics: unknown }) {
  return (event.diagnostics && typeof event.diagnostics === 'object' ? event.diagnostics : {}) as Record<string, unknown>
}

async function automationReadiness(application: {
  credentials: { loginPhone: string; encryptedLoginPassword: string } | null
  preference: { mission: string; ivacCentre: string; visaType: string } | null
  documents: { kind: string; mimeType: string; slot: number }[]
}) {
  const heartbeatSince = new Date(Date.now() - 120_000)
  const [healthyWorkerCount, collectorCount] = await Promise.all([
    prisma.automationWorker.count({ where: { status: 'ONLINE', lastHeartbeatAt: { gte: heartbeatSince } } }),
    prisma.smsCollector.count({ where: { status: 'ONLINE', lastHeartbeatAt: { gte: heartbeatSince } } }),
  ])
  const preference = application.preference
  const checks = [
    { key: 'IVAC_PHONE', label: 'IVAC phone', required: true, ok: !!application.credentials?.loginPhone.trim() },
    { key: 'ENCRYPTED_PASSWORD', label: 'Encrypted password', required: true, ok: !!application.credentials?.encryptedLoginPassword },
    { key: 'BGDR', label: 'Primary BGDR PDF', required: true, ok: application.documents.some(document => document.kind === 'BGDR' && document.slot === 1 && document.mimeType === 'application/pdf') },
    { key: 'MISSION', label: 'Mission', required: true, ok: !!preference?.mission.trim() },
    { key: 'IVAC_CENTRE', label: 'IVAC centre', required: true, ok: !!preference?.ivacCentre.trim() },
    { key: 'PREFERENCES', label: 'Application preferences', required: true, ok: !!preference?.visaType.trim() },
    { key: 'HEALTHY_WORKER', label: 'Healthy worker', required: true, ok: healthyWorkerCount > 0 },
  ]
  return {
    ready: checks.every(check => check.ok), checks,
    smsCollector: { status: collectorCount > 0 ? 'ONLINE' : 'OFFLINE', onlineCount: collectorCount, warning: collectorCount === 0 ? 'No healthy SMS collector is online. OTP delivery may require manual recovery.' : null },
  }
}

router.post('/auth/login', async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Invalid login request' })
  const user = await prisma.user.findUnique({ where: { email: input.data.email } })
  if (!user || !(await bcrypt.compare(input.data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' })
  return res.json({ token: signAccessToken(user.id), user: { id: user.id, name: user.name, email: user.email } })
})
router.post('/applications/:applicationId/automation-jobs', async (req: AuthRequest, res) => {
  const application = await prisma.application.findFirst({
    where: { id: req.params.applicationId, OR: [{ createdBy: req.userId }, { assignedUserId: req.userId }] },
    include: { credentials: true, preference: true, documents: { where: { kind: 'BGDR' }, orderBy: { slot: 'asc' }, take: 1 } },
  })
  if (!application) return res.status(404).json({ error: 'Application not found' })
  if (application.status !== 'ACTIVE') return res.status(409).json({ error: 'Application must be active before automation can start' })
  const readiness = await automationReadiness(application)
  if (!readiness.ready) return res.status(422).json({ error: 'Application is not ready for automation', readiness })
  const activeJob = await prisma.automationJob.findFirst({
    where: { applicationId: application.id, state: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
    select: { id: true, state: true },
  })
  if (activeJob) return res.status(409).json({ error: 'An active automation job already exists', job: activeJob })

  const job = await prisma.$transaction(async tx => {
    const created = await tx.automationJob.create({ data: { applicationId: application.id, state: 'QUEUED' } })
    await tx.application.update({ where: { id: application.id }, data: { automationStatus: 'QUEUED' } })
    await tx.automationJobEvent.create({ data: { jobId: created.id, state: 'QUEUED', message: 'Automation job queued by operator' } })
    await tx.applicationEvent.create({ data: { applicationId: application.id, actorId: req.userId, type: 'AUTOMATION_QUEUED', message: 'Automation job queued' } })
    return created
  })
  res.status(201).json({ id: job.id, applicationId: job.applicationId, state: job.state, createdAt: job.createdAt, updatedAt: job.updatedAt })
})
router.get('/applications/:applicationId/automation-readiness', async (req: AuthRequest, res) => {
  const application = await prisma.application.findFirst({
    where: { id: req.params.applicationId, OR: [{ createdBy: req.userId }, { assignedUserId: req.userId }] },
    include: { credentials: true, preference: true, documents: { select: { kind: true, mimeType: true, slot: true } } },
  })
  if (!application) return res.status(404).json({ error: 'Application not found' })
  res.json(await automationReadiness(application))
})
router.get('/jobs', async (req: AuthRequest, res) => {
  const data = await prisma.automationJob.findMany({
    where: { application: { createdBy: req.userId } },
    include: {
      application: { select: { id: true, fullName: true, webfileNumber: true, primaryPhone: true } },
      worker: { select: { id: true, workerName: true, lastHeartbeatAt: true, status: true } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const otpMatches = await prisma.otpMatch.findMany({
    where: { automationJobId: { in: data.map(job => job.id) } },
    select: { automationJobId: true, consumedAt: true, expiresAt: true },
  })
  const otpByJob = new Map(otpMatches.map(match => [match.automationJobId, match]))
  const now = Date.now()
  res.json({ data: data.map(job => {
    const handoff = job.events.find(event => diagnosticsOf(event).paymentMode)
    const metadata = handoff ? diagnosticsOf(handoff) : {}
    const slotEvent = job.events.find(event => typeof diagnosticsOf(event).slotStatus === 'string')
    const slotMetadata = slotEvent ? diagnosticsOf(slotEvent) : {}
    const latestEvent = job.events[0]
    const otp = otpByJob.get(job.id)
    const otpStatus = job.state === 'WAITING_FOR_OTP'
      ? otp && !otp.consumedAt && otp.expiresAt.getTime() > now ? 'AVAILABLE' : 'WAITING'
      : job.state === 'OTP_RECEIVED' || job.state === 'SUBMITTING_OTP' ? 'CLAIMED'
      : otp?.consumedAt ? 'CONSUMED' : 'NOT_REQUIRED'
    return {
      id: job.id, state: job.state, retryCount: job.retryCount, lastErrorCode: job.lastErrorCode,
      createdAt: job.createdAt, updatedAt: job.updatedAt,
      application: { id: job.application.id, fullName: job.application.fullName, webfileNumber: job.application.webfileNumber, maskedPhone: maskPhone(job.application.primaryPhone) },
      worker: job.worker,
      currentStage: job.state,
      elapsedMs: now - job.createdAt.getTime(),
      lastSuccessfulStage: job.lastSuccessfulStage,
      otpStatus,
      slotStatus: typeof slotMetadata.slotStatus === 'string' ? slotMetadata.slotStatus : 'UNKNOWN',
      paymentStatus: job.state === 'PAYMENT_READY' ? 'READY' : ['PREPARING_PAYMENT', 'CONTINUING_BOOKING'].includes(job.state) ? 'PREPARING' : 'NOT_READY',
      latestSafeError: job.lastErrorCode ?? (typeof diagnosticsOf(latestEvent ?? { diagnostics: null }).errorCode === 'string' ? String(diagnosticsOf(latestEvent!).errorCode) : null),
      latestEvent: latestEvent ? { state: latestEvent.state, event: latestEvent.message, errorCode: diagnosticsOf(latestEvent).errorCode as string | undefined, timestamp: latestEvent.createdAt } : null,
      paymentHandoff: handoff ? { mode: metadata.paymentMode, provider: metadata.paymentProvider ?? null, destinationHost: metadata.destinationHost ?? null, destinationUrl: metadata.destinationUrl ?? null, reference: metadata.paymentReference ?? null, generatedAt: handoff.createdAt } : null,
    }
  }) })
})
router.get('/operations/summary', async (req: AuthRequest, res) => {
  const [workers, collectors, activeApplications, readyApplications, currentJobs] = await Promise.all([
    prisma.automationWorker.findMany({ select: { status: true, lastHeartbeatAt: true } }),
    prisma.smsCollector.findMany({ where: { status: { not: 'DISABLED' } }, select: { status: true, lastHeartbeatAt: true } }),
    prisma.application.count({ where: { createdBy: req.userId, status: 'ACTIVE' } }),
    prisma.application.count({ where: { createdBy: req.userId, status: 'ACTIVE', credentials: { isNot: null }, preference: { isNot: null }, documents: { some: { kind: 'BGDR' } } } }),
    prisma.automationJob.groupBy({ where: { application: { createdBy: req.userId }, state: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } }, by: ['state'], _count: { _all: true } }),
  ])
  const heartbeatWindow = Date.now() - 120_000
  res.json({
    backend: 'ONLINE',
    database: 'CONNECTED',
    workers: { online: workers.filter(worker => worker.lastHeartbeatAt && worker.lastHeartbeatAt.getTime() >= heartbeatWindow).length, total: workers.length },
    collectors: { online: collectors.filter(collector => collector.lastHeartbeatAt && collector.lastHeartbeatAt.getTime() >= heartbeatWindow).length, total: collectors.length },
    applications: { ready: readyApplications, active: activeApplications },
    jobs: currentJobs.map(job => ({ state: job.state, count: job._count._all })),
  })
})
router.get('/jobs/:id/timeline',async(req:AuthRequest,res)=>{const job=await prisma.automationJob.findFirst({where:{id:req.params.id,application:{createdBy:req.userId}},include:{events:{orderBy:{createdAt:'asc'}},application:{select:{id:true}},worker:{select:{id:true}}}});if(!job)return res.status(404).json({error:'Job not found'});res.json({data:job.events.map(e=>({jobId:job.id,applicationId:job.application.id,workerId:job.worker?.id??null,state:e.state,event:e.message,errorCode:(e.diagnostics as any)?.errorCode,timestamp:e.createdAt,durationMs:(e.diagnostics as any)?.durationMs}))})})
router.get('/workers/health',async(_req:AuthRequest,res)=>{const workers=await prisma.automationWorker.findMany({include:{jobs:{where:{state:{notIn:['COMPLETED','FAILED','CANCELLED']}}}}});res.json({data:workers.map(w=>({id:w.id,online:!!w.lastHeartbeatAt&&Date.now()-w.lastHeartbeatAt.getTime()<120000,activeJobCount:w.jobs.length,staleSessionCount:0,retryCount:w.jobs.reduce((n,j)=>n+j.retryCount,0),lastHeartbeat:w.lastHeartbeatAt}))})})
async function enqueueWorkerCommand(jobId: string, workerId: string, commandType: 'PAUSE_JOB' | 'RESUME_JOB' | 'FOCUS_PAYMENT_PAGE' | 'MARK_PAYMENT_COMPLETED' | 'MARK_PAYMENT_FAILED' | 'CLEANUP_JOB_SESSION') {
  const existing = await prisma.workerCommand.findFirst({ where: { jobId, commandType, status: { in: ['PENDING', 'CLAIMED'] } } })
  if (existing) return existing
  return prisma.workerCommand.create({ data: { jobId, workerId, commandType, expiresAt: new Date(Date.now() + 5 * 60_000) } })
}
router.post('/jobs/:id/pause', async (req: AuthRequest, res) => {
  const job = await prisma.automationJob.findFirst({ where: { id: req.params.id, application: { createdBy: req.userId }, workerId: { not: null }, state: { in: ['WAITING_FOR_OTP', 'WAITING_FOR_SLOT', 'VERIFICATION_REQUIRED'] } } })
  if (!job?.workerId) return res.status(409).json({ error: 'Job is not at a safe pause point' })
  await prisma.$transaction([prisma.automationJob.update({ where: { id: job.id }, data: { state: 'PAUSED', pausedAt: new Date() } }), prisma.automationJobEvent.create({ data: { jobId: job.id, state: 'PAUSED', message: 'Operator requested pause at a safe recovery point' } })])
  const command = await enqueueWorkerCommand(job.id, job.workerId, 'PAUSE_JOB')
  res.status(202).json({ id: command.id, status: command.status })
})
router.post('/jobs/:id/resume', async (req: AuthRequest, res) => {
  const job = await prisma.automationJob.findFirst({ where: { id: req.params.id, application: { createdBy: req.userId }, workerId: { not: null }, state: { in: ['VERIFICATION_REQUIRED', 'WAITING_FOR_SLOT', 'PAUSED'] } } })
  if (!job?.workerId) return res.status(409).json({ error: 'Job is not at a safe recovery point' })
  await prisma.$transaction([prisma.automationJob.update({ where: { id: job.id }, data: { state: 'RETRYING', pausedAt: null } }), prisma.automationJobEvent.create({ data: { jobId: job.id, state: 'RETRYING', message: 'Operator requested resume from retained-session recovery point' } })])
  const command = await enqueueWorkerCommand(job.id, job.workerId, 'RESUME_JOB')
  res.status(202).json({ id: command.id, status: command.status })
})
router.post('/jobs/:id/cancel', async (req: AuthRequest, res) => {
  const job = await prisma.automationJob.findFirst({ where: { id: req.params.id, application: { createdBy: req.userId }, state: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } } })
  if (!job) return res.status(409).json({ error: 'Job cannot be cancelled' })
  await prisma.$transaction([prisma.automationJob.update({ where: { id: job.id }, data: { state: 'CANCELLED' } }), prisma.automationJobEvent.create({ data: { jobId: job.id, state: 'CANCELLED', message: 'Operator cancelled automation job' } })])
  const command = job.workerId ? await enqueueWorkerCommand(job.id, job.workerId, 'CLEANUP_JOB_SESSION') : null
  res.status(202).json({ id: command?.id ?? null, status: command?.status ?? 'COMPLETED' })
})
router.post('/jobs/:id/commands/:commandType', async (req: AuthRequest, res) => {
  const type = z.enum(['focus-payment', 'mark-payment-completed', 'mark-payment-failed', 'cleanup-session']).safeParse(req.params.commandType)
  if (!type.success) return res.status(422).json({ error: 'Unsupported command' })
  const job = await prisma.automationJob.findFirst({ where: { id: req.params.id, application: { createdBy: req.userId }, workerId: { not: null } } })
  if (!job?.workerId) return res.status(404).json({ error: 'Active job not found' })
  const map = { 'focus-payment': 'FOCUS_PAYMENT_PAGE', 'mark-payment-completed': 'MARK_PAYMENT_COMPLETED', 'mark-payment-failed': 'MARK_PAYMENT_FAILED', 'cleanup-session': 'CLEANUP_JOB_SESSION' } as const
  if (type.data === 'focus-payment' && job.state !== 'PAYMENT_READY') return res.status(409).json({ error: 'Payment page is not ready' })
  if (type.data === 'cleanup-session' && !['PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED', 'NEEDS_ATTENTION'].includes(job.state)) return res.status(409).json({ error: 'Session cleanup is not safe while this job is active' })
  const command = await enqueueWorkerCommand(job.id, job.workerId, map[type.data])
  res.status(202).json({ id: command.id, status: command.status })
})
router.get('/jobs/:jobId/commands/:commandId',async(req:AuthRequest,res)=>{const command=await prisma.workerCommand.findFirst({where:{id:req.params.commandId,jobId:req.params.jobId,job:{application:{createdBy:req.userId}}},select:{id:true,status:true,errorCode:true,commandType:true,completedAt:true}});if(!command)return res.status(404).json({error:'Command not found'});res.json(command)})
const provisionSchema = z.object({ deviceName: z.string().trim().min(2), deviceIdentifier: z.string().trim().min(8), phoneNumber: z.string().trim().min(6) })
const pairingCreateSchema = z.object({ deviceName: z.string().trim().min(2).max(191), phoneNumber: z.string().trim().min(6).max(30), backendUrl: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Backend URL must use HTTP or HTTPS') })
const pairingExchangeSchema = z.object({ pairingCode: z.string().trim().min(12).max(64) })
const deviceRegistrationSchema = z.object({ deviceName: z.string().trim().min(2).max(191), deviceIdentifier: z.string().trim().min(8).max(191), phoneNumber: z.string().trim().min(6).max(30), registrationSecret: z.string().trim().min(32).max(191) })
const pairingTtlMs = 10 * 60_000
const heartbeatSchema = z.object({ deviceIdentifier: z.string().trim().min(8) })
const smsSchema = z.object({ messageUid: z.string().trim().min(8).max(191), receiverNumber: z.string().trim().min(6), senderNumber: z.string().trim().min(1), message: z.string().min(1).max(5000), receivedAt: z.coerce.date(), deviceIdentifier: z.string().trim().min(8) })
function collectorKey(req: any) { return req.header('x-collector-key') || '' }
function registrationKey(req: any) { return req.header('x-registration-secret') || '' }
const pairingHash = (code: string) => createHash('sha256').update(code).digest('hex')
const collectorDto = (collector: { id: string; deviceName: string; deviceIdentifier: string; phoneNumber: string; status: string }) => ({ id: collector.id, deviceName: collector.deviceName, deviceIdentifier: collector.deviceIdentifier, phoneNumber: collector.phoneNumber, status: collector.status })
async function createPairing(collectorId: string, apiKey: string, backendUrl: string) {
  const code = randomBytes(12).toString('base64url')
  const expiresAt = new Date(Date.now() + pairingTtlMs)
  await prisma.collectorPairing.create({ data: { collectorId, codeHash: pairingHash(code), encryptedCollectorKey: encryptSecret(apiKey), backendUrl: backendUrl.trim().replace(/\/$/, ''), expiresAt } })
  return { pairingCode: code, expiresAt }
}
router.post('/collectors/register', async (req, res) => { const input = provisionSchema.safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() }); try { const created = await provisionCollector(input.data); res.status(201).json({ collector: collectorDto(created.collector), apiKey: created.apiKey }) } catch (error) { const code = error instanceof Error ? error.message : 'REGISTRATION_FAILED'; res.status(code === 'INVALID_BANGLADESH_PHONE' ? 422 : 400).json({ error: code }) } })
router.post('/collectors/device-registrations', async (req, res) => {
  const input = deviceRegistrationSchema.safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() })
  try {
    const collector = await requestDeviceRegistration(input.data)
    res.status(202).json({ registrationStatus: 'PENDING_APPROVAL', collector: collectorDto(collector) })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REGISTRATION_FAILED'
    res.status(code === 'INVALID_BANGLADESH_PHONE' ? 422 : code === 'DEVICE_ALREADY_REGISTERED' ? 409 : 400).json({ error: code })
  }
})
router.get('/collectors/device-registrations/:deviceIdentifier', async (req, res) => {
  try {
    const collector = await authenticateRegistration(req.params.deviceIdentifier, registrationKey(req))
    if (!collector.registrationApprovedAt) return res.status(202).json({ registrationStatus: 'PENDING_APPROVAL' })
    if (!collector.encryptedRegistrationKey || collector.credentialDeliveredAt) return res.status(410).json({ error: 'CREDENTIAL_UNAVAILABLE_RE_REGISTER' })
    const deliveredAt = new Date()
    const updated = await prisma.smsCollector.update({ where: { id: collector.id }, data: { credentialDeliveredAt: deliveredAt, encryptedRegistrationKey: null, registrationSecretHash: null } })
    await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: 'CREDENTIAL_DELIVERED', message: 'Approved credential delivered to registered device' } })
    res.json({ registrationStatus: 'CONNECTED', collector: collectorDto(updated), apiKey: decryptSecret(collector.encryptedRegistrationKey) })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REGISTRATION_FAILED'
    res.status((error as any)?.status ?? 400).json({ error: code })
  }
})
router.post('/collectors/:id/approve-registration', async (req: AuthRequest, res) => {
  const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id } })
  if (!collector) return res.status(404).json({ error: 'Collector not found' })
  if (collector.registrationApprovedAt || !collector.registrationSecretHash) return res.status(409).json({ error: 'Collector is not awaiting approval' })
  const apiKey = randomBytes(32).toString('base64url')
  const updated = await prisma.smsCollector.update({ where: { id: collector.id }, data: { apiKeyHash: await bcrypt.hash(apiKey, 12), encryptedRegistrationKey: encryptSecret(apiKey), registrationApprovedAt: new Date(), credentialDeliveredAt: null, status: 'OFFLINE' } })
  await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: 'REGISTRATION_APPROVED', message: 'Collector registration approved by operator' } })
  res.json({ collector: collectorDto(updated) })
})
router.post('/collectors/pairings', async (req: AuthRequest, res) => {
  const input = pairingCreateSchema.safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() })
  const created = await provisionCollector({ deviceName: input.data.deviceName, phoneNumber: input.data.phoneNumber, deviceIdentifier: `android-${randomUUID()}` })
  const pairing = await createPairing(created.collector.id, created.apiKey, input.data.backendUrl)
  await prisma.collectorEvent.create({ data: { collectorId: created.collector.id, type: 'PAIRING_CREATED', message: 'One-time Android pairing code created' } })
  res.status(201).json({ collector: collectorDto(created.collector), pairingCode: pairing.pairingCode, expiresAt: pairing.expiresAt })
})
router.post('/collectors/:id/pairings', async (req: AuthRequest, res) => {
  const input = z.object({ backendUrl: pairingCreateSchema.shape.backendUrl }).safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() })
  const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id } })
  if (!collector) return res.status(404).json({ error: 'Collector not found' })
  const apiKey = randomBytes(32).toString('base64url')
  await prisma.$transaction(async tx => {
    await tx.smsCollector.update({ where: { id: collector.id }, data: { apiKeyHash: await bcrypt.hash(apiKey, 12), status: 'OFFLINE' } })
    await tx.collectorPairing.updateMany({ where: { collectorId: collector.id, consumedAt: null }, data: { consumedAt: new Date() } })
  })
  const pairing = await createPairing(collector.id, apiKey, input.data.backendUrl)
  await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: 'PAIRING_REGENERATED', message: 'Collector credential rotated and one-time pairing code generated' } })
  res.json({ collector: collectorDto({ ...collector, status: 'OFFLINE' }), pairingCode: pairing.pairingCode, expiresAt: pairing.expiresAt })
})
router.post('/collectors/pair', async (req, res) => {
  const input = pairingExchangeSchema.safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Invalid pairing code' })
  const pairing = await prisma.collectorPairing.findUnique({ where: { codeHash: pairingHash(input.data.pairingCode) }, include: { collector: true } })
  const now = new Date()
  if (!pairing || pairing.consumedAt || pairing.expiresAt <= now) return res.status(410).json({ error: 'Pairing code is invalid or expired' })
  const claimed = await prisma.collectorPairing.updateMany({ where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } })
  if (!claimed.count) return res.status(410).json({ error: 'Pairing code is invalid or expired' })
  await prisma.collectorEvent.create({ data: { collectorId: pairing.collectorId, type: 'PAIRED', message: 'Android collector paired' } })
  res.json({ backendUrl: pairing.backendUrl, collector: collectorDto(pairing.collector), apiKey: decryptSecret(pairing.encryptedCollectorKey) })
})
router.post('/collectors/heartbeat', async (req, res) => { const input = heartbeatSchema.safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed' }); const collector = await authenticateCollector(input.data.deviceIdentifier, collectorKey(req)); const now = new Date(); await prisma.smsCollector.update({ where: { id: collector.id }, data: { status: 'ONLINE', lastHeartbeatAt: now } }); await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: 'HEARTBEAT', message: 'Heartbeat received' } }); res.json({ status: 'ONLINE', serverTime: now.toISOString() }) })
router.get('/collectors/:id/status', async (req: AuthRequest, res) => { const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id }, select: { id: true, deviceName: true, phoneNumber: true, status: true, lastHeartbeatAt: true, updatedAt: true } }); if (!collector) return res.status(404).json({ error: 'Collector not found' }); const age = collector.lastHeartbeatAt ? Date.now() - collector.lastHeartbeatAt.getTime() : Infinity; const status = collector.status === 'DISABLED' ? 'DISABLED' : age < 2 * 60_000 ? 'ONLINE' : age < 10 * 60_000 ? 'DEGRADED' : 'OFFLINE'; res.json({ ...collector, status }) })
router.get('/collectors', async (_req: AuthRequest, res) => {
  const [collectors, applications] = await Promise.all([
    prisma.smsCollector.findMany({ select: { id: true, deviceName: true, deviceIdentifier: true, phoneNumber: true, status: true, registrationApprovedAt: true, credentialDeliveredAt: true, lastHeartbeatAt: true, messages: { select: { receivedAt: true }, orderBy: { receivedAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } }),
    prisma.application.findMany({ where: { status: 'ACTIVE' }, select: { id: true, fullName: true, webfileNumber: true, otpReceiverPhone: true, credentials: { select: { loginPhone: true } }, automationJobs: { where: { state: 'WAITING_FOR_OTP' }, select: { id: true } } } }),
  ])
  res.json({ data: collectors.map(collector => {
    const matchingApplications = applications.filter(application => normalizeBangladeshPhone(application.otpReceiverPhone) === collector.phoneNumber || normalizeBangladeshPhone(application.credentials?.loginPhone ?? '') === collector.phoneNumber)
    const matchingApplicationCount = matchingApplications.length
    const waitingOtpJobCount = matchingApplications.reduce((count, application) => count + application.automationJobs.length, 0)
    const matchedApplication = matchingApplications.length === 1 ? { id: matchingApplications[0].id, fullName: matchingApplications[0].fullName, webfileNumber: matchingApplications[0].webfileNumber } : null
    const matchedJob = waitingOtpJobCount === 1 ? { id: matchingApplications.flatMap(application => application.automationJobs)[0].id, state: 'WAITING_FOR_OTP' } : null
    const status = collector.status === 'DISABLED' ? 'DISABLED' : !collector.registrationApprovedAt ? 'PENDING' : !collector.lastHeartbeatAt || Date.now() - collector.lastHeartbeatAt.getTime() >= 10 * 60_000 ? 'OFFLINE' : Date.now() - collector.lastHeartbeatAt.getTime() >= 2 * 60_000 ? 'DEGRADED' : 'ONLINE'
    return { id: collector.id, deviceName: collector.deviceName, phoneNumber: collector.phoneNumber, status, registrationStatus: !collector.registrationApprovedAt ? 'PENDING_APPROVAL' : !collector.credentialDeliveredAt ? 'CREDENTIAL_READY' : 'CONNECTED', matchingApplicationCount, waitingOtpJobCount, matchedApplication, matchedJob, lastHeartbeatAt: collector.lastHeartbeatAt, lastSmsReceivedAt: collector.messages[0]?.receivedAt ?? null }
  }) })
})
router.patch('/collectors/:id/status', async (req: AuthRequest, res) => { const input = z.object({ action: z.enum(['disable', 'enable']) }).safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed' }); const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id } }); if (!collector) return res.status(404).json({ error: 'Collector not found' }); const status = input.data.action === 'disable' ? 'DISABLED' : 'OFFLINE'; const updated = await prisma.smsCollector.update({ where: { id: collector.id }, data: { status } }); await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: input.data.action === 'disable' ? 'DISABLED' : 'RE_ENABLED', message: input.data.action === 'disable' ? 'Collector disabled by operator' : 'Collector re-enabled by operator' } }); res.json({ collector: collectorDto(updated) }) })
router.delete('/collectors/:id', async (req: AuthRequest, res) => { const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id } }); if (!collector) return res.status(404).json({ error: 'Collector not found' }); await prisma.smsCollector.update({ where: { id: collector.id }, data: { status: 'DISABLED', apiKeyHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 12), registrationSecretHash: null, encryptedRegistrationKey: null, credentialDeliveredAt: new Date() } }); await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: 'REVOKED', message: 'Collector credential revoked by operator' } }); res.status(204).end() })
router.post('/sms', async (req, res) => { const input = smsSchema.safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() }); const collector = await authenticateCollector(input.data.deviceIdentifier, collectorKey(req)); try { const sms = await matchIncomingSms(collector.id, input.data); res.status(201).json({ id: sms.id, status: sms.status }) } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Duplicate message UID', status: 'DUPLICATE' }); throw error } })
router.get('/sms', async (_req: AuthRequest, res) => {
  const query = z.object({ status: z.enum(['NEW','MATCHED','UNMATCHED','PROCESSED','IGNORED','DUPLICATE','NEEDS_REVIEW','EXPIRED']).optional(), collectorId: z.string().optional(), receiver: z.string().optional(), date: z.string().date().optional() }).parse(_req.query)
  const receiver = query.receiver ? normalizeBangladeshPhone(query.receiver) ?? query.receiver : undefined
  const data = await prisma.smsMessage.findMany({
    where: { ...(query.status ? { status: query.status } : {}), ...(query.collectorId ? { collectorId: query.collectorId } : {}), ...(receiver ? { receiverNumber: receiver } : {}), ...(query.date ? { receivedAt: { gte: new Date(`${query.date}T00:00:00.000Z`), lt: new Date(`${query.date}T23:59:59.999Z`) } } : {}) },
    select: {
      id: true, receivedAt: true, receiverNumber: true, senderNumber: true, status: true,
      collector: { select: { id: true, deviceName: true } },
      matchedApplication: { select: { id: true, fullName: true, webfileNumber: true } },
      otpMatch: { select: { automationJobId: true, consumedAt: true, expiresAt: true } },
    },
    orderBy: { receivedAt: 'desc' },
  })
  const now = new Date()
  res.json({ data: data.map(m => ({
    id: m.id,
    receivedAt: m.receivedAt,
    receiverNumber: m.receiverNumber,
    senderNumber: m.senderNumber,
    status: m.status,
    detectedOtp: m.otpMatch ? '••••' : null,
    otpStatus: m.status === 'EXPIRED' || (m.otpMatch && m.otpMatch.expiresAt <= now) ? 'EXPIRED' : m.otpMatch?.consumedAt ? 'CONSUMED' : m.otpMatch ? 'AVAILABLE' : m.status === 'NEEDS_REVIEW' ? 'AMBIGUOUS' : null,
    jobId: m.otpMatch?.automationJobId ?? null,
    matchedApplication: m.matchedApplication,
    collector: m.collector,
  })) })
})
router.put('/sms/:id/assign', async (req: AuthRequest, res) => {
  const input = z.object({ applicationId: z.string().cuid() }).safeParse(req.body)
  if (!input.success) return res.status(422).json({ error: 'Validation failed' })
  const sms = await prisma.smsMessage.findUnique({ where: { id: req.params.id } })
  const application = await prisma.application.findFirst({ where: { id: input.data.applicationId, createdBy: req.userId, status: 'ACTIVE' } })
  if (!sms || !application) return res.status(404).json({ error: 'SMS or application not found' })
  if (!sms.encryptedOtpCandidate) return res.status(422).json({ error: 'No valid, unexpired OTP was detected in this message' })
  const otp = decryptSecret(sms.encryptedOtpCandidate)
  const result = await prisma.$transaction(async tx => {
    const waitingJobs = await tx.automationJob.findMany({ where: { applicationId: application.id, state: 'WAITING_FOR_OTP' }, select: { id: true }, take: 2 })
    if (waitingJobs.length !== 1) return null
    const expiresAt = new Date(Date.now() + env.OTP_MATCH_TTL_SECONDS * 1000)
    await tx.smsMessage.update({ where: { id: sms.id }, data: { status: 'MATCHED', matchedApplicationId: application.id, processedAt: new Date() } })
    await tx.otpMatch.upsert({ where: { smsMessageId: sms.id }, create: { smsMessageId: sms.id, applicationId: application.id, automationJobId: waitingJobs[0].id, encryptedOtpValue: encryptSecret(otp), expiresAt }, update: { applicationId: application.id, automationJobId: waitingJobs[0].id, encryptedOtpValue: encryptSecret(otp), expiresAt, consumedAt: null } })
    await tx.applicationEvent.create({ data: { applicationId: application.id, actorId: req.userId, type: 'OTP_MANUALLY_ASSIGNED', message: 'OTP manually assigned to waiting automation job', metadata: { smsMessageId: sms.id, jobId: waitingJobs[0].id } } })
    await tx.automationJobEvent.create({ data: { jobId: waitingJobs[0].id, state: 'WAITING_FOR_OTP', message: 'OTP_AVAILABLE', diagnostics: { smsMessageId: sms.id } } })
    return waitingJobs[0].id
  })
  if (!result) return res.status(409).json({ error: 'Exactly one waiting automation job is required for OTP assignment' })
  res.json({ id: sms.id, status: 'MATCHED', matchedApplicationId: application.id, jobId: result })
})

router.post('/applications', async (req: AuthRequest, res) => {
  const parsed = applicationInput.safeParse(req.body); if (!parsed.success) return res.status(422).json({ error: 'Validation failed', fields: parsed.error.flatten() })
  if (!parsed.data.loginPassword) return res.status(422).json({ error: 'Validation failed', fields: { fieldErrors: { loginPassword: ['Required when creating an application'] } } })
  const data = parsed.data
  try {
    const app = await prisma.$transaction(async tx => {
      const created = await tx.application.create({ data: { fullName: data.fullName, webfileNumber: data.webfileNumber, email: data.email, primaryPhone: data.primaryPhone, otpReceiverPhone: data.otpReceiverPhone, notes: data.notes, status: data.status ?? 'DRAFT', assignedUserId: data.assignedUserId, createdBy: req.userId, credentials: { create: { loginPhone: data.loginPhone, encryptedLoginPassword: encryptSecret(data.loginPassword!) } }, preference: { create: { ...data.preference, preferredDate: data.preference.preferredDate ? new Date(data.preference.preferredDate) : null, allowedDateFrom: data.preference.allowedDateFrom ? new Date(data.preference.allowedDateFrom) : null, allowedDateTo: data.preference.allowedDateTo ? new Date(data.preference.allowedDateTo) : null } } } })
      await tx.applicationEvent.create({ data: { applicationId: created.id, actorId: req.userId, type: 'APPLICATION_CREATED', message: 'Application profile created' } }); return created
    })
    return res.status(201).json(await prisma.application.findUniqueOrThrow({ where: { id: app.id }, include: applicationInclude }))
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Webfile number already exists' }); throw error }
})

router.get('/applications', async (req: AuthRequest, res) => {
  const q = z.object({ search: z.string().optional(), mission: z.string().optional(), centre: z.string().optional(), visaType: z.string().optional(), status: z.enum(['DRAFT','ACTIVE','ARCHIVED']).optional() }).parse(req.query)
  const search = q.search?.trim(); const apps = await prisma.application.findMany({ where: { createdBy: req.userId, ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }), ...(search ? { OR: [{ fullName: { contains: search } }, { primaryPhone: { contains: search } }, { webfileNumber: { contains: search } }] } : {}), ...(q.mission || q.centre || q.visaType ? { preference: { is: { ...(q.mission ? { mission: q.mission } : {}), ...(q.centre ? { ivacCentre: q.centre } : {}), ...(q.visaType ? { visaType: q.visaType } : {}) } } } : {}) }, include: { preference: true, documents: true, assignedUser: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' } })
  res.json({ data: apps })
})

router.get('/applications/:id', async (req: AuthRequest, res) => { await assertApplicationAccess(req.params.id, req.userId); res.json(await prisma.application.findUniqueOrThrow({ where: { id: req.params.id }, include: applicationInclude })) })

router.put('/applications/:id', async (req: AuthRequest, res) => {
  await assertApplicationAccess(req.params.id, req.userId); const parsed = updateApplicationInput.safeParse(req.body); if (!parsed.success) return res.status(422).json({ error: 'Validation failed', fields: parsed.error.flatten() }); const data = parsed.data
  const updated = await prisma.$transaction(async tx => { const application = await tx.application.update({ where: { id: req.params.id }, data: { ...(data.fullName !== undefined ? { fullName: data.fullName } : {}), ...(data.webfileNumber !== undefined ? { webfileNumber: data.webfileNumber } : {}), ...(data.email !== undefined ? { email: data.email } : {}), ...(data.primaryPhone !== undefined ? { primaryPhone: data.primaryPhone } : {}), ...(data.otpReceiverPhone !== undefined ? { otpReceiverPhone: data.otpReceiverPhone } : {}), ...(data.notes !== undefined ? { notes: data.notes } : {}), ...(data.status ? { status: data.status } : {}), ...(data.assignedUserId !== undefined ? { assignedUserId: data.assignedUserId } : {}), ...(data.preference ? { preference: { upsert: { create: { mission: data.preference.mission ?? '', ivacCentre: data.preference.ivacCentre ?? '', visaType: data.preference.visaType ?? '', preferredDate: data.preference.preferredDate ? new Date(data.preference.preferredDate) : null, allowAlternativeDates: data.preference.allowAlternativeDates ?? false, allowedDateFrom: data.preference.allowedDateFrom ? new Date(data.preference.allowedDateFrom) : null, allowedDateTo: data.preference.allowedDateTo ? new Date(data.preference.allowedDateTo) : null }, update: { ...data.preference, ...(data.preference.preferredDate !== undefined ? { preferredDate: data.preference.preferredDate ? new Date(data.preference.preferredDate) : null } : {}), ...(data.preference.allowedDateFrom !== undefined ? { allowedDateFrom: data.preference.allowedDateFrom ? new Date(data.preference.allowedDateFrom) : null } : {}), ...(data.preference.allowedDateTo !== undefined ? { allowedDateTo: data.preference.allowedDateTo ? new Date(data.preference.allowedDateTo) : null } : {}) } } } } : {}) } });
    if (data.loginPassword || data.loginPhone) await tx.applicationCredential.update({ where: { applicationId: application.id }, data: { ...(data.loginPhone ? { loginPhone: data.loginPhone } : {}), ...(data.loginPassword ? { encryptedLoginPassword: encryptSecret(data.loginPassword) } : {}) } }); await tx.applicationEvent.create({ data: { applicationId: application.id, actorId: req.userId, type: 'APPLICATION_UPDATED', message: 'Application profile updated' } }); return application })
  res.json(await prisma.application.findUniqueOrThrow({ where: { id: updated.id }, include: applicationInclude }))
})

router.delete('/applications/:id', async (req: AuthRequest, res) => { await assertApplicationAccess(req.params.id, req.userId); await prisma.application.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' } }); await event(req.params.id, req.userId, 'APPLICATION_ARCHIVED', 'Application archived'); res.status(204).end() })

const documentSlot = (value: unknown) => z.coerce.number().int().min(1).max(4).safeParse(value ?? 1)
router.post('/applications/:id/document', upload.single('document'), async (req: AuthRequest, res) => {
  await assertApplicationAccess(req.params.id, req.userId)
  const slot = documentSlot(req.body.slot)
  if (!slot.success) return res.status(422).json({ error: 'Document slot must be between 1 and 4' })
  if (!req.file) return res.status(422).json({ error: `A PDF file up to ${env.DOCUMENT_MAX_SIZE_MB}MB is required` })
  const stored = await writePrivatePdf(req.file)
  try {
    const old = await prisma.applicationDocument.findUnique({ where: { applicationId_slot: { applicationId: req.params.id, slot: slot.data } } })
    const doc = await prisma.applicationDocument.upsert({
      where: { applicationId_slot: { applicationId: req.params.id, slot: slot.data } },
      create: { applicationId: req.params.id, kind: 'BGDR', slot: slot.data, originalFilename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storedPath: stored.storedPath, uploadedBy: req.userId },
      update: { originalFilename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storedPath: stored.storedPath, uploadedBy: req.userId, uploadedAt: new Date() },
    })
    if (old) await rm(old.storedPath, { force: true })
    await event(req.params.id, req.userId, old ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED', old ? `BGDR file ${slot.data} replaced` : `BGDR file ${slot.data} uploaded`)
    res.status(201).json(doc)
  } catch (error) { await stored.cleanup(); throw error }
})
router.get('/applications/:id/document', async (req: AuthRequest, res) => {
  await assertApplicationAccess(req.params.id, req.userId)
  const slot = documentSlot(req.query.slot)
  if (!slot.success) return res.status(422).json({ error: 'Document slot must be between 1 and 4' })
  const doc = await prisma.applicationDocument.findUnique({ where: { applicationId_slot: { applicationId: req.params.id, slot: slot.data } } })
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${doc.originalFilename.replace(/[\r\n"]/g, '')}"`)
  createReadStream(doc.storedPath).on('error', () => res.status(404).end()).pipe(res)
})
router.delete('/applications/:id/document', async (req: AuthRequest, res) => {
  await assertApplicationAccess(req.params.id, req.userId)
  const slot = documentSlot(req.query.slot)
  if (!slot.success) return res.status(422).json({ error: 'Document slot must be between 1 and 4' })
  const doc = await prisma.applicationDocument.findUnique({ where: { applicationId_slot: { applicationId: req.params.id, slot: slot.data } } })
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  await prisma.applicationDocument.delete({ where: { id: doc.id } })
  await rm(doc.storedPath, { force: true })
  await event(req.params.id, req.userId, 'DOCUMENT_DELETED', `BGDR file ${slot.data} deleted`)
  res.status(204).end()
})
export { router }
