import { createServer, type Server } from 'node:http'

export type FixtureMetrics = {
  loginSubmitted: number
  otpSubmitted: number
  documentSelected: number
  missionContinued: number
  dateSelected: number
  continueBooking: number
  productionRequests: string[]
}

const productionHosts = new Set(['appointment.ivacbd.com'])

export type FixtureScenario = 'happy-path'|'verification-required'|'otp-rejected'|'document-rejected'|'mission-unavailable'|'centre-unavailable'|'no-available-date'|'selected-date-disappears'|'continue-booking-timeout'|'session-lost'
export async function startLocalIvacFixture(scenario: FixtureScenario = 'happy-path', options: { port?: number } = {}) {
  const metrics: FixtureMetrics = {
    loginSubmitted: 0, otpSubmitted: 0, documentSelected: 0,
    missionContinued: 0, dateSelected: 0, continueBooking: 0, productionRequests: []
  }
  const html = (body: string, script = '') => `<!doctype html><html><body>${body}<script>${script}</script></body></html>`
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture.local').pathname
    const send = (body: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body) }
    if (path === '/signin') return send(html(
      `<form class="space-y-5"><input name="phone"><input name="password" type="password"><button type="submit">Sign in</button></form>${scenario==='verification-required'?'<div class="cf-turnstile">Verify you are human</div>':''}`,
      "document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();fetch('/__metric/login',{method:'POST'}).finally(()=>location='/verify-login-phone-otp')})"
    ))
    if (path === '/verify-login-phone-otp') return send(html(
      '<h1>Verification code</h1><input name="otp" inputmode="numeric" autocomplete="one-time-code"><button>Verify</button><p id="error"></p>',
      scenario==='otp-rejected'?"document.querySelector('button').onclick=()=>{fetch('/__metric/otp',{method:'POST'});document.querySelector('#error').textContent='Invalid OTP'}":"document.querySelector('button').onclick=()=>fetch('/__metric/otp',{method:'POST'}).finally(()=>location='/appointment/file-upload')"
    ))
    if (path === '/appointment/file-upload') return send(html(
      '<h1>Appointment application</h1><p>Applicant summary</p><input type="file" accept="application/pdf"><p id="upload"></p><button disabled>Confirm All Information is Correct</button>',
      scenario==='document-rejected'?"const input=document.querySelector('input');input.onchange=()=>{document.querySelector('#upload').textContent='Upload failed: rejected';fetch('/__metric/document',{method:'POST'})}":"const input=document.querySelector('input');const button=document.querySelector('button');input.onchange=()=>{document.querySelector('#upload').textContent='File selected - upload complete';button.disabled=false;fetch('/__metric/document',{method:'POST'})};button.onclick=()=>location='/appointment/mission'"
    ))
    if (path === '/appointment/mission') return send(html(
      `<label>Mission <select name="mission"><option>${scenario==='mission-unavailable'?'France':'Italy'}</option></select></label><label>Centre <select name="centre"><option>${scenario==='centre-unavailable'?'Chittagong':'Dhaka'}</option></select></label><button>Continue</button>`,
      "document.querySelector('button').onclick=()=>fetch('/__metric/mission',{method:'POST'}).finally(()=>location='/appointment/time-slot')"
    ))
    if (path === '/appointment/time-slot') return send(html(
      `<h2 role="heading">September 2026</h2><section role="grid" data-calendar data-slot><button data-date="2026-09-02" aria-disabled="true" disabled>2</button><button data-date="2026-09-03" ${scenario==='no-available-date'||scenario==='selected-date-disappears'?'aria-disabled="true" disabled':''}>3</button></section><p class="selected-date" aria-live="polite"></p><button id="continue" disabled>Continue Booking</button>`,
      scenario==='continue-booking-timeout'?"const d=document.querySelector('[data-date=\"2026-09-03\"]');const c=document.querySelector('#continue');d.onclick=()=>{d.setAttribute('aria-selected','true');c.disabled=false;fetch('/__metric/date',{method:'POST'})};c.onclick=()=>fetch('/__metric/booking',{method:'POST'})":"const d=document.querySelector('[data-date=\"2026-09-03\"]');const c=document.querySelector('#continue');d.onclick=()=>{d.setAttribute('aria-selected','true');document.querySelector('.selected-date').textContent='2026-09-03';c.disabled=false;fetch('/__metric/date',{method:'POST'})};c.onclick=()=>fetch('/__metric/booking',{method:'POST'}).finally(()=>location='/appointment/continue-payment')"
    ))
    if (path === '/appointment/continue-payment') return send(html(
      '<h1>Payment Summary</h1><p>Invoice: FIXTURE-2026</p><button>Continue payment</button>'
    ))
    if (path.startsWith('/__metric/')) {
      const key = path.split('/').pop()
      if (key === 'login') metrics.loginSubmitted++
      if (key === 'otp') metrics.otpSubmitted++
      if (key === 'document') metrics.documentSelected++
      if (key === 'mission') metrics.missionContinued++
      if (key === 'date') metrics.dateSelected++
      if (key === 'booking') metrics.continueBooking++
      res.writeHead(204); return res.end()
    }
    res.writeHead(404); res.end('fixture route not found')
  })
  await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}`,
    metrics,
    assertSafeUrl(value: string) { if (productionHosts.has(new URL(value).host)) throw new Error('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION') },
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}
