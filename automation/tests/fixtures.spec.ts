import { test, expect } from '@playwright/test'
import { WorkflowOrchestrator } from '../src/coordinator/workflow-orchestrator.js'
import { assertFixtureTarget, ivacPath } from '../src/config/ivac-target.js'
import { JobCoordinator } from '../src/coordinator/job-coordinator.js'
import { ActiveJobRegistry } from '../src/coordinator/active-job-registry.js'
import { BrowserSession } from '../src/browser/session.js'
import type { BrowserSessionFactory } from '../src/browser/session-factory.js'
import { startLocalWorkerApi, LocalWorkerApi } from './support/local-worker-api.js'
import { startLocalIvacFixture } from './support/local-ivac-fixture.js'
import { createFixtureJob } from './support/local-worker-api.js'
import { FixedIvacTargetResolver } from '../src/config/ivac-target.js'

test('local smoke invokes the canonical workflow orchestrator only', async () => {
  const prior = process.env.IVAC_BASE_URL
  process.env.IVAC_BASE_URL = 'http://127.0.0.1:4174'
  assertFixtureTarget()
  expect(ivacPath('/signin')).toBe('http://127.0.0.1:4174/signin')
  const calls: string[] = []
  const registry = { get: () => ({ state: 'PAYMENT_READY' }) }
  const coordinator: any = {
    registry,
    startJob: async () => { calls.push('startJob'); return { status: 'AUTHENTICATED', jobId: 'fixture-job' } },
    uploadDocument: async () => calls.push('uploadDocument'),
    confirmInformation: async () => calls.push('confirmInformation'),
    selectMission: async () => calls.push('selectMission'),
    selectCentre: async () => calls.push('selectCentre'),
    readSlotState: async () => ({ availableDates: ['2026-09-03'] }),
    matchDatePreferences: async () => ({ bestCandidate: '2026-09-03' }),
    selectStoredCandidateDate: async () => calls.push('selectStoredCandidateDate'),
    continueBooking: async () => calls.push('continueBooking'),
    detectPaymentHandoff: async () => calls.push('detectPaymentHandoff')
  }
  await new WorkflowOrchestrator(coordinator).runJobWorkflow('fixture-job')
  expect(calls).toEqual(['startJob', 'uploadDocument', 'confirmInformation', 'selectMission', 'selectCentre', 'selectStoredCandidateDate', 'continueBooking', 'detectPaymentHandoff'])
  process.env.IVAC_BASE_URL = prior
})

test('fixture target rejects production IVAC before navigation', () => {
  const prior = process.env.IVAC_BASE_URL
  process.env.IVAC_BASE_URL = 'https://appointment.ivacbd.com'
  expect(assertFixtureTarget).toThrow('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION')
  process.env.IVAC_BASE_URL = prior
})

test('canonical workflow reaches PAYMENT_READY through local Playwright fixtures', async () => {
  const fixture = await startLocalIvacFixture()
  const apiServer = await startLocalWorkerApi()
  const prior = process.env.IVAC_BASE_URL
  process.env.IVAC_BASE_URL = fixture.url
  fixture.assertSafeUrl(fixture.url)
  assertFixtureTarget()

  let factoryCalls = 0
  let contextCount = 0
  const productionRequests: string[] = []
  const factory: BrowserSessionFactory = {
    async create() {
      factoryCalls++
      const session = new BrowserSession()
      const open = session.open.bind(session)
      session.open = async () => {
        const page = await open()
        contextCount++
        page.on('request', request => {
          if (new URL(request.url()).hostname === 'appointment.ivacbd.com') productionRequests.push(request.url())
        })
        return page
      }
      return session
    }
  }

  const registry = new ActiveJobRegistry()
  const coordinator = new JobCoordinator(new LocalWorkerApi(apiServer.url) as any, registry, factory)
  try {
    const result = await new WorkflowOrchestrator(coordinator).runJobWorkflow('fixture-job')
    expect(result).toEqual({ status: 'PAYMENT_READY', jobId: 'fixture-job' })
    expect(factoryCalls).toBe(1)
    expect(contextCount).toBe(1)
    expect(registry.get('fixture-job')?.state).toBe('PAYMENT_READY')
    expect(registry.get('fixture-job')?.bestCandidateDate).toBe('2026-09-03')
    expect(apiServer.jobs.get('fixture-job')?.otpConsumed).toBe(true)
    expect(fixture.metrics.otpSubmitted).toBe(1)
    expect(fixture.metrics.documentSelected).toBe(1)
    expect(fixture.metrics.missionContinued).toBe(1)
    expect(fixture.metrics.dateSelected).toBe(1)
    expect(fixture.metrics.continueBooking).toBe(1)
    expect(productionRequests).toEqual([])
  } finally {
    await coordinator.shutdown()
    await apiServer.close()
    await fixture.close()
    process.env.IVAC_BASE_URL = prior
  }
})

test('two canonical workflows retain isolated local sessions', async () => {
  const jobA=createFixtureJob({jobId:'fixture-job-a',otp:'111111'})
  const jobB=createFixtureJob({jobId:'fixture-job-b',scenario:'no-available-date',otp:'222222'})
  const api=await startLocalWorkerApi([jobA,jobB])
  const fixtureA=await startLocalIvacFixture('happy-path')
  const fixtureB=await startLocalIvacFixture('no-available-date')
  const sessions:BrowserSession[]=[]
  const factory:BrowserSessionFactory={async create(){const session=new BrowserSession();sessions.push(session);return session}}
  const registryA=new ActiveJobRegistry(),registryB=new ActiveJobRegistry()
  const a=new JobCoordinator(new LocalWorkerApi(api.url) as any,registryA,factory,new FixedIvacTargetResolver(fixtureA.url,{fixture:true}))
  const b=new JobCoordinator(new LocalWorkerApi(api.url) as any,registryB,factory,new FixedIvacTargetResolver(fixtureB.url,{fixture:true}))
  try{
    const [resultA,resultB]=await Promise.all([new WorkflowOrchestrator(a).runJobWorkflow(jobA.jobId),new WorkflowOrchestrator(b).runJobWorkflow(jobB.jobId)])
    expect(resultA).toEqual({status:'PAYMENT_READY',jobId:jobA.jobId})
    expect(resultB).toEqual({status:'NO_AVAILABLE_DATE',jobId:jobB.jobId})
    expect(sessions).toHaveLength(2)
    expect(registryA.get(jobA.jobId)?.applicationId).not.toBe(registryB.get(jobB.jobId)?.applicationId)
    expect(registryA.get(jobA.jobId)?.session.context).not.toBe(registryB.get(jobB.jobId)?.session.context)
    expect(registryA.get(jobA.jobId)?.session.page).not.toBe(registryB.get(jobB.jobId)?.session.page)
    expect(jobA.otpClaimed).toBe(true);expect(jobA.otpConsumed).toBe(true)
    expect(jobB.otpClaimed).toBe(true);expect(jobB.otpConsumed).toBe(true)
    expect(fixtureA.metrics.dateSelected).toBe(1);expect(fixtureA.metrics.continueBooking).toBe(1)
    expect(fixtureB.metrics.dateSelected).toBe(0);expect(fixtureB.metrics.continueBooking).toBe(0)
    await registryB.cleanup(jobB.jobId)
    expect(registryB.get(jobB.jobId)).toBeUndefined()
    expect(registryA.get(jobA.jobId)?.session.page?.isClosed()).toBe(false)
  }finally{await a.shutdown();await b.shutdown();await api.close();await fixtureA.close();await fixtureB.close()}
})
