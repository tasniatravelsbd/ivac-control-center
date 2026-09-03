# IVAC Control Center deployment

## Architecture

The frontend is React/Vite at the repository root. `server/` is the Node/Express API with MySQL/Prisma. `automation/` is the Node/Playwright worker. BGDR PDFs live in private backend storage.

## Prerequisites

- A supported Node.js/npm runtime compatible with the project dependencies.
- MySQL reachable through `DATABASE_URL`.
- Persistent disk for private document storage.
- Playwright Chromium for the worker.
- A reverse proxy/static web server for the built frontend when deployed.

## Install and configure

```sh
npm install
cd server && npm install
cd ../automation && npm install && npm run install:browsers
```

Create `server/.env` from `server/.env.example`. Set `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `JWT_SECRET`, `DOCUMENT_STORAGE_PATH`, `FRONTEND_ORIGIN`, and worker registration credentials. Create `automation/.env` from its example and set `INTERNAL_API_URL`, `WORKER_NAME`, `WORKER_API_KEY`, `IVAC_BASE_URL`, and timing settings. Never commit either file.

## Database and storage

```sh
cd server
npm run prisma:generate
npm run prisma:deploy
```

`DOCUMENT_STORAGE_PATH` must be private, persistent across deployments, and writable by the backend service account. Do not serve it as static web content.

## Build and start

Start services in this order: MySQL, backend, worker, then the frontend/static server.

```sh
cd server && npm run build && npm run start
cd automation && npm run build && npm run start
cd .. && npm run build && npm run preview
```

The API health endpoint is `GET /health`. Use the existing worker heartbeat/worker-health API to verify worker availability.

## Operations

Shutdown the worker gracefully so it closes active contexts. Browser sessions are in memory: after a restart affected jobs may become `SESSION_LOST` or `NEEDS_ATTENTION`; do not assume authenticated sessions survive.

`VERIFICATION_REQUIRED` requires a human to complete verification. `WAITING_FOR_OTP` waits for the collector. `NO_AVAILABLE_DATE` means no configured date is available. `PAYMENT_READY` hands the retained session to an operator for manual payment. `FAILED` requires review. CAPTCHA/Turnstile/Cloudflare bypasses and automated payment are not supported.
