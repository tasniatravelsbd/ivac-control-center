import type { StartJobResult, JobCoordinator } from './job-coordinator.js'
export type WorkflowResult=StartJobResult|{status:'PAYMENT_READY';jobId:string}|{status:'DOCUMENT_REJECTED';jobId:string}|{status:'MISSION_NOT_AVAILABLE';jobId:string}|{status:'CENTRE_NOT_AVAILABLE';jobId:string}|{status:'NO_AVAILABLE_DATE';jobId:string}|{status:'SELECTED_DATE_NO_LONGER_AVAILABLE';jobId:string}|{status:'CONTINUE_PAYMENT_TRANSITION_TIMEOUT';jobId:string}
/** Canonical composition layer; stages remain implemented by the production coordinator. */
export class WorkflowOrchestrator {
  constructor(private coordinator:JobCoordinator) {}
  async runJobWorkflow(jobId:string):Promise<WorkflowResult>{
    const startResult=await this.coordinator.startJob(jobId)
    if(startResult.status!=='AUTHENTICATED')return startResult
    try{await this.coordinator.uploadDocument(jobId);await this.coordinator.confirmInformation(jobId);await this.coordinator.selectMission(jobId);await this.coordinator.selectCentre(jobId);const snapshot=await this.coordinator.readSlotState(jobId);const match=await this.coordinator.matchDatePreferences(jobId,snapshot.availableDates);if(!match.bestCandidate)return {status:'NO_AVAILABLE_DATE',jobId};await this.coordinator.selectStoredCandidateDate(jobId);await this.coordinator.continueBooking(jobId);await this.coordinator.detectPaymentHandoff(jobId);return {status:'PAYMENT_READY',jobId}}catch(error){return this.mapError(jobId,error)}
  }
  private mapError(jobId:string,error:unknown):WorkflowResult{const code=error instanceof Error?error.message:'TEMPORARY_SERVER_ERROR';if(['DOCUMENT_REJECTED','MISSION_NOT_AVAILABLE','CENTRE_NOT_AVAILABLE','SELECTED_DATE_NO_LONGER_AVAILABLE','CONTINUE_PAYMENT_TRANSITION_TIMEOUT','SESSION_LOST'].includes(code))return {status:code as any,jobId};if(code==='NO_AVAILABLE_DATE'||code==='NO_ALLOWED_DATE')return {status:'NO_AVAILABLE_DATE',jobId};if(code==='PAGE_STRUCTURE_CHANGED'||code==='AUTH_STATE_UNCONFIRMED')return {status:'NEEDS_ATTENTION',jobId,errorCode:code};return {status:'FAILED',jobId,errorCode:code}}
}
