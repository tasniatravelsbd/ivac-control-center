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
import { authenticateCollector, matchIncomingSms, normalizeBangladeshPhone, provisionCollector } from './sms.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.DOCUMENT_MAX_SIZE_MB * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && file.originalname.toLowerCase().endsWith('.pdf')) })

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
    include: { credentials: true, preference: true, documents: { where: { kind: 'BGDR' }, take: 1 } },
  })
  if (!application) return res.status(404).json({ error: 'Application not found' })
  if (application.status !== 'ACTIVE') return res.status(409).json({ error: 'Application must be active before automation can start' })
  if (!application.credentials || !application.preference || !application.documents.length) {
    return res.status(422).json({ error: 'Application requires credentials, preferences, and a BGDR document before automation can start' })
  }
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
router.get('/jobs', async (req: AuthRequest, res) => { const data = await prisma.automationJob.findMany({ where: { application: { createdBy: req.userId } }, include: { application: { select: { id: true, fullName: true, webfileNumber: true } }, worker:{select:{id:true,workerName:true,lastHeartbeatAt:true,status:true}}, events:{orderBy:{createdAt:'desc'},take:1} }, orderBy: { updatedAt: 'desc' } }); res.json({ data: data.map(j=>({id:j.id,state:j.state,retryCount:j.retryCount,lastErrorCode:j.lastErrorCode,updatedAt:j.updatedAt,application:j.application,worker:j.worker,latestEvent:j.events[0]?{state:j.events[0].state,event:j.events[0].message,errorCode:(j.events[0].diagnostics as any)?.errorCode,timestamp:j.events[0].createdAt}:null})) }) })
router.get('/jobs/:id/timeline',async(req:AuthRequest,res)=>{const job=await prisma.automationJob.findFirst({where:{id:req.params.id,application:{createdBy:req.userId}},include:{events:{orderBy:{createdAt:'asc'}},application:{select:{id:true}},worker:{select:{id:true}}}});if(!job)return res.status(404).json({error:'Job not found'});res.json({data:job.events.map(e=>({jobId:job.id,applicationId:job.application.id,workerId:job.worker?.id??null,state:e.state,event:e.message,errorCode:(e.diagnostics as any)?.errorCode,timestamp:e.createdAt,durationMs:(e.diagnostics as any)?.durationMs}))})})
router.get('/workers/health',async(_req:AuthRequest,res)=>{const workers=await prisma.automationWorker.findMany({include:{jobs:{where:{state:{notIn:['COMPLETED','FAILED','CANCELLED']}}}}});res.json({data:workers.map(w=>({id:w.id,online:!!w.lastHeartbeatAt&&Date.now()-w.lastHeartbeatAt.getTime()<120000,activeJobCount:w.jobs.length,staleSessionCount:0,retryCount:w.jobs.reduce((n,j)=>n+j.retryCount,0),lastHeartbeat:w.lastHeartbeatAt}))})})
router.post('/jobs/:id/resume', async (req: AuthRequest, res) => { const job = await prisma.automationJob.findFirst({ where: { id: req.params.id, application: { createdBy: req.userId }, state: { in: ['VERIFICATION_REQUIRED','PAUSED'] } } }); if (!job) return res.status(409).json({ error: 'Job is not ready to resume' }); await prisma.$transaction([prisma.automationJob.update({ where: { id: job.id }, data: { state: 'RETRYING', pausedAt: null } }), prisma.automationJobEvent.create({ data: { jobId: job.id, state: 'RETRYING', message: 'Operator requested resume after verification' } })]); res.json({ ok: true }) })
router.post('/jobs/:id/commands/:commandType',async(req:AuthRequest,res)=>{const type=z.enum(['focus-payment','mark-payment-completed','mark-payment-failed','cleanup-session']).safeParse(req.params.commandType);if(!type.success)return res.status(422).json({error:'Unsupported command'});const job=await prisma.automationJob.findFirst({where:{id:req.params.id,application:{createdBy:req.userId},workerId:{not:null}}});if(!job)return res.status(404).json({error:'Active job not found'});const map:any={'focus-payment':'FOCUS_PAYMENT_PAGE','mark-payment-completed':'MARK_PAYMENT_COMPLETED','mark-payment-failed':'MARK_PAYMENT_FAILED','cleanup-session':'CLEANUP_JOB_SESSION'};if(type.data==='focus-payment'&&job.state!=='PAYMENT_READY')return res.status(409).json({error:'Payment page is not ready'});const existing=await prisma.workerCommand.findFirst({where:{jobId:job.id,commandType:map[type.data],status:{in:['PENDING','CLAIMED']}}});if(existing)return res.json({id:existing.id,status:existing.status});const command=await prisma.workerCommand.create({data:{jobId:job.id,workerId:job.workerId!,commandType:map[type.data],expiresAt:new Date(Date.now()+5*60_000)}});res.status(202).json({id:command.id,status:command.status})})
router.get('/jobs/:jobId/commands/:commandId',async(req:AuthRequest,res)=>{const command=await prisma.workerCommand.findFirst({where:{id:req.params.commandId,jobId:req.params.jobId,job:{application:{createdBy:req.userId}}},select:{id:true,status:true,errorCode:true,commandType:true,completedAt:true}});if(!command)return res.status(404).json({error:'Command not found'});res.json(command)})
const provisionSchema = z.object({ deviceName: z.string().trim().min(2), deviceIdentifier: z.string().trim().min(8), phoneNumber: z.string().trim().min(6) })
const pairingCreateSchema = z.object({ deviceName: z.string().trim().min(2).max(191), phoneNumber: z.string().trim().min(6).max(30), backendUrl: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Backend URL must use HTTP or HTTPS') })
const pairingExchangeSchema = z.object({ pairingCode: z.string().trim().min(12).max(64) })
const pairingTtlMs = 10 * 60_000
const heartbeatSchema = z.object({ deviceIdentifier: z.string().trim().min(8) })
const smsSchema = z.object({ messageUid: z.string().trim().min(8).max(191), receiverNumber: z.string().trim().min(6), senderNumber: z.string().trim().min(1), message: z.string().min(1).max(5000), receivedAt: z.coerce.date(), deviceIdentifier: z.string().trim().min(8) })
function collectorKey(req: any) { return req.header('x-collector-key') || '' }
const pairingHash = (code: string) => createHash('sha256').update(code).digest('hex')
const collectorDto = (collector: { id: string; deviceName: string; deviceIdentifier: string; phoneNumber: string; status: string }) => ({ id: collector.id, deviceName: collector.deviceName, deviceIdentifier: collector.deviceIdentifier, phoneNumber: collector.phoneNumber, status: collector.status })
async function createPairing(collectorId: string, apiKey: string, backendUrl: string) {
  const code = randomBytes(12).toString('base64url')
  const expiresAt = new Date(Date.now() + pairingTtlMs)
  await prisma.collectorPairing.create({ data: { collectorId, codeHash: pairingHash(code), encryptedCollectorKey: encryptSecret(apiKey), backendUrl: backendUrl.trim().replace(/\/$/, ''), expiresAt } })
  return { pairingCode: code, expiresAt }
}
router.post('/collectors/register', async (req: AuthRequest, res) => { const input = provisionSchema.safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed', fields: input.error.flatten() }); const created = await provisionCollector(input.data); res.status(201).json({ collector: { id: created.collector.id, deviceName: created.collector.deviceName, deviceIdentifier: created.collector.deviceIdentifier, phoneNumber: created.collector.phoneNumber, status: created.collector.status }, apiKey: created.apiKey }) })
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
router.get('/collectors', async (_req: AuthRequest, res) => { const collectors = await prisma.smsCollector.findMany({ select: { id: true, deviceName: true, deviceIdentifier: true, phoneNumber: true, status: true, lastHeartbeatAt: true, messages: { select: { receivedAt: true }, orderBy: { receivedAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } }); res.json({ data: collectors.map(c => ({ id: c.id, deviceName: c.deviceName, phoneNumber: c.phoneNumber, status: c.status === 'DISABLED' ? 'DISABLED' : !c.lastHeartbeatAt || Date.now() - c.lastHeartbeatAt.getTime() >= 10 * 60_000 ? 'OFFLINE' : Date.now() - c.lastHeartbeatAt.getTime() >= 2 * 60_000 ? 'DEGRADED' : 'ONLINE', lastHeartbeatAt: c.lastHeartbeatAt, lastSmsReceivedAt: c.messages[0]?.receivedAt ?? null })) }) })
router.patch('/collectors/:id/status', async (req: AuthRequest, res) => { const input = z.object({ action: z.enum(['disable', 'enable']) }).safeParse(req.body); if (!input.success) return res.status(422).json({ error: 'Validation failed' }); const collector = await prisma.smsCollector.findUnique({ where: { id: req.params.id } }); if (!collector) return res.status(404).json({ error: 'Collector not found' }); const status = input.data.action === 'disable' ? 'DISABLED' : 'OFFLINE'; const updated = await prisma.smsCollector.update({ where: { id: collector.id }, data: { status } }); await prisma.collectorEvent.create({ data: { collectorId: collector.id, type: input.data.action === 'disable' ? 'DISABLED' : 'RE_ENABLED', message: input.data.action === 'disable' ? 'Collector disabled by operator' : 'Collector re-enabled by operator' } }); res.json({ collector: collectorDto(updated) }) })
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

router.post('/applications/:id/document', upload.single('document'), async (req: AuthRequest, res) => { await assertApplicationAccess(req.params.id, req.userId); if (!req.file) return res.status(422).json({ error: `A PDF file up to ${env.DOCUMENT_MAX_SIZE_MB}MB is required` }); const stored = await writePrivatePdf(req.file); try { const old = await prisma.applicationDocument.findUnique({ where: { applicationId_kind: { applicationId: req.params.id, kind: 'BGDR' } } }); const doc = await prisma.applicationDocument.upsert({ where: { applicationId_kind: { applicationId: req.params.id, kind: 'BGDR' } }, create: { applicationId: req.params.id, originalFilename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storedPath: stored.storedPath, uploadedBy: req.userId }, update: { originalFilename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storedPath: stored.storedPath, uploadedBy: req.userId, uploadedAt: new Date() } }); if (old) await rm(old.storedPath, { force: true }); await event(req.params.id, req.userId, old ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED', old ? 'BGDR document replaced' : 'BGDR document uploaded'); res.status(201).json(doc) } catch (e) { await stored.cleanup(); throw e } })
router.get('/applications/:id/document', async (req: AuthRequest, res) => { await assertApplicationAccess(req.params.id, req.userId); const doc = await prisma.applicationDocument.findUnique({ where: { applicationId_kind: { applicationId: req.params.id, kind: 'BGDR' } } }); if (!doc) return res.status(404).json({ error: 'Document not found' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${doc.originalFilename.replace(/[\r\n"]/g, '')}"`); createReadStream(doc.storedPath).on('error', () => res.status(404).end()).pipe(res) })
router.delete('/applications/:id/document', async (req: AuthRequest, res) => { await assertApplicationAccess(req.params.id, req.userId); const doc = await prisma.applicationDocument.findUnique({ where: { applicationId_kind: { applicationId: req.params.id, kind: 'BGDR' } } }); if (!doc) return res.status(404).json({ error: 'Document not found' }); await prisma.applicationDocument.delete({ where: { id: doc.id } }); await rm(doc.storedPath, { force: true }); await event(req.params.id, req.userId, 'DOCUMENT_DELETED', 'BGDR document deleted'); res.status(204).end() })
export { router }
