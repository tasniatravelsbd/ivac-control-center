import { useEffect, useMemo, useState } from 'react'
import { ManualValidation } from './manual-validation'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowRight, Bell, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Command, FileText, LayoutDashboard, Menu, MoreHorizontal, Moon, Plus, Radio,
  Search, Settings, ShieldAlert, Sun, Upload, Users, X, Zap
} from 'lucide-react'
import './styles.css'
import { api, OPERATOR_SESSION_EXPIRED_EVENT, OPERATOR_SESSION_KEY, type Application, type AutomationJob } from './api'
import { IVAC_MISSION_OPTIONS, IVAC_VISA_TYPE_OPTIONS, ivacCentresForMission } from './data/ivac-options'

type Page = 'Dashboard' | 'Live Operations' | 'Applications' | 'Create Application' | 'Application Detail' | 'SMS & OTP' | 'Documents' | 'Payments' | 'Activity' | 'Analytics' | 'Team' | 'Settings' | 'Manual Validation'
type Theme = 'light' | 'dark' | 'system'

const navigation: { name: Page; icon: typeof LayoutDashboard; section?: string }[] = [
  { name: 'Dashboard', icon: LayoutDashboard, section: 'WORKSPACE' },
  { name: 'Live Operations', icon: Radio },
  { name: 'Manual Validation', icon: CircleHelp },
  { name: 'Applications', icon: FileText },
  { name: 'SMS & OTP', icon: Bell },
  { name: 'Documents', icon: Upload, section: 'MANAGEMENT' },
  { name: 'Payments', icon: CalendarDays },
  { name: 'Activity', icon: Activity },
  { name: 'Analytics', icon: Zap },
  { name: 'Team', icon: Users, section: 'ADMIN' },
  { name: 'Settings', icon: Settings }
]

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span> }
function Avatar({ initials }: { initials: string }) { return <span className="avatar">{initials}</span> }
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem(OPERATOR_SESSION_KEY)))
  const [sessionMessage, setSessionMessage] = useState('')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ivac-theme') as Theme) || 'system')
  const isDark = useMemo(() => theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches), [theme])
  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); localStorage.setItem('ivac-theme', theme) }, [theme, isDark])
  useEffect(() => {
    const expireSession = () => {
      setAuthenticated(false)
      setSessionMessage('Your session expired. Please sign in again.')
    }
    window.addEventListener(OPERATOR_SESSION_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(OPERATOR_SESSION_EXPIRED_EVENT, expireSession)
  }, [])
  if (!authenticated) return <OperatorLogin message={sessionMessage} onAuthenticated={() => { setSessionMessage(''); setAuthenticated(true) }}/>
  return <div className="operations-app">
    <header className="operations-topbar"><div className="brand"><span className="brand-mark"><span /></span><span className="brand-name">IVAC <b>Control</b></span></div><div className="operations-topbar-copy"><b>Operations Center</b><span>Authenticated operator session</span></div><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} title={`Theme: ${theme}`}>{theme === 'dark' ? <Moon size={17}/> : theme === 'light' ? <Sun size={17}/> : <CircleHelp size={17}/>}</button><Avatar initials="OP"/></header>
    <main className="page-wrap"><OperationsCenter/></main>
  </div>
}

function normalizedPhone(value: string) {
  const digits = value.replace(/[\s().-]/g, '').replace(/^\+/, '')
  if (/^8801\d{9}$/.test(digits)) return `+${digits}`
  if (/^01\d{9}$/.test(digits)) return `+880${digits.slice(1)}`
  if (/^1\d{9}$/.test(digits)) return `+880${digits}`
  return value.trim()
}

function OperationsCenter() {
  const [applications, setApplications] = useState<Application[]>([])
  const [jobs, setJobs] = useState<AutomationJob[]>([])
  const [collectors, setCollectors] = useState<import('./api').Collector[]>([])
  const [summary, setSummary] = useState<import('./api').OperationsSummary | null>(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showCollectors, setShowCollectors] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [applicationResult, jobResult, collectorResult, summaryResult] = await Promise.all([
        api.list(), api.jobs(), api.collectors(), api.operationsSummary(),
      ])
      setApplications(applicationResult.data)
      setJobs(jobResult.data)
      setCollectors(collectorResult.data)
      setSummary(summaryResult)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load operations data')
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectedApplication = applications.find(application => application.id === selectedApplicationId) ?? null
  const selectedJob = selectedApplication ? jobs.find(job => job.application.id === selectedApplication.id) ?? null : null
  const runAction = async (application: Application, action: 'start' | 'pause' | 'resume' | 'cancel') => {
    setNotice('')
    try {
      const job = jobs.find(item => item.application.id === application.id)
      if (action === 'start') {
        const created = await api.createAutomationJob(application.id)
        setNotice(`Automation job ${created.id} queued.`)
      } else if (!job) {
        throw new Error('No active job is available for this action.')
      } else if (action === 'pause') {
        await api.pauseJob(job.id)
        setNotice('Pause requested.')
      } else if (action === 'resume') {
        await api.resumeJob(job.id)
        setNotice('Resume / retry requested.')
      } else {
        await api.cancelJob(job.id)
        setNotice('Cancel requested.')
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action could not be completed')
    }
  }

  return <>
    <div className="operations-heading"><div><p className="eyebrow">SINGLE-PAGE OPERATIONS</p><h1>Appointment control center</h1><p className="muted">Applications, worker jobs, SMS collectors, and manual payment handoff in one protected workspace.</p></div><div className="operations-heading-actions"><button className="secondary" onClick={() => setShowCollectors(true)}><Bell size={16}/> SMS collectors</button><button className="primary" onClick={() => setShowCreate(true)}><Plus size={16}/> Add application</button><button className="theme-toggle" onClick={() => setShowSettings(true)} aria-label="Settings"><Settings size={16}/></button></div></div>
    <SystemStatusBar summary={summary} collectors={collectors} />
    {(notice || error) && <p className="safety-note">{error || notice}</p>}
    <Card className="operations-table-card"><div className="card-head"><div><h2>Applications & jobs</h2><p>Only real backend records are shown. Select a row to inspect the live job detail below.</p></div><span className="muted">{applications.length} application{applications.length === 1 ? '' : 's'}</span></div><OperationsTable applications={applications} jobs={jobs} collectors={collectors} selectedId={selectedApplicationId} onSelect={setSelectedApplicationId} onAction={runAction} onReload={load}/></Card>
    {selectedApplication && <LiveJobDetail application={selectedApplication} job={selectedJob} onReload={load}/>}
    {showCreate && <Modal title="Add application" className="add-application-modal" onClose={() => setShowCreate(false)}><CreateApplication onNavigate={() => setShowCreate(false)} onCreated={(id) => { setSelectedApplicationId(id); setShowCreate(false); void load() }}/></Modal>}
    {showCollectors && <CollectorDrawer collectors={collectors} onClose={() => setShowCollectors(false)} onReload={load}/>}
    {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)}/>}
  </>
}

function SystemStatusBar({ summary, collectors }: { summary: import('./api').OperationsSummary | null; collectors: import('./api').Collector[] }) {
  const entries: [string, string, string][] = [
    ['Backend', summary?.backend === 'ONLINE' ? 'ONLINE' : 'UNAVAILABLE', summary?.backend === 'ONLINE' ? 'mint' : 'rose'],
    ['MySQL / API', summary?.database === 'CONNECTED' ? 'CONNECTED' : 'UNAVAILABLE', summary?.database === 'CONNECTED' ? 'mint' : 'rose'],
    ['Worker', summary ? `${summary.workers.online}/${summary.workers.total} ONLINE` : 'UNAVAILABLE', summary && summary.workers.online > 0 ? 'mint' : 'amber'],
    ['SMS collector', summary ? `${summary.collectors.online}/${summary.collectors.total} ONLINE` : 'UNAVAILABLE', collectors.some(collector => collector.status === 'ONLINE') ? 'mint' : 'amber'],
  ]
  return <section className="system-status-bar">{entries.map(([label, value, tone]) => <div key={label}><span className={`status-ring ${tone}`}/><span>{label}</span><b>{value}</b></div>)}</section>
}

function OperationsTable({ applications, jobs, collectors, selectedId, onSelect, onAction, onReload }: { applications: Application[]; jobs: AutomationJob[]; collectors: import('./api').Collector[]; selectedId: string | null; onSelect: (id: string) => void; onAction: (application: Application, action: 'start' | 'pause' | 'resume' | 'cancel') => Promise<void>; onReload: () => Promise<void> }) {
  const collectorFor = (application: Application) => collectors.find(collector => normalizedPhone(collector.phoneNumber) === normalizedPhone(application.otpReceiverPhone))
  return <div className="table-wrap"><table className="operations-table"><thead><tr><th>APPLICANT</th><th>PHONE</th><th>BGDR</th><th>SMS COLLECTOR</th><th>JOB STATE</th><th>LAST UPDATE</th><th>ACTION</th></tr></thead><tbody>{applications.map(application => {
    const job = jobs.find(item => item.application.id === application.id)
    const collector = collectorFor(application)
    const hasBgdr = application.documents.some(document => document.slot === 1 && document.mimeType === 'application/pdf')
    const canPause = !!job && ['WAITING_FOR_OTP', 'WAITING_FOR_SLOT', 'VERIFICATION_REQUIRED'].includes(job.state)
    const canResume = !!job && ['PAUSED', 'VERIFICATION_REQUIRED', 'WAITING_FOR_SLOT'].includes(job.state)
    return <tr className={selectedId === application.id ? 'selected-row' : ''} key={application.id} onClick={() => onSelect(application.id)}><td><div className="table-person"><Avatar initials={application.fullName.split(' ').map(part => part[0]).slice(0, 2).join('')}/><span><b>{application.fullName}</b><small>{application.webfileNumber || 'No webfile'}</small></span></div></td><td>{application.primaryPhone}</td><td><Badge tone={hasBgdr ? 'mint' : 'amber'}>{hasBgdr ? 'READY' : 'MISSING'}</Badge></td><td><Badge tone={collector?.status === 'ONLINE' ? 'mint' : collector ? 'amber' : 'slate'}>{collector?.status ?? 'NOT PAIRED'}</Badge></td><td><Badge tone={job ? jobTone(job.state) : 'slate'}>{job?.state ?? 'NO JOB'}</Badge></td><td>{new Date(job?.updatedAt ?? application.updatedAt).toLocaleString()}</td><td onClick={event => event.stopPropagation()}><div className="row-actions">{!job && <button className="primary" onClick={() => void onAction(application, 'start')}>START</button>}<button className="quiet" onClick={() => onSelect(application.id)}>VIEW</button>{canPause && <button className="quiet" onClick={() => void onAction(application, 'pause')}>PAUSE</button>}{canResume && <button className="quiet" onClick={() => void onAction(application, 'resume')}>RETRY</button>}{job && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state) && <button className="quiet danger" onClick={() => void onAction(application, 'cancel')}>CANCEL</button>}{job?.state === 'PAYMENT_READY' && <OpenPaymentButton job={job} onComplete={() => void onReload()}/>}</div></td></tr>
  })}</tbody></table>{applications.length === 0 && <p className="muted operations-empty">No applications yet. Add an application to begin local operations.</p>}</div>
}

function LiveJobDetail({ application, job, onReload }: { application: Application; job: AutomationJob | null; onReload: () => Promise<void> }) {
  const [timeline, setTimeline] = useState<{ state: string; event: string; timestamp: string }[]>([])
  useEffect(() => {
    if (!job) { setTimeline([]); return }
    api.jobTimeline(job.id).then(result => setTimeline(result.data)).catch(() => setTimeline([]))
  }, [job?.id])
  const stages = ['LOGIN', 'OTP', 'BGDR', 'MISSION', 'CENTRE', 'SLOT', 'PAYMENT']
  const terminal = job?.state === 'PAYMENT_READY'
  return <section className="live-job-detail"><div className="section-label"><span>LIVE JOB DETAIL</span><b>{application.fullName}</b>{job && <Badge tone={jobTone(job.state)}>{job.state}</Badge>}</div><Card><div className="stage-strip">{stages.map((stage, index) => <div key={stage} className={job ? (job.lastSuccessfulStage === stage || job.currentStage.includes(stage) || (terminal && stage === 'PAYMENT') ? 'active' : '') : ''}><span>{index + 1}</span><b>{stage}</b><small>{job?.currentStage.includes(stage) ? job.currentStage : job?.lastSuccessfulStage === stage ? 'Complete' : 'Waiting'}</small></div>)}</div><div className="live-detail-grid"><div><h2>Current status</h2>{job ? <dl><div><dt>Worker</dt><dd>{job.worker?.workerName ?? 'Waiting for worker'}</dd></div><div><dt>OTP</dt><dd>{job.otpStatus}</dd></div><div><dt>Slot</dt><dd>{job.slotStatus}</dd></div><div><dt>Payment</dt><dd>{job.paymentStatus}</dd></div><div><dt>Last safe error</dt><dd>{job.latestSafeError ?? '—'}</dd></div></dl> : <p className="muted">No automation job has been created for this application.</p>}{job?.state === 'PAYMENT_READY' && <OpenPaymentButton job={job} onComplete={() => void onReload()}/>}</div><div><h2>Event timeline</h2>{timeline.length ? <div className="timeline">{timeline.slice(-8).reverse().map((event, index) => <Timeline key={`${event.timestamp}:${event.event}`} title={event.event} text={event.state} time={new Date(event.timestamp).toLocaleString()} tone={index === 0 ? 'violet' : 'slate'}/>)}</div> : <p className="muted">No job events yet.</p>}</div></div></Card></section>
}

function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) { return <div className="ops-overlay" role="dialog" aria-modal="true" aria-label={title}><div className={`ops-modal ${className}`}><div className="ops-modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>{children}</div></div> }

function CollectorDrawer({ collectors, onClose, onReload }: { collectors: import('./api').Collector[]; onClose: () => void; onReload: () => Promise<void> }) {
  const [error, setError] = useState('')
  const approve = async (collector: import('./api').Collector) => { try { await api.approveCollectorRegistration(collector.id); await onReload() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to approve device') } }
  const status = async (collector: import('./api').Collector) => { try { await api.setCollectorStatus(collector.id, collector.status === 'DISABLED' ? 'enable' : 'disable'); await onReload() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change collector status') } }
  const revoke = async (collector: import('./api').Collector) => { if (!window.confirm(`Revoke ${collector.deviceName}?`)) return; try { await api.revokeCollector(collector.id); await onReload() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to revoke collector') } }
  return <div className="ops-overlay"><aside className="collector-drawer"><div className="ops-modal-head"><div><p className="eyebrow">SMS COLLECTORS</p><h2>Connected devices</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><p className="muted">Collector keys and SMS contents are never shown here.</p>{error && <p className="safety-note">{error}</p>}{collectors.length === 0 ? <p className="muted">No collectors registered. Connect an Android device to request secure registration.</p> : collectors.map(collector => <div className="collector-row" key={collector.id}><div><b>{collector.deviceName}</b><small>{collector.phoneNumber}</small><small>Last heartbeat: {collector.lastHeartbeatAt ? new Date(collector.lastHeartbeatAt).toLocaleString() : 'never'}</small><small>{collector.matchingApplicationCount > 1 ? 'Multiple active applications: OTP matching remains ambiguous' : collector.matchedApplication ? `Matched applicant: ${collector.matchedApplication.fullName} · ${collector.matchedApplication.webfileNumber}` : 'No matching active application'}</small>{collector.matchedJob && <small>Waiting job: {collector.matchedJob.id.slice(-8)} · {collector.matchedJob.state}</small>}</div><Badge tone={collector.status === 'ONLINE' ? 'mint' : collector.status === 'PENDING' ? 'amber' : 'slate'}>{collector.status}</Badge><div>{collector.registrationStatus === 'PENDING_APPROVAL' && <button className="primary" onClick={() => void approve(collector)}>Approve device</button>}<button className="quiet" onClick={() => void status(collector)}>{collector.status === 'DISABLED' ? 'Re-enable' : 'Disable'}</button><button className="quiet danger" onClick={() => void revoke(collector)}>Revoke / re-register</button></div></div>)}</aside></div>
}

function SettingsDrawer({ onClose }: { onClose: () => void }) { return <div className="ops-overlay"><aside className="settings-drawer"><div className="ops-modal-head"><div><p className="eyebrow">SETTINGS</p><h2>Operator settings</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><p className="muted">This panel uses your authenticated session. Automation and payment settings remain server-controlled.</p><button className="secondary" onClick={() => { localStorage.removeItem(OPERATOR_SESSION_KEY); window.dispatchEvent(new Event(OPERATOR_SESSION_EXPIRED_EVENT)) }}>Sign out</button></aside></div> }

function OperatorLogin({ message, onAuthenticated }: { message: string; onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setError(message) }, [message])
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = await api.login({ email, password })
      localStorage.setItem(OPERATOR_SESSION_KEY, session.token)
      onAuthenticated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }
  return <main className="page-wrap"><Card><form onSubmit={submit}><p className="eyebrow">OPERATOR ACCESS</p><h1>Sign in</h1><p className="muted">Use your IVAC Control Center operator account.</p><div className="form-grid"><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required/></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/></label></div>{error && <p className="safety-note">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></Card></main>
}

function Applications({ onNavigate, onSelect }: { onNavigate: (p: Page) => void; onSelect: (id: string) => void }) { const [items, setItems] = useState<Application[]>([]); const [search, setSearch] = useState(''); const [error, setError] = useState(''); useEffect(() => { const timer = setTimeout(() => api.list(search).then(r => { setItems(r.data); setError('') }).catch(e => setError(e.message)), 200); return () => clearTimeout(timer) }, [search]); return <><div className="page-head"><div><p className="eyebrow">APPLICATION DIRECTORY</p><h1>Applications</h1><p className="muted">Live data from the protected API.</p></div><button className="primary" onClick={() => onNavigate('Create Application')}><Plus size={17}/> New application</button></div><Card><div className="table-toolbar"><div className="input-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search applicant, webfile, phone…"/></div></div>{error ? <p className="safety-note">{error}</p> : <RealApplicationTable items={items} onSelect={onSelect}/>}</Card></> }
function RealApplicationTable({ items, onSelect }: { items: Application[]; onSelect: (id: string) => void }) { return <div className="table-wrap"><table><thead><tr><th>APPLICANT</th><th>MISSION / CENTRE</th><th>STATUS</th><th>LAST ACTIVITY</th><th/></tr></thead><tbody>{items.map(a => <tr key={a.id} onClick={() => onSelect(a.id)}><td><div className="table-person"><Avatar initials={a.fullName.split(' ').map(x => x[0]).slice(0,2).join('')}/><span><b>{a.fullName}</b><small>{a.webfileNumber}</small></span></div></td><td>{a.preference ? `${a.preference.mission} · ${a.preference.ivacCentre}` : '—'}</td><td><Badge tone={a.status === 'ACTIVE' ? 'mint' : 'slate'}>{a.status}</Badge></td><td>{new Date(a.updatedAt).toLocaleDateString()}</td><td><ChevronRight size={16}/></td></tr>)}</tbody></table>{items.length === 0 && <p className="muted">No applications found.</p>}</div> }
function CreateApplication({ onNavigate, onCreated }: { onNavigate: (p: Page) => void; onCreated: (id: string) => void }) {
  const [error, setError] = useState('')
  const [documents, setDocuments] = useState<(File | null)[]>([null, null, null, null])
  const [createdApplicationId, setCreatedApplicationId] = useState<string | null>(null)
  const [failedSlots, setFailedSlots] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [mission, setMission] = useState('')
  const [ivacCentre, setIvacCentre] = useState('')
  const [visaType, setVisaType] = useState('')
  const availableCentres = ivacCentresForMission(mission)

  const chooseDocument = (slot: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const document = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!document) return
    if (document.type !== 'application/pdf' || !document.name.toLowerCase().endsWith('.pdf')) {
      setError(`BGDR file ${slot} must be a PDF document.`)
      return
    }
    setError('')
    setDocuments(current => current.map((item, index) => index === slot - 1 ? document : item))
    setFailedSlots(current => current.filter(value => value !== slot))
  }

  const uploadSelected = async (applicationId: string, slots: number[]) => {
    const failures: number[] = []
    for (const slot of slots) {
      const document = documents[slot - 1]
      if (!document) continue
      try { await api.upload(applicationId, document, slot) } catch { failures.push(slot) }
    }
    if (failures.length) {
      setFailedSlots(failures)
      setError(`Application created, but BGDR upload failed for file ${failures.join(', ')}. Retry only the failed file${failures.length === 1 ? '' : 's'}.`)
      return false
    }
    return true
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mission || !ivacCentre || !visaType) {
      setError('Select a mission, IVAC centre, and visa type before creating the application.')
      return
    }
    if (!availableCentres.some(centre => centre.value === ivacCentre)) {
      setError('Select an IVAC centre that is available for the selected mission.')
      return
    }
    if (createdApplicationId) {
      setBusy(true)
      setError('')
      try {
        if (await uploadSelected(createdApplicationId, failedSlots)) onCreated(createdApplicationId)
      } finally { setBusy(false) }
      return
    }
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const application = await api.create({
        fullName: form.get('fullName'), webfileNumber: form.get('webfileNumber'), email: form.get('email'),
        primaryPhone: form.get('primaryPhone'), otpReceiverPhone: form.get('otpReceiverPhone'), notes: form.get('notes') || null,
        loginPhone: form.get('loginPhone'), loginPassword: form.get('loginPassword'),
        preference: { mission, ivacCentre, visaType },
      })
      const selectedSlots = documents.flatMap((document, index) => document ? [index + 1] : [])
      if (!selectedSlots.length) {
        onCreated(application.id)
        return
      }
      setCreatedApplicationId(application.id)
      if (await uploadSelected(application.id, selectedSlots)) onCreated(application.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save application')
    } finally {
      setBusy(false)
    }
  }

  return <form className="create-application-form" onSubmit={submit}>
    <div className="create-form-body">
      {error && <p className="safety-note">{error}</p>}
      <div className="create-form-grid">
        <section className="create-section">
          <div><p className="eyebrow">APPLICANT</p><h3>Applicant information</h3></div>
          <div className="form-grid">
            <Field name="fullName" label="Full legal name" placeholder="Full legal name"/>
            <Field name="primaryPhone" label="Primary phone" placeholder="+880 1…"/>
            <Field name="email" label="Email address" placeholder="applicant@example.com"/>
            <Field name="webfileNumber" label="Webfile number" placeholder="Webfile number"/>
            <Field name="otpReceiverPhone" label="Receiving phone" placeholder="+880 1…"/>
            <Field name="notes" label="Notes" placeholder="Optional operator notes"/>
          </div>
          <hr/>
          <div><p className="eyebrow">IVAC ACCESS</p><h3>IVAC credentials</h3><p className="muted">Password is encrypted before storage and never returned.</p></div>
          <div className="form-grid">
            <Field name="loginPhone" label="IVAC phone" placeholder="Phone used to sign in"/>
            <Field name="loginPassword" label="IVAC password" placeholder="••••••••" type="password"/>
          </div>
        </section>
        <section className="create-section create-side">
          <div><p className="eyebrow">APPOINTMENT</p><h3>Mission and centre</h3></div>
          <div className="appointment-fields">
            <SelectField name="mission" label="Mission / Region" value={mission} onChange={value => { setMission(value); setIvacCentre('') }} placeholder="Select mission" options={IVAC_MISSION_OPTIONS}/>
            <SelectField name="ivacCentre" label="IVAC Centre" value={ivacCentre} onChange={setIvacCentre} placeholder={mission ? availableCentres.length ? 'Select IVAC centre' : 'No verified centres captured' : 'Select mission first'} options={availableCentres} disabled={!mission || availableCentres.length === 0}/>
            <SelectField name="visaType" label="Visa type" value={visaType} onChange={setVisaType} placeholder="Select visa type" options={IVAC_VISA_TYPE_OPTIONS}/>
          </div>
          <hr/>
          <div><p className="eyebrow">DOCUMENTS</p><h3>BGDR / Application PDFs</h3><p className="muted">Choose up to four PDFs. File 1 is used by the current automation workflow.</p></div>
          <div className="bgdr-slots" aria-label="BGDR application PDF files">
            {documents.map((document, index) => {
              const slot = index + 1
              return <div className="bgdr-slot" key={slot}>
                <span className="bgdr-slot-label"><b>File {slot}</b><small>{slot === 1 ? 'PRIMARY · REQUIRED FOR AUTOMATION' : 'OPTIONAL'}</small></span>
                <span className="bgdr-file">{document ? <><FileText size={14}/><span title={document.name}>{document.name}</span><button type="button" className="quiet" disabled={busy} onClick={() => setDocuments(current => current.map((item, itemIndex) => itemIndex === index ? null : item))}>Remove</button></> : 'No file selected'}</span>
                <label className="secondary"><Upload size={14}/>{document ? 'Replace' : 'Choose'}<input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => chooseDocument(slot, event)}/></label>
              </div>
            })}
          </div>
          {failedSlots.length > 0 && <p className="safety-note">Retry pending for BGDR file {failedSlots.join(', ')}.</p>}
        </section>
      </div>
    </div>
    <div className="create-form-footer"><p className="muted">At least BGDR File 1 is required before Start Automation.</p><div><button type="button" className="secondary" onClick={() => onNavigate('Applications')} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? (createdApplicationId ? 'Retrying uploads…' : 'Creating…') : createdApplicationId ? 'Retry failed uploads' : 'Create application'} <ArrowRight size={16}/></button></div></div>
  </form>
}
function Field({ name, label, placeholder, type = 'text', value, onChange }: { name: string; label: string; placeholder: string; type?: string; value?: string; onChange?: (value: string) => void }) { return <label>{label}<input name={name} type={type} placeholder={placeholder} value={value} onChange={event => onChange?.(event.target.value)} required={name !== 'notes'}/></label> }
function SelectField({ name, label, value, onChange, placeholder, options, disabled = false }: { name: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; options: readonly { value: string; label: string }[]; disabled?: boolean }) { return <label>{label}<select name={name} value={value} onChange={event => onChange(event.target.value)} required disabled={disabled}><option value="">{placeholder}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function ApplicationDetail({ id, readinessRevision, onDocumentUpdated, onNavigate }: { id: string | null; readinessRevision: number; onDocumentUpdated: () => void; onNavigate: () => void }) {
  const [application, setApplication] = useState<Application | null>(null)
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!id) return
    try {
      setApplication(await api.get(id))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load application')
    }
  }

  useEffect(() => { void refresh() }, [id])

  const steps = [
    ['LOGIN', 'Not started', 'slate'],
    ['OTP', 'Not started', 'slate'],
    ['BGDR', application?.documents.length ? 'Uploaded' : 'Pending', application?.documents.length ? 'mint' : 'slate'],
    ['MISSION', application?.preference?.mission ?? 'Pending', 'violet'],
    ['CENTRE', application?.preference?.ivacCentre ?? 'Pending', 'violet'],
    ['SLOT', 'Pending', 'slate'],
    ['PAYMENT', 'Manual', 'violet'],
  ]

  if (error || !id) return <Card><h2>Application unavailable</h2><p className="muted">{error || 'Select an application from the directory.'}</p></Card>
  if (!application) return <Card><p className="muted">Loading protected application data…</p></Card>

  return <>
    <div className="detail-back"><ChevronLeft size={16}/> Applications / {application.webfileNumber}</div>
    <div className="detail-hero"><div className="person-title"><Avatar initials={application.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}/><div><p className="eyebrow">APPLICATION · {application.webfileNumber}</p><h1>{application.fullName}</h1><p className="muted">{application.preference ? `${application.preference.mission} mission · ${application.preference.ivacCentre} IVAC Centre` : 'No appointment preference'}</p></div></div><Badge tone={application.status === 'ACTIVE' ? 'mint' : 'slate'}>{application.status}</Badge></div>
    <Card className="workflow"><div className="card-head"><div><h2>Appointment workflow</h2><p>Automation is not implemented in Phase 2.</p></div></div><div className="workflow-steps">{steps.map(([name, status, tone], i) => <div className="workflow-step" key={name}><div className={`step-icon ${tone}`}>{i + 1}</div><b>{name}</b><small>{status}</small>{i < steps.length - 1 && <span className="step-line"/>}</div>)}</div></Card>
    <BgdrDocumentPanel application={application} onUploaded={async () => { await refresh(); onDocumentUpdated() }}/>
    <AutomationStartPanel key={`${application.id}:${readinessRevision}`} applicationId={application.id} onNavigate={onNavigate}/>
    <div className="detail-grid"><Card><div className="card-head"><div><h2>Activity timeline</h2><p>Audited application changes</p></div></div><div className="timeline">{application.events?.map((event, index) => <Timeline key={event.id} title={event.message} text={`${event.type} · ${event.actor.name}`} time={new Date(event.createdAt).toLocaleString()} tone={index === 0 ? 'violet' : 'slate'}/>)}</div></Card><Card><h2>Applicant profile</h2><dl><div><dt>Phone</dt><dd>{application.primaryPhone}</dd></div><div><dt>OTP receiver</dt><dd>{application.otpReceiverPhone}</dd></div><div><dt>Visa type</dt><dd>{application.preference?.visaType ?? '—'}</dd></div><div><dt>Document</dt><dd>{application.documents[0] ? <><FileText size={15}/>{application.documents[0].originalFilename}</> : 'Not uploaded'}</dd></div></dl></Card></div>
  </>
}

function BgdrDocumentPanel({ application, onUploaded }: { application: Application; onUploaded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const upload = async (slot: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      setSuccess('')
      setError('BGDR must be a PDF document.')
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await api.upload(application.id, file, slot)
      await onUploaded()
      setSuccess(`BGDR file ${slot} uploaded and saved privately.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload BGDR.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (slot: number) => {
    setBusy(true); setError(''); setSuccess('')
    try { await api.deleteDocument(application.id, slot); await onUploaded(); setSuccess(`BGDR file ${slot} removed.`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove BGDR.') }
    finally { setBusy(false) }
  }
  const documentsBySlot = new Map(application.documents.map(document => [document.slot, document]))
  return <Card><div className="card-head"><div><p className="eyebrow">DOCUMENTS</p><h2>BGDR / Application PDFs</h2><p className="muted">File 1 is the primary document used by the current worker workflow.</p></div><Badge tone={documentsBySlot.has(1) ? 'mint' : 'rose'}>{documentsBySlot.has(1) ? 'READY' : 'NOT UPLOADED'}</Badge></div><div className="detail-documents">{[1, 2, 3, 4].map(slot => { const document = documentsBySlot.get(slot); return <div key={slot}><span>BGDR file {slot}{slot === 1 ? ' · primary' : ''}</span>{document ? <><span><FileText size={15}/>{document.originalFilename}</span><small>{new Date(document.uploadedAt).toLocaleString()}</small><label className="quiet">Replace<input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => upload(slot, event)}/></label><button className="quiet danger" disabled={busy} onClick={() => void remove(slot)}>Remove</button></> : <label className="secondary">Add PDF<input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={event => upload(slot, event)}/></label>}</div> })}</div>{error && <p className="safety-note">{error}</p>}{success && <p className="muted">{success}</p>}</Card>
}
function Timeline({ title, text, time, tone }: { title: string; text: string; time: string; tone: string }) { return <div className="timeline-item"><span className={`timeline-dot ${tone}`}/><div><b>{title}</b><p>{text}</p></div><time>{time}</time></div> }
function SmsPage() {
  const [messages, setMessages] = useState<import('./api').Sms[]>([])
  const [collectors, setCollectors] = useState<import('./api').Collector[]>([])
  const [error, setError] = useState('')
  const load = () => Promise.all([api.sms(), api.collectors()]).then(([s, c]) => {
    setMessages(s.data); setCollectors(c.data); setError('')
  }).catch(e => setError(e.message))

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])

  const setStatus = async (collector: import('./api').Collector, action: 'enable' | 'disable') => {
    try { await api.setCollectorStatus(collector.id, action); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update collector') }
  }
  const approve = async (collector: import('./api').Collector) => {
    try { await api.approveCollectorRegistration(collector.id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to approve device registration') }
  }
  const revoke = async (collector: import('./api').Collector) => {
    if (!window.confirm(`Revoke ${collector.deviceName}? The phone must register again before it can submit SMS.`)) return
    try { await api.revokeCollector(collector.id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to revoke collector') }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">SMS COLLECTORS · POLLING EVERY 15S</p><h1>SMS & OTP</h1><p className="muted">Register the Android device from the phone. No pairing code or collector credential is displayed in this panel.</p></div></div>
    <Card><div className="card-head"><div><h2>Phone-based device registration</h2><p className="muted">On Android enter the backend URL, receiving SIM number, and device name, then tap Connect. Approve the matching pending device here.</p></div></div><p className="muted">The receiving phone is used only for exact SMS matching. The device credential is generated and stored securely on the Android device.</p></Card>
    {error && <p className="safety-note">{error}</p>}
    {collectors.length === 0 ? <Card><p className="muted">No collectors registered. Connect the Android SMS Collector to request a secure device registration.</p></Card> : <div className="kpi-grid">{collectors.map(collector => { const match = collector.matchingApplicationCount === 0 ? 'No matching active application' : collector.matchingApplicationCount > 1 ? 'Multiple active applications — OTP matching is ambiguous' : `Automatically matched applications: ${collector.matchingApplicationCount}`; return <Card key={collector.id}><div className="kpi-label"><span>{collector.deviceName}</span><span className={`dot ${collector.status === 'ONLINE' ? 'mint' : collector.status === 'PENDING' || collector.status === 'DEGRADED' ? 'amber' : 'rose'}`}/></div><strong className="kpi-value">{collector.status}</strong><small>Receiving {collector.phoneNumber}</small><small>Last heartbeat: {collector.lastHeartbeatAt ? new Date(collector.lastHeartbeatAt).toLocaleString() : 'never'}</small><small>{match}</small>{collector.waitingOtpJobCount > 0 && <small>Waiting OTP jobs: {collector.waitingOtpJobCount}</small>}<div>{collector.registrationStatus === 'PENDING_APPROVAL' && <button className="primary" onClick={() => approve(collector)}>Approve device</button>}{collector.status !== 'PENDING' && <><button className="quiet" onClick={() => setStatus(collector, collector.status === 'DISABLED' ? 'enable' : 'disable')}>{collector.status === 'DISABLED' ? 'Re-enable' : 'Disable'}</button>{' '}<button className="quiet" onClick={() => revoke(collector)}>Remove / revoke</button></>}</div></Card>})}</div>}
    <Card className="recent-card"><div className="card-head"><div><h2>Received messages</h2><p>Protected collector feed — OTP content is masked.</p></div></div>{messages.length === 0 ? <p className="muted">No SMS received yet.</p> : <div className="table-wrap"><table><thead><tr><th>RECEIVED</th><th>RECEIVER</th><th>SENDER</th><th>OTP</th><th>MATCHED APPLICANT</th><th>JOB</th><th>STATUS</th><th>COLLECTOR</th></tr></thead><tbody>{messages.map(m => <tr key={m.id}><td>{new Date(m.receivedAt).toLocaleString()}</td><td>{m.receiverNumber}</td><td>{m.senderNumber}</td><td>{m.detectedOtp ?? '—'}{m.otpStatus ? ` · ${m.otpStatus}` : ''}</td><td>{m.matchedApplication ? `${m.matchedApplication.fullName} · ${m.matchedApplication.webfileNumber}` : m.status === 'NEEDS_REVIEW' ? 'Ambiguous — no automatic OTP match' : 'No automatic match'}</td><td>{m.jobId ? m.jobId.slice(-8) : '—'}</td><td><Badge tone={m.status === 'MATCHED' ? 'mint' : m.status === 'NEEDS_REVIEW' ? 'amber' : m.status === 'EXPIRED' ? 'rose' : 'slate'}>{m.status}</Badge></td><td>{m.collector.deviceName}</td></tr>)}</tbody></table></div>}</Card>
  </>
}
function PaymentPage(){const [jobs,setJobs]=useState<any[]>([]),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');const load=()=>api.jobs().then(x=>setJobs(x.data)).catch(e=>setNotice(e.message));useEffect(()=>{load()},[]);const send=async(job:any,type:string,confirm=false)=>{if(confirm&&!window.confirm(type==='mark-payment-completed'?'Confirm that payment was completed manually?':'Confirm that payment failed manually?'))return;setBusy(`${job.id}:${type}`);try{const command=await api.command(job.id,type);let status=command.status;for(let i=0;i<20&&['PENDING','CLAIMED'].includes(status);i++){await new Promise(r=>setTimeout(r,1000));status=(await api.commandStatus(job.id,command.id)).status}if(status!=='COMPLETED')throw new Error('Command could not be completed');setNotice(type==='focus-payment'?'Payment window opened':type==='mark-payment-completed'?'Manual payment completed':'Browser session closed');load()}catch(e){setNotice(e instanceof Error?e.message:'Command failed')}finally{setBusy('')}};const payment=jobs.filter(j=>['PAYMENT_READY','COMPLETED','FAILED'].includes(j.state));return <><div className="page-head"><div><p className="eyebrow">MANUAL OPERATOR HANDOFF</p><h1>Payments</h1><p className="muted">Payment remains manual. Session-bound handoffs open the retained browser only.</p></div></div>{notice&&<p className="safety-note">{notice}</p>}{payment.length===0?<Card><p className="muted">No payments ready.</p></Card>:<div className="placeholder-grid">{payment.map(j=>{const independent=j.paymentHandoff?.mode==='INDEPENDENT'&&!!j.paymentHandoff.destinationUrl;return <Card key={j.id}><Badge tone={j.state==='PAYMENT_READY'?'violet':'slate'}>{j.state==='PAYMENT_READY'?'Payment Ready':j.state}</Badge><h2>{j.application.fullName}</h2><p>Appointment: {j.application.webfileNumber}<br/>Provider: {j.paymentHandoff?.provider??'Manual handoff'}<br/>Mode: {independent?'Independent payment destination':'Retained browser session'}<br/>Ready: {new Date(j.updatedAt).toLocaleString()}</p>{j.state==='PAYMENT_READY'&&<>{independent?<a className="primary full" href={j.paymentHandoff.destinationUrl} target="_blank" rel="noopener noreferrer">OPEN PAYMENT</a>:<button className="primary full" disabled={!!busy} onClick={()=>send(j,'focus-payment')}>OPEN PAYMENT</button>}<button className="secondary full" disabled={!!busy} onClick={()=>send(j,'mark-payment-completed',true)}>MARK COMPLETED</button><button className="quiet full" disabled={!!busy} onClick={()=>send(j,'mark-payment-failed',true)}>MARK FAILED</button></>}{['COMPLETED','FAILED'].includes(j.state)&&<button className="secondary full" disabled={!!busy} onClick={()=>send(j,'cleanup-session')}>CLOSE SESSION</button>}</Card>})}</div>}</>}
function Placeholder({ title }: { title: Page }) { const messages: Record<string, string> = { Documents: 'No document list data available.', Activity: 'No activity yet.', Analytics: 'No analytics data available.', Team: 'No team data available.', Settings: 'No settings data available.' }; return <><div className="page-head"><div><p className="eyebrow">OPERATOR PANEL</p><h1>{title}</h1><p className="muted">This view displays backend data when the corresponding API is available.</p></div></div><Card><div className="empty-icon"><Activity/></div><h2>{messages[title] ?? 'No data available.'}</h2><p className="muted">Only backend-provided records appear here.</p></Card></> }
function CommandPanel({ onClose, onNavigate }: { onClose: () => void; onNavigate: (p: Page) => void }) { return <div className="command-overlay" onMouseDown={onClose}><div className="command-modal" onMouseDown={e => e.stopPropagation()}><div><Search size={18}/><input autoFocus placeholder="Search pages and applications…"/><kbd>ESC</kbd></div><p>GO TO</p>{(['Dashboard','Live Operations','Applications','SMS & OTP','Payments','Settings'] as Page[]).map(p => <button key={p} onClick={() => { onNavigate(p); onClose() }}>{navigation.find(x => x.name === p)?.icon && <>{(() => { const Icon = navigation.find(x => x.name === p)!.icon; return <Icon size={17}/> })()}</>}<span>{p}</span><ArrowRight size={15}/></button>)}</div></div> }

function useJobs() {
  const [jobs, setJobs] = useState<AutomationJob[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api.jobs().then(result => { setJobs(result.data); setError('') }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load jobs'))
    load()
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [])
  return { jobs, error }
}

function jobTone(state: string) {
  if (state === 'PAYMENT_READY') return 'violet'
  if (state === 'FAILED' || state === 'VERIFICATION_REQUIRED' || state === 'NEEDS_ATTENTION') return 'rose'
  if (state.includes('OTP') || state.includes('SLOT')) return 'amber'
  return 'mint'
}

function elapsedTime(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function useOperationsSummary() {
  const [summary, setSummary] = useState<import('./api').OperationsSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api.operationsSummary().then(result => { setSummary(result); setError('') }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load appointment-day health'))
    load()
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [])
  return { summary, error }
}

function AppointmentDayCard({ jobs }: { jobs: AutomationJob[] }) {
  const { summary, error } = useOperationsSummary()
  const active = jobs.find(job => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state))
  const checks = [
    ['Backend', summary?.backend === 'ONLINE' ? 'ONLINE' : 'Unavailable', summary?.backend === 'ONLINE' ? 'mint' : 'rose'],
    ['Database', summary?.database === 'CONNECTED' ? 'CONNECTED' : 'Unavailable', summary?.database === 'CONNECTED' ? 'mint' : 'rose'],
    ['Worker', summary ? `${summary.workers.online}/${summary.workers.total} online` : 'Unavailable', summary && summary.workers.online > 0 ? 'mint' : 'amber'],
    ['SMS Collector', summary ? `${summary.collectors.online}/${summary.collectors.total} online` : 'Unavailable', summary && summary.collectors.online > 0 ? 'mint' : 'amber'],
    ['Application readiness', summary ? `${summary.applications.ready}/${summary.applications.active} ready` : 'Unavailable', summary && summary.applications.ready > 0 ? 'mint' : 'amber'],
    ['Current job status', active?.state ?? 'No active job', active ? jobTone(active.state) : 'slate'],
  ]
  return <Card className="appointment-day"><div className="card-head"><div><p className="eyebrow">APPOINTMENT DAY</p><h2>Operational readiness</h2></div></div>{error && <p className="safety-note">{error}</p>}<div className="health-list">{checks.map(([label, value, tone]) => <div className="health" key={String(label)}><span className={`status-ring ${tone}`}/><span>{label}</span><b>{value}</b></div>)}</div></Card>
}

function OpenPaymentButton({ job, onComplete }: { job: AutomationJob; onComplete?: () => void }) {
  const [busy, setBusy] = useState(false)
  const independent = job.paymentHandoff?.mode === 'INDEPENDENT' && !!job.paymentHandoff.destinationUrl
  if (independent) return <a className="primary" href={job.paymentHandoff!.destinationUrl!} target="_blank" rel="noopener noreferrer">OPEN PAYMENT</a>
  return <button className="primary" disabled={busy} onClick={async event => { event.stopPropagation(); setBusy(true); try { const command = await api.command(job.id, 'focus-payment'); let status = command.status; for (let attempt = 0; attempt < 20 && ['PENDING', 'CLAIMED'].includes(status); attempt++) { await new Promise(resolve => window.setTimeout(resolve, 1_000)); status = (await api.commandStatus(job.id, command.id)).status } if (status !== 'COMPLETED') throw new Error('Payment window could not be focused'); onComplete?.() } finally { setBusy(false) } }}>{busy ? 'OPENING…' : 'OPEN PAYMENT'}</button>
}

function JobRecoveryControls({ job }: { job: AutomationJob }) {
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const run = async (action: 'pause' | 'resume' | 'cancel' | 'cleanup') => {
    setBusy(action); setNotice('')
    try {
      if (action === 'pause') await api.pauseJob(job.id)
      else if (action === 'resume') await api.resumeJob(job.id)
      else if (action === 'cancel') await api.cancelJob(job.id)
      else await api.command(job.id, 'cleanup-session')
      setNotice(action === 'resume' ? 'Resume / retry requested for the retained session.' : `${action[0].toUpperCase()}${action.slice(1)} requested.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Control could not be completed') } finally { setBusy('') }
  }
  const canPause = ['WAITING_FOR_OTP', 'WAITING_FOR_SLOT', 'VERIFICATION_REQUIRED'].includes(job.state)
  const canResume = ['PAUSED', 'VERIFICATION_REQUIRED', 'WAITING_FOR_SLOT'].includes(job.state)
  const canCancel = !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)
  const canCleanup = ['PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED', 'NEEDS_ATTENTION'].includes(job.state)
  if (!canPause && !canResume && !canCancel && !canCleanup) return null
  return <div className="recovery-controls">{canPause && <button className="secondary" disabled={!!busy} onClick={() => run('pause')}>PAUSE</button>}{canResume && <button className="secondary" disabled={!!busy} onClick={() => run('resume')}>RESUME / RETRY</button>}{canCancel && <button className="quiet" disabled={!!busy} onClick={() => run('cancel')}>CANCEL</button>}{canCleanup && <button className="quiet" disabled={!!busy} onClick={() => run('cleanup')}>CLEANUP SESSION</button>}{notice && <small>{notice}</small>}</div>
}

function LiveDashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { jobs, error } = useJobs()
  const counters = [
    ['Active Jobs', jobs.filter(job => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)).length, 'violet'],
    ['Waiting OTP', jobs.filter(job => job.state === 'WAITING_FOR_OTP').length, 'amber'],
    ['Verification Required', jobs.filter(job => job.state === 'VERIFICATION_REQUIRED').length, 'rose'],
    ['Slot Found', jobs.filter(job => job.state === 'SLOT_FOUND').length, 'mint'],
    ['Payment Ready', jobs.filter(job => job.state === 'PAYMENT_READY').length, 'blue'],
    ['Failed Jobs', jobs.filter(job => job.state === 'FAILED').length, 'slate'],
  ]
  return <><div className="page-head"><div><p className="eyebrow">LIVE OPERATIONS</p><h1>Dashboard</h1><p className="muted">Current automation job status from the protected API.</p></div><button className="primary" onClick={() => onNavigate('Create Application')}><Plus size={17}/> New application</button></div>{error && <p className="safety-note">{error}</p>}<div className="kpi-grid">{counters.map(([title, value, tone]) => <Card key={String(title)}><div className="kpi-label"><span>{title}</span><span className={`dot ${tone}`}/></div><strong className="kpi-value">{value}</strong><small>Live job count</small></Card>)}</div><div className="dashboard-grid"><Card className="activity-card"><div className="card-head"><div><h2>Recent automation jobs</h2><p>Updated every 10 seconds.</p></div><button className="quiet" onClick={() => onNavigate('Live Operations')}>View all <ArrowRight size={15}/></button></div>{jobs.length === 0 ? <p className="muted">No active jobs.</p> : jobs.slice(0, 5).map(job => <div className="job-row" key={job.id}><Avatar initials={job.application.fullName.split(' ').map(part => part[0]).slice(0, 2).join('')}/><div className="job-name"><b>{job.application.fullName}</b><span>{job.application.maskedPhone} · {job.currentStage} · {elapsedTime(job.elapsedMs)}</span></div><Badge tone={jobTone(job.state)}>{job.state}</Badge><time>{new Date(job.updatedAt).toLocaleTimeString()}</time></div>)}</Card><AppointmentDayCard jobs={jobs}/></div></>
}

function LiveOperations({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { jobs, error } = useJobs()
  return <><div className="page-head"><div><p className="eyebrow">REAL-TIME · PROTECTED API</p><h1>Live operations</h1><p className="muted">Automation jobs are refreshed every 10 seconds.</p></div><div className="live-pill"><span/> Live</div></div>{error && <p className="safety-note">{error}</p>}<Card className="ops-table">{jobs.length === 0 ? <p className="muted">No automation jobs queued.</p> : jobs.map(job => <section className={`operation job-${jobTone(job.state)}`} key={job.id}><button className="operation-main" onClick={() => onNavigate('Applications')}><Avatar initials={job.application.fullName.split(' ').map(part => part[0]).slice(0, 2).join('')}/><div><b>{job.application.fullName}</b><span>{job.application.webfileNumber} · {job.application.maskedPhone}</span></div><Badge tone={jobTone(job.state)}>{job.state}</Badge></button><div className="operation-details"><span><b>Stage</b>{job.currentStage}</span><span><b>Elapsed</b>{elapsedTime(job.elapsedMs)}</span><span><b>Last success</b>{job.lastSuccessfulStage ?? '—'}</span><span><b>Worker</b>{job.worker?.workerName ?? 'Waiting for worker'}</span><span><b>Heartbeat</b>{job.worker?.lastHeartbeatAt ? new Date(job.worker.lastHeartbeatAt).toLocaleTimeString() : '—'}</span><span><b>OTP</b>{job.otpStatus}</span><span><b>Slot</b>{job.slotStatus}</span><span><b>Payment</b>{job.paymentStatus}</span><span><b>Last error</b>{job.latestSafeError ?? '—'}</span></div><div className="operation-action">{job.state === 'PAYMENT_READY' && <OpenPaymentButton job={job}/>}<JobRecoveryControls job={job}/></div></section>)}</Card></>
}

function AutomationStartPanel({ applicationId, onNavigate }: { applicationId: string; onNavigate: () => void }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'queued' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [readiness, setReadiness] = useState<import('./api').AutomationReadiness | null>(null)
  useEffect(() => { api.readiness(applicationId).then(setReadiness).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to check appointment readiness')) }, [applicationId])
  const start = async () => {
    setState('submitting')
    try {
      const job = await api.createAutomationJob(applicationId)
      setState('queued')
      setMessage(`Automation job ${job.id} queued.`)
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Unable to queue automation job')
    }
  }
  return <Card><div className="card-head"><div><p className="eyebrow">AUTOMATION</p><h2>Automation readiness</h2><p>All required controls are validated by the backend before a job can be queued.</p></div>{readiness && <Badge tone={readiness.ready ? 'mint' : 'amber'}>{readiness.ready ? 'READY' : 'ACTION REQUIRED'}</Badge>}</div>{readiness ? <div className="readiness-list">{readiness.checks.map(check => <div key={check.key}><span className={`status-ring ${check.ok ? 'mint' : 'rose'}`}/><span>{check.label}</span><b>{check.ok ? 'Ready' : 'Missing'}</b></div>)}</div> : <p className="muted">Checking readiness…</p>}{readiness?.smsCollector.warning ? <p className="safety-note">SMS Collector: {readiness.smsCollector.warning}</p> : readiness && <p className="muted">SMS Collector: {readiness.smsCollector.onlineCount} healthy device(s) online.</p>}{message && <p className="safety-note">{message}</p>}<button className="primary" disabled={!readiness?.ready || state === 'submitting' || state === 'queued'} onClick={start}>{state === 'submitting' ? 'Queueing…' : state === 'queued' ? 'Automation queued' : 'START AUTOMATION'}</button>{state === 'queued' && <button className="quiet" onClick={onNavigate}>View job in Live Operations <ArrowRight size={15}/></button>}</Card>
}

createRoot(document.getElementById('app')!).render(<App />)
