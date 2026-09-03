import type { BrowserSession } from '../browser/session.js'

export type ActiveJob = { jobId:string; applicationId:string; session:BrowserSession; state:string; createdAt:number; updatedAt:number; paused:boolean; cancelled:boolean; slotClassification?:string; allowedDates?:string[]; bestCandidateDate?:string|null; slotCheckedAt?:string }
export class ActiveJobRegistry {
  private jobs = new Map<string, ActiveJob>()
  register(job: Omit<ActiveJob,'createdAt'|'updatedAt'>) { if(this.jobs.has(job.jobId)) throw new Error('JOB_ALREADY_ACTIVE'); const now=Date.now(); const entry={...job,createdAt:now,updatedAt:now}; this.jobs.set(job.jobId,entry); return entry }
  get(id:string){return this.jobs.get(id)} has(id:string){return this.jobs.has(id)}
  update(id:string,state:string){const entry=this.jobs.get(id);if(!entry)throw new Error('ACTIVE_JOB_NOT_FOUND');entry.state=state;entry.updatedAt=Date.now();return entry}
  setSlotCandidate(id:string,input:{classification:string;allowedDates:string[];bestCandidate:string|null;checkedAt:string}){const entry=this.jobs.get(id);if(!entry)throw new Error('ACTIVE_JOB_NOT_FOUND');if(input.bestCandidate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(input.bestCandidate))throw new Error('INVALID_DATE_CANDIDATE');entry.slotClassification=input.classification;entry.allowedDates=[...input.allowedDates];entry.bestCandidateDate=input.bestCandidate;entry.slotCheckedAt=input.checkedAt;entry.updatedAt=Date.now();return entry}
  getBestCandidateDate(id:string){return this.jobs.get(id)?.bestCandidateDate??null}
  async cleanup(id:string){const entry=this.jobs.get(id);if(!entry)return;this.jobs.delete(id);await entry.session.cleanup()}
  async cleanupStale(ttlMs:number){const now=Date.now();await Promise.all([...this.jobs.values()].filter(x=>now-x.updatedAt>ttlMs).map(x=>this.cleanup(x.jobId)));return this.jobs.size}
  stale(ttlMs:number){const now=Date.now();return [...this.jobs.values()].filter(x=>now-x.updatedAt>ttlMs)}
  async shutdown(){await Promise.all([...this.jobs.keys()].map(id=>this.cleanup(id)))}
  entries(){return [...this.jobs.values()]}
}
