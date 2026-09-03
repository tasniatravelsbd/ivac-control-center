import { BrowserSession } from '../browser/session.js'
import { WorkerApi } from '../api/client.js'
import { IvacLoginPage } from '../pages/ivac-login-page.js'
import { IvacOtpPage } from '../pages/ivac-otp-page.js'
import { IvacFileUploadPage } from '../pages/ivac-file-upload-page.js'
import { validatePdf } from '../services/document-validator.js'
import { retry } from '../utils/retry.js'
import { IvacMissionPage } from '../pages/ivac-mission-page.js'
import { IvacTimeSlotPage } from '../pages/ivac-time-slot-page.js'
import { IvacContinuePaymentPage } from '../pages/ivac-continue-payment-page.js'
import type { WorkerCommand } from '../api/client.js'
import { WorkerErrorClassifier } from '../services/worker-error-classifier.js'
import { IdempotencyGuard } from '../services/idempotency-guard.js'
import { DatePreferenceMatcher } from '../services/date-preference-matcher.js'
import { ActiveJobRegistry } from './active-job-registry.js'
import { ConfigIvacTargetResolver, type IvacTargetResolver } from '../config/ivac-target.js'
import { PlaywrightBrowserSessionFactory, type BrowserSessionFactory } from '../browser/session-factory.js'

const OTP_TIMEOUT_MS=Number(process.env.OTP_WAIT_TIMEOUT_MS??120000)
export type StartJobResult =
  | { status: 'AUTHENTICATED'; jobId: string }
  | { status: 'VERIFICATION_REQUIRED'; jobId: string }
  | { status: 'OTP_TIMEOUT'; jobId: string }
  | { status: 'OTP_REJECTED'; jobId: string }
  | { status: 'OTP_EXPIRED'; jobId: string }
  | { status: 'OTP_MATCH_AMBIGUOUS'; jobId: string }
  | { status: 'SESSION_LOST'; jobId: string }
  | { status: 'NEEDS_ATTENTION'; jobId: string; errorCode?: string }
  | { status: 'FAILED'; jobId: string; errorCode?: string }

export class JobCoordinator {
  private readonly classifier=new WorkerErrorClassifier(); private readonly effects=new IdempotencyGuard()
  private readonly otpInFlight=new Map<string,Promise<StartJobResult>>()
  constructor(private api=new WorkerApi(),readonly registry=new ActiveJobRegistry(),private sessions:BrowserSessionFactory=new PlaywrightBrowserSessionFactory(),private ivacTarget:IvacTargetResolver=new ConfigIvacTargetResolver()){}
  async startJob(jobId:string):Promise<StartJobResult>{
    const existing=this.registry.get(jobId)
    if(existing){
      if(existing.state==='AUTHENTICATED')return {status:'AUTHENTICATED',jobId}
      if(existing.state==='VERIFICATION_REQUIRED')return {status:'VERIFICATION_REQUIRED',jobId}
      if(existing.state==='OTP_PAGE_REACHED'||existing.state==='WAITING_FOR_OTP')return this.awaitOtpLifecycle(jobId)
      if(!existing.session.page||existing.session.page.isClosed())return {status:'SESSION_LOST',jobId}
      return this.resultForState(jobId,existing.state)
    }

    let session:BrowserSession|undefined
    try {
      await this.api.claim(jobId)
      const ctx=await this.api.context(jobId)
      session=await this.sessions.create(jobId)
      const page=await session.open()
      await this.api.status(jobId,'OPENING_BROWSER','Isolated browser context opened')
      await this.api.status(jobId,'LOGGING_IN','Navigating to authorized IVAC login')
      await page.goto(this.ivacTarget.url('/signin'),{waitUntil:'domcontentloaded',timeout:30000})

      const login=new IvacLoginPage(page)
      await login.waitUntilReady()
      await this.api.status(jobId,'CHECK_VERIFICATION','Login form ready')
      if(await login.detectVerification()){
        this.registry.register({jobId,applicationId:ctx.application.id,session,state:'VERIFICATION_REQUIRED',paused:true,cancelled:false})
        await this.api.status(jobId,'VERIFICATION_REQUIRED','Human verification required')
        return {status:'VERIFICATION_REQUIRED',jobId}
      }

      await login.enterPhone(ctx.login.phone)
      await login.enterPassword(ctx.login.password)
      await login.submit()
      await this.api.status(jobId,'LOGIN_SUBMITTED','Login submitted')
      await page.waitForTimeout(800)
      if(await login.detectLoginFailure())throw new Error('LOGIN_INVALID_CREDENTIALS')
      if(await login.detectVerification()){
        this.registry.register({jobId,applicationId:ctx.application.id,session,state:'VERIFICATION_REQUIRED',paused:true,cancelled:false})
        await this.api.status(jobId,'VERIFICATION_REQUIRED','Human verification required')
        return {status:'VERIFICATION_REQUIRED',jobId}
      }
      if(!await login.detectOtpTransition())throw new Error('LOGIN_TIMEOUT')

      this.registry.register({jobId,applicationId:ctx.application.id,session,state:'OTP_PAGE_REACHED',paused:false,cancelled:false})
      await this.api.status(jobId,'OTP_PAGE_REACHED','OTP page reached')
      return this.awaitOtpLifecycle(jobId)
    }catch(error){
      await session?.cleanup().catch(()=>undefined)
      await this.api.failure(jobId,this.code(error),'Login could not continue safely').catch(()=>undefined)
      return {status:'FAILED',jobId,errorCode:this.code(error)}
    }
  }
  async continueOtpFlow(jobId:string):Promise<StartJobResult>{
    const active=this.registry.get(jobId)
    if(!active?.session.page||active.session.page.isClosed())return {status:'SESSION_LOST',jobId}
    const otpPage=new IvacOtpPage(active.session.page)
    try{
      await otpPage.waitUntilReady()
      this.registry.update(jobId,'WAITING_FOR_OTP')
      await this.api.status(jobId,'WAITING_FOR_OTP','OTP waiting started')
      const claimed:any=await otpPage.waitForOtp(()=>this.api.otpClaim(jobId),OTP_TIMEOUT_MS)
      if(new Date(claimed.expiresAt)<=new Date())throw new Error('OTP_EXPIRED')
      this.registry.update(jobId,'OTP_RECEIVED')
      await this.api.status(jobId,'OTP_RECEIVED','OTP received for this job')
      this.registry.update(jobId,'SUBMITTING_OTP')
      await this.api.status(jobId,'SUBMITTING_OTP','OTP submitted')
      await otpPage.submitOtp(claimed.otp)
      await this.api.otpConsume(jobId,claimed.id)
      await active.session.page.waitForTimeout(800)
      if(await otpPage.detectOtpFailure())throw new Error('OTP_REJECTED')
      if(!await otpPage.detectAuthenticatedTransition()){
        this.registry.update(jobId,'NEEDS_ATTENTION')
        await this.api.status(jobId,'NEEDS_ATTENTION','Authentication could not be confirmed')
        return {status:'NEEDS_ATTENTION',jobId,errorCode:'AUTH_STATE_UNCONFIRMED'}
      }
      this.registry.update(jobId,'AUTHENTICATED')
      await this.api.status(jobId,'AUTHENTICATED','Authentication confirmed')
      return {status:'AUTHENTICATED',jobId}
    }catch(error){
      const code=this.code(error)
      const result=this.otpFailureResult(jobId,code)
      if(result.status==='OTP_REJECTED')await this.registry.cleanup(jobId)
      else if(this.registry.has(jobId)){
        this.registry.update(jobId,result.status)
        await this.api.status(jobId,result.status,'OTP flow requires attention').catch(()=>undefined)
      }
      return result
    }
  }
  async awaitOtpLifecycle(jobId:string):Promise<StartJobResult>{
    const running=this.otpInFlight.get(jobId)
    if(running)return running
    const lifecycle=this.continueOtpFlow(jobId).finally(()=>this.otpInFlight.delete(jobId))
    this.otpInFlight.set(jobId,lifecycle)
    return lifecycle
  }
  async resumeJob(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('ACTIVE_JOB_NOT_FOUND');const login=new IvacLoginPage(active.session.page);if(await login.detectVerification()){await this.api.status(jobId,'VERIFICATION_REQUIRED','Verification still present');return}active.paused=false;this.registry.update(jobId,'OTP_PAGE_REACHED');await this.continueOtpFlow(jobId)}
  async pauseJob(jobId:string){const active=this.registry.get(jobId);if(!active)throw new Error('ACTIVE_JOB_NOT_FOUND');active.paused=true;this.registry.update(jobId,'PAUSED');await this.api.status(jobId,'PAUSED','Paused by operator')}
  async cancelJob(jobId:string){await this.registry.cleanup(jobId);await this.api.status(jobId,'CANCELLED','Cancelled by operator')}
  async uploadDocument(jobId: string) {
    const active = this.registry.get(jobId)
    if (!active?.session.page) throw new Error('SESSION_LOST')
    if (active.state !== 'AUTHENTICATED') throw new Error('JOB_NOT_AUTHENTICATED')

    const context: any = await this.api.context(jobId)
    const document = context.application.documents?.find((item: any) => item.mimeType === 'application/pdf')
    if (!document) throw new Error('DOCUMENT_MISSING')
    await validatePdf(document, Number(process.env.DOCUMENT_MAX_SIZE_MB ?? 10) * 1024 * 1024)

    const page = active.session.page
    const upload = new IvacFileUploadPage(page)
    try {
      await page.goto(this.ivacTarget.url('/appointment/file-upload'), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await upload.waitUntilReady()
      if (!await upload.validateCurrentApplication()) throw new Error('DOCUMENT_INPUT_NOT_FOUND')

      this.registry.update(jobId, 'UPLOADING_DOCUMENT')
      await this.api.status(jobId, 'UPLOADING_DOCUMENT', 'BGDR upload started')
      await retry(() => upload.uploadDocument(document.storedPath), error => error instanceof Error && /timeout|network/i.test(error.message), 2)
      await page.waitForTimeout(600)

      if (await upload.detectUploadFailure()) throw new Error('DOCUMENT_REJECTED')
      if (!await upload.detectUploadSuccess() || !await upload.detectConfirmationControl()) throw new Error('DOCUMENT_UPLOAD_TIMEOUT')

      this.registry.update(jobId, 'DOCUMENT_UPLOADED')
      await this.api.status(jobId, 'DOCUMENT_UPLOADED', 'BGDR upload completed')
    } catch (error) {
      const code = this.code(error)
      const safe = ['DOCUMENT_MISSING', 'DOCUMENT_INVALID', 'DOCUMENT_TOO_LARGE', 'DOCUMENT_INPUT_NOT_FOUND', 'DOCUMENT_UPLOAD_TIMEOUT', 'DOCUMENT_REJECTED', 'SESSION_LOST'].includes(code) ? code : 'PAGE_STRUCTURE_CHANGED'
      await this.api.failure(jobId, safe, 'BGDR upload could not continue safely')
      throw error
    }
  }
  async confirmInformation(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(active.state!=='DOCUMENT_UPLOADED')throw new Error('DOCUMENT_STATE_INVALID');const page=active.session.page;const upload=new IvacFileUploadPage(page);try{if(!page.url().includes('/appointment/file-upload'))throw new Error('PAGE_STRUCTURE_CHANGED');if(!await upload.detectUploadSuccess())throw new Error('DOCUMENT_STATE_INVALID');if(!await upload.detectApplicantSummary())throw new Error('APPLICATION_VALIDATION_FAILED');if(!await upload.detectConfirmationControl())throw new Error('CONFIRMATION_CONTROL_NOT_FOUND');if(!await upload.isConfirmationEnabled())throw new Error('CONFIRMATION_DISABLED');if(await upload.detectValidationError())throw new Error('APPLICATION_VALIDATION_FAILED');this.registry.update(jobId,'CONFIRMING_INFORMATION');await this.api.status(jobId,'CONFIRMING_INFORMATION','Applicant confirmation started');await retry(()=>upload.confirmInformation(),e=>e instanceof Error&&/timeout|navigation/i.test(e.message),2);await page.waitForTimeout(700);if(!await upload.detectMissionTransition())throw new Error('MISSION_TRANSITION_TIMEOUT');this.registry.update(jobId,'SELECTING_MISSION');await this.api.status(jobId,'SELECTING_MISSION','Mission page reached')}catch(error){await this.api.failure(jobId,this.code(error),'Applicant confirmation could not continue safely');throw error}}
  async selectMission(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');const context:any=await this.api.context(jobId);const mission=context.application.preference?.mission;if(!mission)throw new Error('MISSION_NOT_CONFIGURED');const page=active.session.page;const missionPage=new IvacMissionPage(page);try{if(!page.url().includes('/appointment/mission'))throw new Error('PAGE_STRUCTURE_CHANGED');await missionPage.waitUntilReady();if(!await missionPage.detectMissionControl())throw new Error('MISSION_CONTROL_NOT_FOUND');const options=await missionPage.getAvailableMissions();if(!options.some(x=>x.trim().toLowerCase()===mission.trim().toLowerCase()))throw new Error('MISSION_NOT_AVAILABLE');this.registry.update(jobId,'SELECTING_MISSION');await this.api.status(jobId,'SELECTING_MISSION','Mission selection started');await retry(()=>missionPage.selectMission(mission),e=>e instanceof Error&&/timeout|navigation/i.test(e.message),2);if(await missionPage.detectValidationError()||!await missionPage.verifyMissionSelected(mission))throw new Error('MISSION_SELECTION_FAILED');this.registry.update(jobId,'MISSION_SELECTED');await this.api.status(jobId,'SELECTING_MISSION','Mission selected')}catch(error){await this.api.failure(jobId,this.code(error),'Mission selection could not continue safely');throw error}}
  async selectCentre(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(active.state!=='MISSION_SELECTED')throw new Error('MISSION_STATE_LOST');const context:any=await this.api.context(jobId);const preference=context.application.preference;if(!preference?.ivacCentre)throw new Error('CENTRE_NOT_CONFIGURED');const page=active.session.page,missionPage=new IvacMissionPage(page);try{if(!page.url().includes('/appointment/mission'))throw new Error('PAGE_STRUCTURE_CHANGED');if(!await missionPage.verifyMissionSelected(preference.mission))throw new Error('MISSION_STATE_LOST');await retry(async()=>{if(!await missionPage.detectCentreControl())throw new Error('CENTRE_CONTROL_NOT_FOUND')},e=>e instanceof Error&&/CENTRE_CONTROL|timeout/i.test(e.message),3);const centres=await missionPage.getAvailableCentres();if(!centres.some(x=>x.trim().toLowerCase()===preference.ivacCentre.trim().toLowerCase()))throw new Error('CENTRE_NOT_AVAILABLE');this.registry.update(jobId,'SELECTING_CENTRE');await this.api.status(jobId,'SELECTING_CENTRE','Centre selection started');await missionPage.selectCentre(preference.ivacCentre);if(await missionPage.detectValidationError()||!await missionPage.verifyCentreSelected(preference.ivacCentre))throw new Error('CENTRE_SELECTION_FAILED');this.registry.update(jobId,'CENTRE_SELECTED');await this.api.status(jobId,'SELECTING_CENTRE','Centre selected');if(!await missionPage.detectMissionCentreConfirmControl())throw new Error('CONFIRM_CONTROL_NOT_FOUND');const confirm=this.registry.update(jobId,'CONFIRMING_MISSION_CENTRE');await this.api.status(jobId,'SELECTING_CENTRE','Mission and Centre confirmation started');await retry(()=>missionPage.confirmMissionCentre(),e=>e instanceof Error&&/timeout|navigation/i.test(e.message),2);await page.waitForTimeout(700);if(!await missionPage.detectSlotTransition())throw new Error('SLOT_TRANSITION_TIMEOUT');this.registry.update(jobId,'SLOT_PAGE_REACHED');await this.api.status(jobId,'WAITING_FOR_SLOT','Slot page reached')}catch(error){await this.api.failure(jobId,this.code(error),'Centre selection could not continue safely');throw error}}
  async readSlotState(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(!active.session.page.url().includes('/appointment/time-slot'))throw new Error('PAGE_STRUCTURE_CHANGED');const slot=new IvacTimeSlotPage(active.session.page);try{await slot.waitUntilReady();if(!await slot.detectCalendar())throw new Error('CALENDAR_NOT_FOUND');this.registry.update(jobId,'READING_SLOT_STATE');await this.api.status(jobId,'WAITING_FOR_SLOT','Reading slot state');const snapshot=await slot.snapshot();this.registry.update(jobId,snapshot.availableDates.length?'AVAILABLE_DATES_DETECTED':'NO_AVAILABLE_DATE');await this.api.status(jobId,'WAITING_FOR_SLOT',snapshot.availableDates.length?'Available dates detected':'No available date');return snapshot}catch(error){await this.api.failure(jobId,this.code(error),'Slot calendar could not be read safely');throw error}}
  async matchDatePreferences(jobId:string,availableDates:string[]){const active=this.registry.get(jobId);if(!active)throw new Error('SESSION_LOST');const context:any=await this.api.context(jobId),p=context.application.preference;const result=new DatePreferenceMatcher({preferredDate:p?.preferredDate,allowedDateFrom:p?.allowedDateFrom,allowedDateTo:p?.allowedDateTo,allowAlternativeDates:!!p?.allowAlternativeDates}).classifyAvailableDates(availableDates);const candidate=(result.classification==='PREFERRED_AVAILABLE'||result.classification==='ALTERNATIVE_AVAILABLE')?result.bestCandidate:null;this.registry.setSlotCandidate(jobId,{classification:result.classification,allowedDates:result.allowedDates,bestCandidate:candidate,checkedAt:new Date().toISOString()});this.registry.update(jobId,result.classification);await this.api.status(jobId,'WAITING_FOR_SLOT',result.classification.replaceAll('_',' ').toLowerCase());return result}
  async selectStoredCandidateDate(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');const candidate=this.registry.getBestCandidateDate(jobId);if(!candidate)throw new Error('DATE_CANDIDATE_MISSING');if(!active.session.page.url().includes('/appointment/time-slot'))throw new Error('PAGE_STRUCTURE_CHANGED');const slot=new IvacTimeSlotPage(active.session.page);try{if(!await slot.isDateStillAvailable(candidate))throw new Error('SELECTED_DATE_NO_LONGER_AVAILABLE');this.registry.update(jobId,'SELECTING_DATE');await this.api.status(jobId,'SELECTING_DATE','Date selection started');await slot.selectDate(candidate);if(!await slot.verifyDateSelected(candidate))throw new Error('DATE_SELECTION_UNCONFIRMED');this.registry.update(jobId,'DATE_SELECTED');await this.api.status(jobId,'DATE_SELECTED','Appointment date selected')}catch(error){await this.api.failure(jobId,this.code(error),'Appointment date selection failed');throw error}}
  async continueBooking(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(active.state!=='DATE_SELECTED')throw new Error('SELECTED_DATE_STATE_LOST');const candidate=this.registry.getBestCandidateDate(jobId);if(!candidate)throw new Error('SELECTED_DATE_STATE_LOST');const page=active.session.page,slot=new IvacTimeSlotPage(page);try{if(page.url().includes('/appointment/continue-payment')&&await slot.detectContinuePaymentTransition()){this.registry.update(jobId,'CONTINUE_PAYMENT_PAGE_REACHED');return}if(!page.url().includes('/appointment/time-slot'))throw new Error('PAGE_STRUCTURE_CHANGED');if(!await slot.verifyDateSelected(candidate))throw new Error('SELECTED_DATE_STATE_LOST');if(!await slot.detectContinueBookingControl())throw new Error('CONTINUE_BOOKING_CONTROL_NOT_FOUND');if(!await slot.isContinueBookingEnabled())throw new Error('CONTINUE_BOOKING_DISABLED');this.registry.update(jobId,'CONTINUING_BOOKING');await this.api.status(jobId,'CONTINUING_BOOKING','Continue Booking started');await slot.continueBooking();await this.api.status(jobId,'CONTINUING_BOOKING','Continue Booking submitted');await page.waitForTimeout(800);if(!await slot.detectContinuePaymentTransition())throw new Error('CONTINUE_PAYMENT_TRANSITION_TIMEOUT');this.registry.update(jobId,'CONTINUE_PAYMENT_PAGE_REACHED');await this.api.status(jobId,'PREPARING_PAYMENT','Payment preparation page reached')}catch(error){await this.api.failure(jobId,this.code(error),'Continue Booking could not continue safely');throw error}}
  async detectPaymentHandoff(jobId:string){const active=this.registry.get(jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(!active.session.page.url().includes('/appointment/continue-payment'))throw new Error('PAYMENT_PAGE_INVALID');const payment=new IvacContinuePaymentPage(active.session.page);try{await payment.waitUntilReady();this.registry.update(jobId,'PREPARING_PAYMENT');await this.api.status(jobId,'PREPARING_PAYMENT','Preparing payment handoff');if(!await payment.detectPaymentSummary())throw new Error('PAYMENT_SUMMARY_NOT_FOUND');if(!await payment.detectPaymentAction())throw new Error('PAYMENT_ACTION_NOT_FOUND');const handoff=await payment.getPaymentHandoffInfo();if(!handoff.handoffReady){this.registry.update(jobId,'PAYMENT_HANDOFF_NOT_READY');await this.api.status(jobId,'PREPARING_PAYMENT','Payment handoff not ready');return handoff}this.registry.update(jobId,'PAYMENT_READY');await this.api.status(jobId,'PAYMENT_READY','Payment ready for manual operator handoff');return handoff}catch(error){await this.api.failure(jobId,this.code(error),'Payment handoff could not be prepared safely');throw error}}
  async cleanupStale(){const stale=this.registry.stale(Number(process.env.SESSION_TTL_MS??900000));for(const job of stale){await this.api.status(job.jobId,'NEEDS_ATTENTION','Session activity expired; manual recovery required').catch(()=>undefined);await this.registry.cleanup(job.jobId)}return this.registry.entries().length}
  async runSideEffect<T>(jobId:string,stage:string,work:()=>Promise<T>){return this.effects.once(`${jobId}:${stage}`,work)}
  async shutdown(){await this.registry.shutdown()}
  async executeCommand(command:WorkerCommand){const active=this.registry.get(command.jobId);if(!active?.session.page)throw new Error('SESSION_LOST');if(command.commandType==='FOCUS_PAYMENT_PAGE'){if(active.state!=='PAYMENT_READY')throw new Error('COMMAND_NOT_ALLOWED_FOR_STATE');if(active.session.page.isClosed())throw new Error('PAGE_CLOSED');await active.session.page.bringToFront();await this.api.status(command.jobId,'PAYMENT_READY','Payment page focused for operator');return}if(command.commandType==='MARK_PAYMENT_COMPLETED'){if(active.state!=='PAYMENT_READY')throw new Error('COMMAND_NOT_ALLOWED_FOR_STATE');await this.api.status(command.jobId,'COMPLETED','Manual payment completed by operator');this.registry.update(command.jobId,'COMPLETED');return}if(command.commandType==='MARK_PAYMENT_FAILED'){if(active.state!=='PAYMENT_READY')throw new Error('COMMAND_NOT_ALLOWED_FOR_STATE');await this.api.failure(command.jobId,'PAYMENT_FAILED_MANUAL','Manual payment marked failed by operator');this.registry.update(command.jobId,'PAYMENT_FAILED_MANUAL');return}if(command.commandType==='CLEANUP_JOB_SESSION'){await this.registry.cleanup(command.jobId);return}throw new Error('COMMAND_NOT_ALLOWED_FOR_STATE')}
  private resultForState(jobId:string,state:string):StartJobResult{
    if(state==='AUTHENTICATED'||state==='VERIFICATION_REQUIRED'||state==='OTP_TIMEOUT'||state==='OTP_REJECTED'||state==='OTP_EXPIRED'||state==='OTP_MATCH_AMBIGUOUS'||state==='SESSION_LOST')return {status:state,jobId}
    if(state==='NEEDS_ATTENTION')return {status:'NEEDS_ATTENTION',jobId}
    return {status:'FAILED',jobId,errorCode:state}
  }
  private otpFailureResult(jobId:string,code:string):StartJobResult{
    if(code==='ACTIVE_JOB_NOT_FOUND'||code==='SESSION_LOST'||code==='PAGE_CLOSED')return {status:'SESSION_LOST',jobId}
    if(code==='OTP_REJECTED')return {status:'OTP_REJECTED',jobId}
    if(code==='OTP_EXPIRED')return {status:'OTP_EXPIRED',jobId}
    if(code==='OTP_MATCH_AMBIGUOUS')return {status:'OTP_MATCH_AMBIGUOUS',jobId}
    if(code==='OTP_TIMEOUT'||code==='API_404')return {status:'OTP_TIMEOUT',jobId}
    if(code==='AUTH_STATE_UNCONFIRMED'||code==='PAGE_STRUCTURE_CHANGED')return {status:'NEEDS_ATTENTION',jobId,errorCode:code}
    return {status:'FAILED',jobId,errorCode:code}
  }
  private code(error:unknown){const body=typeof error==='object'&&error&&'body'in error?(error as any).body:undefined;return body?.error??(error instanceof Error?error.message:'TEMPORARY_SERVER_ERROR')}
}
