# IVAC Control Center — local operations runbook

This runbook covers the loopback-only local stack. It does not validate the live IVAC site, bypass CAPTCHA/Turnstile, or automate payment.

## Architecture and ports

| Service | Local address |
| --- | --- |
| MySQL | `127.0.0.1:3306` |
| Backend API | `http://127.0.0.1:4000` |
| Local IVAC fixture | `http://127.0.0.1:4174` |
| Frontend | `http://127.0.0.1:5173` |
| Worker | connects to the backend internal API |

## Install and environment

Run `npm install` at the repository root, then in `server/`, and then in `automation/`. Install Chromium with `cd automation; npm run install:browsers`.

Create uncommitted local files with `Copy-Item server/.env.example server/.env` and `Copy-Item automation/.env.example automation/.env`.

`server/.env` requires `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `JWT_SECRET`, `PORT`, `FRONTEND_ORIGIN`, `DOCUMENT_STORAGE_PATH`, `DOCUMENT_MAX_SIZE_MB`, `OTP_MATCH_TTL_SECONDS`, and `INTERNAL_WORKER_REGISTRATION_SECRET`. Use placeholders only; `DOCUMENT_STORAGE_PATH` must be private, persistent, writable by the backend, and never served statically.

`automation/.env` requires `INTERNAL_API_URL`, `WORKER_NAME`, `WORKER_API_KEY`, `FIXTURE_BASE_URL`, `IVAC_BASE_URL`, `WORKER_HEADLESS`, `OTP_WAIT_TIMEOUT_MS`, `WORKER_MAX_RETRIES`, and `SESSION_TTL_MS`. For local work, both IVAC URLs must use `http://127.0.0.1:4174`. `start-worker.ps1` refuses non-loopback targets.

Provision a worker only through the protected `POST /internal/workers/register` flow using `INTERNAL_WORKER_REGISTRATION_SECRET`; store the returned key only in `automation/.env`. Collector pairing has no separate environment secret beyond the backend encryption configuration.

## Database

After MySQL is running, from `server/` run `npx prisma validate`, `npm run prisma:generate`, `npm run prisma:deploy`, and `npx prisma migrate status`. Do not use `prisma migrate reset` or `prisma db push` for normal startup.

## Start order

Start each command in a visible PowerShell terminal after MySQL is running:

1. `./start-backend.ps1`
2. `./start-fixture.ps1`
3. `./start-worker.ps1`
4. `./start-frontend.ps1`

`./start-local-stack.ps1` opens those four services in separate visible terminals. It does not start MySQL for you and does not hide failures.

## Health check

Run `./check-local-health.ps1 -OperatorToken $env:IVAC_ACCESS_TOKEN`. The optional token authorizes the protected worker-health check. Without it the script still checks MySQL TCP availability, backend `/health`, frontend reachability, and the local fixture, then clearly reports worker health as skipped.

## Known-green verification

From `server/`: `npx prisma validate`, `npx prisma migrate status`, `npm run build`.

From `automation/`: `npm run build`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run tests/workflow-orchestrator.test.ts`, and `npx playwright test tests/fixtures.spec.ts`.

From repository root: `npm run build`.

The fixture suite is local-only and must not navigate to `appointment.ivacbd.com`.

## Android SMS Collector

Android source is in `android-sms-collector/`. It captures only incoming SMS after permission, queues it locally, and pairs using a one-time backend code. It does not collect contacts, calls, files, browser data, or payment data.

When Android SDK and Gradle tooling are installed, run `cd android-sms-collector; gradlew.bat :app:assembleDebug`. Expected output: `app/build/outputs/apk/debug/app-debug.apk`.

## Live validation status

Phase 14 live IVAC validation is pending. Current live selectors are not production-certified; the observed booking-hours/login notice blocks further validation. CAPTCHA/Turnstile must remain manual. Payment remains a manual operator handoff after `PAYMENT_READY`.

Retained browser sessions are in memory. After worker restart, affected jobs can become `SESSION_LOST` or `NEEDS_ATTENTION` and require operator review.
