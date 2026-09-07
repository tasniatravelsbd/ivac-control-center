export type Application = { id: string; fullName: string; webfileNumber: string; email: string; primaryPhone: string; otpReceiverPhone: string; notes?: string | null; status: 'DRAFT'|'ACTIVE'|'ARCHIVED'; automationStatus: string; createdAt: string; updatedAt: string; preference?: { mission: string; ivacCentre: string; visaType: string } | null; documents: { id: string; slot: number; originalFilename: string; mimeType: string; size: number; uploadedAt: string }[]; events?: { id: string; type: string; message: string; createdAt: string; actor: { name: string } }[] }
const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'
export const OPERATOR_SESSION_KEY = 'ivac_access_token'
export const OPERATOR_SESSION_EXPIRED_EVENT = 'ivac:session-expired'

const token = () => localStorage.getItem(OPERATOR_SESSION_KEY) ?? import.meta.env.VITE_API_TOKEN

async function request<T>(path: string, init: RequestInit = {}, expireSessionOn401 = true): Promise<T> {
  const currentToken = token()
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' }))
    if (response.status === 401 && expireSessionOn401) {
      localStorage.removeItem(OPERATOR_SESSION_KEY)
      window.dispatchEvent(new Event(OPERATOR_SESSION_EXPIRED_EVENT))
    }
    throw new Error(body.error)
  }
  return response.status === 204 ? undefined as T : response.json()
}
export type Sms = { id:string; receivedAt:string; receiverNumber:string; senderNumber:string; status:string; detectedOtp:string|null; otpStatus:'AVAILABLE'|'CONSUMED'|'EXPIRED'|'AMBIGUOUS'|null; jobId:string|null; collector:{deviceName:string}; matchedApplication?:{id:string;fullName:string;webfileNumber:string}|null }
export type Collector = { id:string; deviceName:string; phoneNumber:string; status:'PENDING'|'ONLINE'|'DEGRADED'|'OFFLINE'|'DISABLED'; registrationStatus:'PENDING_APPROVAL'|'CREDENTIAL_READY'|'CONNECTED'; matchingApplicationCount:number; waitingOtpJobCount:number; matchedApplication:{id:string;fullName:string;webfileNumber:string}|null; matchedJob:{id:string;state:string}|null; lastHeartbeatAt:string|null; lastSmsReceivedAt:string|null }
export type OperatorSession = { token: string; user: { id: string; name: string; email: string } }
export type AutomationJob = { id: string; state: string; retryCount: number; lastErrorCode: string | null; createdAt: string; updatedAt: string; application: { id: string; fullName: string; webfileNumber: string; maskedPhone: string }; worker: { id: string; workerName: string; lastHeartbeatAt: string | null; status: string } | null; currentStage: string; elapsedMs: number; lastSuccessfulStage: string | null; otpStatus: 'WAITING'|'AVAILABLE'|'CLAIMED'|'CONSUMED'|'NOT_REQUIRED'; slotStatus: 'WAITING'|'AVAILABLE'|'UNAVAILABLE'|'SELECTED'|'UNKNOWN'; paymentStatus: 'NOT_READY'|'PREPARING'|'READY'; latestSafeError: string | null; latestEvent: { state: string; event: string; errorCode?: string; timestamp: string } | null; paymentHandoff: { mode: 'INDEPENDENT' | 'SESSION_BOUND'; provider: string | null; destinationHost: string | null; destinationUrl: string | null; reference: string | null; generatedAt: string } | null }
export type OperationsSummary = { backend: 'ONLINE'; database: 'CONNECTED'; workers: { online: number; total: number }; collectors: { online: number; total: number }; applications: { ready: number; active: number }; jobs: { state: string; count: number }[] }
export type AutomationReadiness = { ready: boolean; checks: { key: string; label: string; required: boolean; ok: boolean }[]; smsCollector: { status: 'ONLINE'|'OFFLINE'; onlineCount: number; warning: string | null } }
export const api = { login: (body: { email: string; password: string }) => request<OperatorSession>('/auth/login', { method: 'POST', body: JSON.stringify(body) }, false), list: (search = '') => request<{data: Application[]}>(`/applications?search=${encodeURIComponent(search)}`), get: (id: string) => request<Application>(`/applications/${id}`), create: (body: unknown) => request<Application>('/applications', { method: 'POST', body: JSON.stringify(body) }), update: (id: string, body: unknown) => request<Application>(`/applications/${id}`, { method: 'PUT', body: JSON.stringify(body) }), upload: (id: string, document: File, slot = 1) => { const body = new FormData(); body.append('document', document); body.append('slot', String(slot)); return request(`/applications/${id}/document`, { method:'POST', body }) }, deleteDocument: (id: string, slot: number) => request<void>(`/applications/${id}/document?slot=${slot}`, { method: 'DELETE' }), documentUrl: (id: string, slot = 1) => `${base}/applications/${id}/document?slot=${slot}`, sms: () => request<{data: Sms[]}>('/sms'), collectors: () => request<{data:Collector[]}>('/collectors'), approveCollectorRegistration: (id:string) => request<{collector:Collector}>(`/collectors/${id}/approve-registration`, { method:'POST' }), revokeCollector: (id:string) => request<void>(`/collectors/${id}`, { method:'DELETE' }), setCollectorStatus: (id:string, action:'enable'|'disable') => request<{collector:Collector}>(`/collectors/${id}/status`, { method:'PATCH', body:JSON.stringify({ action }) }), assignSms: (id:string, applicationId:string) => request(`/sms/${id}/assign`, { method:'PUT', body:JSON.stringify({ applicationId }) }), readiness:(applicationId:string)=>request<AutomationReadiness>(`/applications/${applicationId}/automation-readiness`), createAutomationJob:(applicationId:string)=>request<{id:string;applicationId:string;state:string;createdAt:string;updatedAt:string}>(`/applications/${applicationId}/automation-jobs`,{method:'POST'}), jobs:()=>request<{data:AutomationJob[]}>('/jobs'), jobTimeline:(jobId:string)=>request<{data:{state:string;event:string;timestamp:string}[]}>(`/jobs/${jobId}/timeline`), operationsSummary:()=>request<OperationsSummary>('/operations/summary'), pauseJob:(jobId:string)=>request<any>(`/jobs/${jobId}/pause`,{method:'POST'}), resumeJob:(jobId:string)=>request<any>(`/jobs/${jobId}/resume`,{method:'POST'}), cancelJob:(jobId:string)=>request<any>(`/jobs/${jobId}/cancel`,{method:'POST'}), command:(jobId:string,type:string)=>request<any>(`/jobs/${jobId}/commands/${type}`,{method:'POST'}), commandStatus:(jobId:string,id:string)=>request<any>(`/jobs/${jobId}/commands/${id}`) }
