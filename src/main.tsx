import { useEffect, useMemo, useState } from 'react'
import { ManualValidation } from './manual-validation'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowRight, Bell, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Command, FileText, LayoutDashboard, Menu, MoreHorizontal, Moon, Plus, Radio,
  Search, Settings, ShieldAlert, Sun, Upload, Users, X, Zap
} from 'lucide-react'
import './styles.css'
import { api, type Application, type AutomationJob } from './api'

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

const jobs = [
  { initials: 'AK', name: 'Ayesha Khan', ref: 'APP-1048', state: 'WAITING FOR OTP', tone: 'amber', mission: 'Italy · Dhaka', age: '2m' },
  { initials: 'RM', name: 'Rafiul Miah', ref: 'APP-1047', state: 'SLOT FOUND', tone: 'mint', mission: 'Portugal · Dhaka', age: '5m' },
  { initials: 'ST', name: 'Sanjida Tasnim', ref: 'APP-1046', state: 'VERIFICATION REQUIRED', tone: 'rose', mission: 'Italy · Chittagong', age: '7m' },
  { initials: 'FH', name: 'Fahim Hossain', ref: 'APP-1045', state: 'PAYMENT READY', tone: 'violet', mission: 'Italy · Dhaka', age: '11m' }
]
const kpis = [
  ['Active Jobs', '14', '+3 today', 'violet'], ['Waiting OTP', '03', '2 min avg.', 'amber'], ['Verification Required', '02', 'Needs review', 'rose'], ['Slot Found', '08', 'Today', 'mint'], ['Payment Ready', '05', 'Manual step', 'blue'], ['Failed Jobs', '01', 'Last 24h', 'slate']
]

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span> }
function Avatar({ initials }: { initials: string }) { return <span className="avatar">{initials}</span> }
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }

function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ivac-theme') as Theme) || 'system')
  const [commandOpen, setCommandOpen] = useState(false)
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)
  const isDark = useMemo(() => theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches), [theme])
  useEffect(() => { document.documentElement.classList.toggle('dark', isDark); localStorage.setItem('ivac-theme', theme) }, [theme, isDark])
  const navigate = (to: Page) => { setPage(to); setSidebarOpen(false) }
  return <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><span /></span><span className="brand-name">IVAC <b>Control</b></span><button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18}/></button></div>
      <nav>{navigation.map((item) => <div key={item.name}>{item.section && <p className="nav-section">{item.section}</p>}<button onClick={() => navigate(item.name)} className={`nav-item ${page === item.name || (item.name === 'Applications' && ['Create Application','Application Detail'].includes(page) ) ? 'active' : ''}`} title={item.name}><item.icon size={18}/><span>{item.name}</span>{item.name === 'Live Operations' && <i>4</i>}</button></div>)}</nav>
      <div className="sidebar-footer"><div className="operator"><Avatar initials="NA"/><span><b>Nasim Ahmed</b><small>Operator · Online</small></span><MoreHorizontal size={17}/></div><button className="collapse" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={17}/> : <><ChevronLeft size={17}/><span>Collapse menu</span></>}</button></div>
    </aside>
    {sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>} 
    <main><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Operations</span><ChevronRight size={14}/><b>{page}</b></div></div><button className="command" onClick={() => setCommandOpen(true)}><Search size={17}/><span>Search or jump to…</span><kbd>⌘ K</kbd></button><div className="top-actions"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} title={`Theme: ${theme}`}>{theme === 'dark' ? <Moon size={17}/> : theme === 'light' ? <Sun size={17}/> : <CircleHelp size={17}/>}</button><button className="icon-button notice"><Bell size={18}/><em/></button><div className="top-avatar"><Avatar initials="NA"/></div></div></header>
      <div className="page-wrap">{page === 'Dashboard' && <LiveDashboard onNavigate={navigate}/>} {page === 'Live Operations' && <LiveOperations onNavigate={navigate}/>} {page === 'Manual Validation' && <ManualValidation/>} {page === 'Applications' && <Applications onNavigate={navigate} onSelect={(id) => { setSelectedApplicationId(id); navigate('Application Detail') }}/>} {page === 'Create Application' && <CreateApplication onNavigate={navigate} onCreated={(id) => { setSelectedApplicationId(id); navigate('Application Detail') }}/>} {page === 'Application Detail' && <><ApplicationDetail id={selectedApplicationId}/>{selectedApplicationId && <AutomationStartPanel applicationId={selectedApplicationId}/>}</>} {page === 'SMS & OTP' && <SmsPage/>} {page === 'Payments' && <PaymentPage/>} {['Documents','Activity','Analytics','Team','Settings'].includes(page) && <Placeholder title={page}/>}</div>
    </main>
    {commandOpen && <CommandPanel onClose={() => setCommandOpen(false)} onNavigate={navigate}/>} 
  </div>
}

function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) { return <><div className="page-head"><div><p className="eyebrow">MONDAY, 31 AUGUST</p><h1>Good morning, Nasim <span>✦</span></h1><p className="muted">Your operations are moving. Here’s the live picture.</p></div><button className="primary" onClick={() => onNavigate('Create Application')}><Plus size={17}/> New application</button></div><div className="mock-note">DEMO DATA · No IVAC automation is active</div><div className="kpi-grid">{kpis.map(([title, value, detail, tone]) => <Card key={title}><div className="kpi-label"><span>{title}</span><span className={`dot ${tone}`}/></div><strong className="kpi-value">{value}</strong><small className={tone === 'rose' || tone === 'slate' ? 'danger-text' : ''}>{detail}</small></Card>)}</div><div className="dashboard-grid"><Card className="activity-card"><div className="card-head"><div><h2>Live operations</h2><p>Jobs requiring attention or in progress</p></div><button className="quiet" onClick={() => onNavigate('Live Operations')}>View all <ArrowRight size={15}/></button></div><div className="job-list">{jobs.map(job => <button className="job-row" key={job.ref} onClick={() => onNavigate('Application Detail')}><Avatar initials={job.initials}/><div className="job-name"><b>{job.name}</b><span>{job.ref} · {job.mission}</span></div><Badge tone={job.tone}>{job.state}</Badge><time>{job.age}</time><ChevronRight size={16}/></button>)}</div></Card><Card className="health-card"><div className="card-head"><div><h2>System health</h2><p>All systems are monitored</p></div><Badge tone="mint"><Check size={12}/> Operational</Badge></div><Health name="Control API" value="99.99%" tone="mint"/><Health name="SMS Collector" value="Connected" tone="mint"/><Health name="Job Worker" value="4 active" tone="violet"/><Health name="Private storage" value="Healthy" tone="mint"/><button className="quiet full">View system status <ArrowRight size={15}/></button></Card></div><Card className="recent-card"><div className="card-head"><div><h2>Recent applications</h2><p>Latest updates from your workspace</p></div><button className="quiet" onClick={() => onNavigate('Applications')}>All applications <ArrowRight size={15}/></button></div><RealApplicationTable items={[]} onSelect={() => undefined}/></Card></> }
function Health({ name, value, tone }: { name: string; value: string; tone: string }) { return <div className="health"><span className={`status-ring ${tone}`}/><span>{name}</span><b>{value}</b></div> }
function Operations({ onNavigate }: { onNavigate: (p: Page) => void }) { return <><div className="page-head"><div><p className="eyebrow">REAL-TIME · MOCK DATA</p><h1>Live operations</h1><p className="muted">Track every application through its appointment journey.</p></div><div className="live-pill"><span/> Live updates</div></div><div className="ops-layout"><Card className="ops-table"><div className="filter-row"><button className="filter active">All jobs <b>14</b></button><button className="filter">Needs attention <b>2</b></button><button className="filter">In progress <b>7</b></button><button className="filter">Ready <b>5</b></button></div>{jobs.concat(jobs).map((job, i) => <button className="operation" key={`${job.ref}-${i}`} onClick={() => onNavigate('Application Detail')}><Avatar initials={job.initials}/><div><b>{job.name}</b><span>{job.ref} · {job.mission}</span></div><Badge tone={job.tone}>{job.state}</Badge><span className="op-step">{['Awaiting SMS relay','Appointment slot captured','Operator handoff needed','Payment boundary reached'][i % 4]}</span><ChevronRight size={16}/></button>)}</Card><Card className="attention"><ShieldAlert size={22}/><h2>Attention queue</h2><p>2 jobs are paused for human verification. Review them in the browser; no bypass actions are available.</p><button className="secondary">Review verification queue</button></Card></div></> }
function Applications({ onNavigate, onSelect }: { onNavigate: (p: Page) => void; onSelect: (id: string) => void }) { const [items, setItems] = useState<Application[]>([]); const [search, setSearch] = useState(''); const [error, setError] = useState(''); useEffect(() => { const timer = setTimeout(() => api.list(search).then(r => { setItems(r.data); setError('') }).catch(e => setError(e.message)), 200); return () => clearTimeout(timer) }, [search]); return <><div className="page-head"><div><p className="eyebrow">APPLICATION DIRECTORY</p><h1>Applications</h1><p className="muted">Live data from the protected API.</p></div><button className="primary" onClick={() => onNavigate('Create Application')}><Plus size={17}/> New application</button></div><Card><div className="table-toolbar"><div className="input-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search applicant, webfile, phone…"/></div></div>{error ? <p className="safety-note">{error}. Set a valid <code>VITE_API_TOKEN</code> or sign in before using profiles.</p> : <RealApplicationTable items={items} onSelect={onSelect}/>}</Card></> }
function RealApplicationTable({ items, onSelect }: { items: Application[]; onSelect: (id: string) => void }) { return <div className="table-wrap"><table><thead><tr><th>APPLICANT</th><th>MISSION / CENTRE</th><th>STATUS</th><th>LAST ACTIVITY</th><th/></tr></thead><tbody>{items.map(a => <tr key={a.id} onClick={() => onSelect(a.id)}><td><div className="table-person"><Avatar initials={a.fullName.split(' ').map(x => x[0]).slice(0,2).join('')}/><span><b>{a.fullName}</b><small>{a.webfileNumber}</small></span></div></td><td>{a.preference ? `${a.preference.mission} · ${a.preference.ivacCentre}` : '—'}</td><td><Badge tone={a.status === 'ACTIVE' ? 'mint' : 'slate'}>{a.status}</Badge></td><td>{new Date(a.updatedAt).toLocaleDateString()}</td><td><ChevronRight size={16}/></td></tr>)}</tbody></table>{items.length === 0 && <p className="muted">No applications found.</p>}</div> }
function CreateApplication({ onNavigate, onCreated }: { onNavigate: (p: Page) => void; onCreated: (id: string) => void }) { const [error, setError] = useState(''); const submit = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { const app = await api.create({ fullName:f.get('fullName'), webfileNumber:f.get('webfileNumber'), email:f.get('email'), primaryPhone:f.get('primaryPhone'), otpReceiverPhone:f.get('otpReceiverPhone'), notes:f.get('notes') || null, loginPhone:f.get('loginPhone'), loginPassword:f.get('loginPassword'), preference:{ mission:f.get('mission'), ivacCentre:f.get('ivacCentre'), visaType:f.get('visaType'), preferredDate:f.get('preferredDate') || null, allowAlternativeDates:f.get('allowAlternativeDates') === 'on', allowedDateFrom:f.get('allowedDateFrom') || null, allowedDateTo:f.get('allowedDateTo') || null } }); onCreated(app.id) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save application') } }; return <form onSubmit={submit}><div className="page-head compact"><div><button type="button" className="back" onClick={() => onNavigate('Applications')}><ChevronLeft size={16}/> Applications</button><h1>Create application</h1><p className="muted">Create an encrypted, protected profile.</p></div></div>{error && <p className="safety-note">{error}</p>}<div className="form-layout"><Card><h2>Applicant identity</h2><div className="form-grid"><Field name="fullName" label="Full legal name" placeholder="e.g. Ayesha Khan"/><Field name="primaryPhone" label="Primary phone" placeholder="+880 1…"/><Field name="email" label="Email address" placeholder="applicant@example.com"/><Field name="webfileNumber" label="Webfile number" placeholder="A01234567"/><Field name="otpReceiverPhone" label="OTP receiver phone" placeholder="+880 1…"/><Field name="notes" label="Notes" placeholder="Optional operator notes"/></div><hr/><h2>IVAC credentials</h2><p className="muted">Password is encrypted with AES-256-GCM before storage and never returned.</p><div className="form-grid"><Field name="loginPhone" label="IVAC phone" placeholder="Phone used to sign in"/><Field name="loginPassword" label="IVAC password" placeholder="••••••••" type="password"/></div></Card><div className="form-side"><Card><h2>Appointment preferences</h2><Field name="mission" label="Mission" placeholder="Italy"/><Field name="ivacCentre" label="IVAC Centre" placeholder="Dhaka"/><Field name="visaType" label="Visa type" placeholder="Tourist"/><Field name="preferredDate" label="Preferred date" placeholder="YYYY-MM-DD"/><Field name="allowedDateFrom" label="Allowed from" placeholder="YYYY-MM-DD"/><Field name="allowedDateTo" label="Allowed to" placeholder="YYYY-MM-DD"/><label><input name="allowAlternativeDates" type="checkbox"/> Allow alternative dates</label><button className="primary full">Save application <ArrowRight size={16}/></button></Card></div></div></form> }
function Field({ name, label, placeholder, type = 'text' }: { name: string; label: string; placeholder: string; type?: string }) { return <label>{label}<input name={name} type={type} placeholder={placeholder} required={name !== 'notes' && name !== 'allowedDateFrom' && name !== 'allowedDateTo' && name !== 'preferredDate'}/></label> }
function ApplicationDetail({ id }: { id: string | null }) { const [application, setApplication] = useState<Application | null>(null); const [error, setError] = useState(''); useEffect(() => { if (id) api.get(id).then(setApplication).catch(e => setError(e.message)) }, [id]); const steps = [['LOGIN','Not started','slate'],['OTP','Not started','slate'],['BGDR',application?.documents.length ? 'Uploaded' : 'Pending',application?.documents.length ? 'mint' : 'slate'],['MISSION',application?.preference?.mission ?? 'Pending','violet'],['CENTRE',application?.preference?.ivacCentre ?? 'Pending','violet'],['SLOT','Pending','slate'],['PAYMENT','Manual','violet']]; if (error || !id) return <Card><h2>Application unavailable</h2><p className="muted">{error || 'Select an application from the directory.'}</p></Card>; if (!application) return <Card><p className="muted">Loading protected application data…</p></Card>; return <><div className="detail-back"><ChevronLeft size={16}/> Applications / {application.webfileNumber}</div><div className="detail-hero"><div className="person-title"><Avatar initials={application.fullName.split(' ').map(n => n[0]).slice(0,2).join('')}/><div><p className="eyebrow">APPLICATION · {application.webfileNumber}</p><h1>{application.fullName}</h1><p className="muted">{application.preference ? `${application.preference.mission} mission · ${application.preference.ivacCentre} IVAC Centre` : 'No appointment preference'}</p></div></div><Badge tone={application.status === 'ACTIVE' ? 'mint' : 'slate'}>{application.status}</Badge></div><Card className="workflow"><div className="card-head"><div><h2>Appointment workflow</h2><p>Automation is not implemented in Phase 2.</p></div></div><div className="workflow-steps">{steps.map(([name, status, tone], i) => <div className="workflow-step" key={name}><div className={`step-icon ${tone}`}>{i + 1}</div><b>{name}</b><small>{status}</small>{i < steps.length - 1 && <span className="step-line"/>}</div>)}</div></Card><div className="detail-grid"><Card><div className="card-head"><div><h2>Activity timeline</h2><p>Audited application changes</p></div></div><div className="timeline">{application.events?.map((e, i) => <Timeline key={e.id} title={e.message} text={`${e.type} · ${e.actor.name}`} time={new Date(e.createdAt).toLocaleString()} tone={i === 0 ? 'violet' : 'slate'}/>)}</div></Card><Card><h2>Applicant profile</h2><dl><div><dt>Phone</dt><dd>{application.primaryPhone}</dd></div><div><dt>OTP receiver</dt><dd>{application.otpReceiverPhone}</dd></div><div><dt>Visa type</dt><dd>{application.preference?.visaType ?? '—'}</dd></div><div><dt>Document</dt><dd>{application.documents[0] ? <><FileText size={15}/>{application.documents[0].originalFilename}</> : 'Not uploaded'}</dd></div></dl></Card></div></> }
function Timeline({ title, text, time, tone }: { title: string; text: string; time: string; tone: string }) { return <div className="timeline-item"><span className={`timeline-dot ${tone}`}/><div><b>{title}</b><p>{text}</p></div><time>{time}</time></div> }
function SmsPage() {
  const [messages, setMessages] = useState<import('./api').Sms[]>([])
  const [collectors, setCollectors] = useState<import('./api').Collector[]>([])
  const [error, setError] = useState('')
  const [pairingNotice, setPairingNotice] = useState('')
  const load = () => Promise.all([api.sms(), api.collectors()]).then(([s, c]) => {
    setMessages(s.data); setCollectors(c.data); setError('')
  }).catch(e => setError(e.message))

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])

  const backendDefault = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api').replace(/\/api$/, '')
  const validateBackendUrl = (value: string) => {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Backend URL must use HTTP or HTTPS')
  }
  const showPairing = (result: import('./api').CollectorPairing) => {
    setPairingNotice(`Pairing code: ${result.pairingCode}. Enter it once in the Android collector before ${new Date(result.expiresAt).toLocaleTimeString()}. It will not be shown again.`)
  }
  const addCollector = async () => {
    const deviceName = window.prompt('Collector/device name:')?.trim()
    const phoneNumber = window.prompt('Receiving phone number:')?.trim()
    const backendUrl = window.prompt('Backend URL for the Android device:', backendDefault)?.trim()
    if (!deviceName || !phoneNumber || !backendUrl) return
    try {
      validateBackendUrl(backendUrl)
      const result = await api.createCollectorPairing({ deviceName, phoneNumber, backendUrl })
      showPairing(result); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create collector pairing') }
  }
  const regenerate = async (collector: import('./api').Collector) => {
    if (!window.confirm(`Generate a new one-time pairing code for ${collector.deviceName}? This rotates its collector credential; the previous phone must be paired again.`)) return
    const backendUrl = window.prompt('Backend URL for the Android device:', backendDefault)?.trim()
    if (!backendUrl) return
    try {
      validateBackendUrl(backendUrl)
      showPairing(await api.regenerateCollectorPairing(collector.id, backendUrl)); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to regenerate pairing code') }
  }
  const setStatus = async (collector: import('./api').Collector, action: 'enable' | 'disable') => {
    try { await api.setCollectorStatus(collector.id, action); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update collector') }
  }
  const review = async (id: string) => {
    const applicationId = window.prompt('Enter the active application ID to assign this protected SMS:')
    if (!applicationId) return
    try { await api.assignSms(id, applicationId); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Assignment failed') }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">SMS COLLECTOR · POLLING EVERY 15S</p><h1>SMS & OTP</h1><p className="muted">Incoming messages are redacted; OTP values are never exposed here.</p></div><button className="primary" onClick={addCollector}><Plus size={17}/> Add collector</button></div>
    {pairingNotice && <p className="safety-note">{pairingNotice}</p>}
    <div className="kpi-grid">{collectors.map(c => <Card key={c.id}><div className="kpi-label"><span>{c.deviceName}</span><span className={`dot ${c.status === 'ONLINE' ? 'mint' : c.status === 'DEGRADED' ? 'amber' : 'rose'}`}/></div><strong className="kpi-value">{c.status}</strong><small>Receiving {c.phoneNumber}</small><small>Heartbeat {c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt).toLocaleTimeString() : 'never'}</small><div><button className="quiet" onClick={() => regenerate(c)}>Pair</button>{' · '}<button className="quiet" onClick={() => setStatus(c, c.status === 'DISABLED' ? 'enable' : 'disable')}>{c.status === 'DISABLED' ? 'Re-enable' : 'Disable'}</button></div></Card>)}</div>
    <Card className="recent-card"><div className="card-head"><div><h2>Received messages</h2><p>Protected collector feed — OTP content is masked.</p></div></div>{error ? <p className="safety-note">{error}</p> : <div className="table-wrap"><table><thead><tr><th>RECEIVED</th><th>RECEIVER</th><th>SENDER</th><th>OTP</th><th>MATCHED APPLICANT</th><th>JOB</th><th>STATUS</th><th>COLLECTOR</th></tr></thead><tbody>{messages.map(m => <tr key={m.id}><td>{new Date(m.receivedAt).toLocaleString()}</td><td>{m.receiverNumber}</td><td>{m.senderNumber}</td><td>{m.detectedOtp ?? '—'}{m.otpStatus ? ` · ${m.otpStatus}` : ''}</td><td>{m.matchedApplication ? `${m.matchedApplication.fullName} · ${m.matchedApplication.webfileNumber}` : <button className="quiet" onClick={() => review(m.id)}>Assign</button>}</td><td>{m.jobId ? m.jobId.slice(-8) : '—'}</td><td><Badge tone={m.status === 'MATCHED' ? 'mint' : m.status === 'NEEDS_REVIEW' ? 'amber' : m.status === 'EXPIRED' ? 'rose' : 'slate'}>{m.status}</Badge></td><td>{m.collector.deviceName}</td></tr>)}</tbody></table></div>}</Card>
  </>
}
function PaymentPage(){const [jobs,setJobs]=useState<any[]>([]),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');const load=()=>api.jobs().then(x=>setJobs(x.data)).catch(e=>setNotice(e.message));useEffect(()=>{load()},[]);const send=async(job:any,type:string,confirm=false)=>{if(confirm&&!window.confirm(type==='mark-payment-completed'?'Confirm that payment was completed manually?':'Confirm that payment failed manually?'))return;setBusy(`${job.id}:${type}`);try{const command=await api.command(job.id,type);let status=command.status;for(let i=0;i<20&&['PENDING','CLAIMED'].includes(status);i++){await new Promise(r=>setTimeout(r,1000));status=(await api.commandStatus(job.id,command.id)).status}if(status!=='COMPLETED')throw new Error('Command could not be completed');setNotice(type==='focus-payment'?'Payment window opened':type==='mark-payment-completed'?'Manual payment completed':'Browser session closed');load()}catch(e){setNotice(e instanceof Error?e.message:'Command failed')}finally{setBusy('')}};const payment=jobs.filter(j=>['PAYMENT_READY','COMPLETED','FAILED'].includes(j.state));return <><div className="page-head"><div><p className="eyebrow">MANUAL OPERATOR HANDOFF</p><h1>Payments</h1><p className="muted">Payment is always handled manually in the retained browser session.</p></div></div>{notice&&<p className="safety-note">{notice}</p>}<div className="placeholder-grid">{payment.map(j=><Card key={j.id}><Badge tone={j.state==='PAYMENT_READY'?'violet':'slate'}>{j.state==='PAYMENT_READY'?'Payment Ready':j.state}</Badge><h2>{j.application.fullName}</h2><p>Appointment: {j.application.webfileNumber}<br/>Provider: DGePay when opened manually<br/>Ready: {new Date(j.updatedAt).toLocaleString()}</p>{j.state==='PAYMENT_READY'&&<><button className="primary full" disabled={!!busy} onClick={()=>send(j,'focus-payment')}>OPEN PAYMENT</button><button className="secondary full" disabled={!!busy} onClick={()=>send(j,'mark-payment-completed',true)}>MARK COMPLETED</button><button className="quiet full" disabled={!!busy} onClick={()=>send(j,'mark-payment-failed',true)}>MARK FAILED</button></>}{['COMPLETED','FAILED'].includes(j.state)&&<button className="secondary full" disabled={!!busy} onClick={()=>send(j,'cleanup-session')}>CLOSE SESSION</button>}</Card>)}</div></>}
function Placeholder({ title }: { title: Page }) { const isPayments = title === 'Payments'; const isSms = title === 'SMS & OTP'; return <><div className="page-head"><div><p className="eyebrow">{isSms ? 'SMS COLLECTOR' : isPayments ? 'MANUAL HANDOFF' : 'COMING IN PHASE 1'}</p><h1>{isPayments ? 'Payment ready' : title}</h1><p className="muted">{isSms ? 'A safe, observed gateway for one-time codes.' : isPayments ? 'Jobs stop here. Payment is always completed manually.' : 'This operational surface is ready for backend wiring.'}</p></div></div><div className="placeholder-grid"><Card><div className="empty-icon">{isSms ? <Bell/> : isPayments ? <CalendarDays/> : <Activity/>}</div><h2>{isSms ? 'SMS & OTP collector' : isPayments ? 'Manual payment boundary' : 'Interface foundation'}</h2><p>{isSms ? 'Inbound SMS, matching history, and OTP delivery states will appear here. No codes are displayed in this mock interface.' : isPayments ? 'When a job reaches the payment gateway, its manual handoff will be recorded here. The worker never submits a payment.' : 'Use the navigation to explore the finished core UI screens.'}</p><Badge tone="violet">MOCK · PHASE 1</Badge></Card><Card><h2>System health</h2><Health name="Secure backend" value="Planned" tone="slate"/><Health name="Worker channel" value="Inactive" tone="slate"/><Health name="Audit event stream" value="Mock" tone="violet"/></Card></div></> }
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
  return <><div className="page-head"><div><p className="eyebrow">LIVE OPERATIONS</p><h1>Dashboard</h1><p className="muted">Current automation job status from the protected API.</p></div><button className="primary" onClick={() => onNavigate('Create Application')}><Plus size={17}/> New application</button></div>{error && <p className="safety-note">{error}</p>}<div className="kpi-grid">{counters.map(([title, value, tone]) => <Card key={String(title)}><div className="kpi-label"><span>{title}</span><span className={`dot ${tone}`}/></div><strong className="kpi-value">{value}</strong><small>Live job count</small></Card>)}</div><Card className="activity-card"><div className="card-head"><div><h2>Recent automation jobs</h2><p>Updated every 10 seconds.</p></div><button className="quiet" onClick={() => onNavigate('Live Operations')}>View all <ArrowRight size={15}/></button></div>{jobs.slice(0, 5).map(job => <div className="job-row" key={job.id}><Avatar initials={job.application.fullName.split(' ').map(part => part[0]).slice(0, 2).join('')}/><div className="job-name"><b>{job.application.fullName}</b><span>{job.application.webfileNumber} · {job.id}</span></div><Badge tone={jobTone(job.state)}>{job.state}</Badge><time>{new Date(job.updatedAt).toLocaleTimeString()}</time></div>)}</Card></>
}

function LiveOperations({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { jobs, error } = useJobs()
  return <><div className="page-head"><div><p className="eyebrow">REAL-TIME · PROTECTED API</p><h1>Live operations</h1><p className="muted">Automation jobs are refreshed every 10 seconds.</p></div><div className="live-pill"><span/> Live</div></div>{error && <p className="safety-note">{error}</p>}<Card className="ops-table">{jobs.length === 0 ? <p className="muted">No automation jobs queued.</p> : jobs.map(job => <button className="operation" key={job.id} onClick={() => onNavigate('Applications')}><Avatar initials={job.application.fullName.split(' ').map(part => part[0]).slice(0, 2).join('')}/><div><b>{job.application.fullName}</b><span>{job.application.webfileNumber} · {job.id}</span></div><Badge tone={jobTone(job.state)}>{job.state}</Badge><span className="op-step">{job.worker ? job.worker.workerName : 'Waiting for worker'}</span><time>{new Date(job.updatedAt).toLocaleString()}</time></button>)}</Card></>
}

function AutomationStartPanel({ applicationId }: { applicationId: string }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'queued' | 'error'>('idle')
  const [message, setMessage] = useState('')
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
  return <Card><div className="card-head"><div><h2>Automation</h2><p>Queues one isolated worker job for this application.</p></div></div>{message && <p className="safety-note">{message}</p>}<button className="primary" disabled={state === 'submitting' || state === 'queued'} onClick={start}>{state === 'submitting' ? 'Queueing…' : state === 'queued' ? 'Automation queued' : 'Start automation'}</button></Card>
}

createRoot(document.getElementById('app')!).render(<App />)
