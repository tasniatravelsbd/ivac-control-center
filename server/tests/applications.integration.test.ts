/** Requires an isolated MySQL database set in DATABASE_URL. Run only against a disposable test DB. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/prisma.js'
import { signAccessToken } from '../src/auth.js'
import { createApp } from '../src/index.js'

const run = process.env.RUN_INTEGRATION_TESTS === 'true'
describe.runIf(run)('application API', () => {
  const app = createApp(); let token = ''; let userId = ''; const input = { fullName: 'Ayesha Khan', webfileNumber: 'WF-1001', email: 'ayesha@example.test', primaryPhone: '+8801700000000', otpReceiverPhone: '+8801700000001', loginPhone: '+8801700000000', loginPassword: 'secret-pass-123', preference: { mission: 'Italy', ivacCentre: 'Dhaka', visaType: 'Tourist', allowAlternativeDates: false } }
  beforeEach(async () => { await prisma.applicationEvent.deleteMany(); await prisma.applicationDocument.deleteMany(); await prisma.applicationCredential.deleteMany(); await prisma.appointmentPreference.deleteMany(); await prisma.application.deleteMany(); await prisma.user.deleteMany(); const user = await prisma.user.create({ data: { name: 'Operator', email: 'operator@example.test', passwordHash: await bcrypt.hash('password', 4) } }); userId = user.id; token = signAccessToken(userId) })
  afterAll(() => prisma.$disconnect())
  it('creates, lists, updates, and archives an application without exposing its password', async () => { const created = await request(app).post('/api/applications').set('Authorization', `Bearer ${token}`).send(input).expect(201); expect(created.body.credentials).toBeUndefined(); const stored = await prisma.applicationCredential.findUniqueOrThrow({ where: { applicationId: created.body.id } }); expect(stored.encryptedLoginPassword).not.toContain(input.loginPassword); await request(app).get('/api/applications?search=Ayesha').set('Authorization', `Bearer ${token}`).expect(200); await request(app).put(`/api/applications/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ notes: 'Updated' }).expect(200); await request(app).delete(`/api/applications/${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(204) })
  it('rejects invalid input and unauthorized document access', async () => { await request(app).post('/api/applications').set('Authorization', `Bearer ${token}`).send({}).expect(422); const other = await prisma.user.create({ data: { name: 'Other', email: 'other@example.test', passwordHash: 'x' } }); await request(app).get('/api/applications/not-real').set('Authorization', `Bearer ${signAccessToken(other.id)}`).expect(404) })
})
