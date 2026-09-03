import { describe,it,expect } from 'vitest'
import { assertFixtureTarget } from '../src/config/ivac-target.js'
import { WorkflowOrchestrator } from '../src/coordinator/workflow-orchestrator.js'
describe('workflow target guard',()=>{it('rejects production as fixture target',()=>{const prior=process.env.IVAC_BASE_URL;process.env.IVAC_BASE_URL='https://appointment.ivacbd.com';expect(assertFixtureTarget).toThrow('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION');process.env.IVAC_BASE_URL=prior})})

describe('workflow lifecycle boundary',()=>{
  function coordinatorWith(result:any){
    const calls:string[]=[]
    return {calls,coordinator:{
      registry:{get:()=>({state:'AUTHENTICATED'})},
      startJob:async()=>result,
      uploadDocument:async()=>{calls.push('upload')},
      confirmInformation:async()=>{calls.push('confirm')},
      selectMission:async()=>{calls.push('mission')},
      selectCentre:async()=>{calls.push('centre')},
      readSlotState:async()=>({availableDates:['2026-09-03']}),
      matchDatePreferences:async()=>({bestCandidate:'2026-09-03'}),
      selectStoredCandidateDate:async()=>{calls.push('date')},
      continueBooking:async()=>{calls.push('booking')},
      detectPaymentHandoff:async()=>{calls.push('payment')}
    }}
  }

  it.each(['VERIFICATION_REQUIRED','OTP_TIMEOUT','OTP_REJECTED','OTP_EXPIRED','OTP_MATCH_AMBIGUOUS','SESSION_LOST','NEEDS_ATTENTION','FAILED'])('stops downstream stages for %s',async(status)=>{
    const {calls,coordinator}=coordinatorWith({status,jobId:'job-1'})
    const result=await new WorkflowOrchestrator(coordinator as any).runJobWorkflow('job-1')
    expect(result).toEqual({status,jobId:'job-1'})
    expect(calls).toEqual([])
  })

  it('continues only after the authenticated lifecycle result',async()=>{
    const {calls,coordinator}=coordinatorWith({status:'AUTHENTICATED',jobId:'job-1'})
    await new WorkflowOrchestrator(coordinator as any).runJobWorkflow('job-1')
    expect(calls).toEqual(['upload','confirm','mission','centre','date','booking','payment'])
  })
})
