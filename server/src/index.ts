import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { ZodError } from 'zod'
import { env } from './config.js'
import { requireAuth } from './auth.js'
import { router } from './routes.js'
import { internal } from './internal-routes.js'
import { ensureDocumentStorageReady } from './document-storage.js'

export function createApp() {
const app = express()
const allowedFrontendOrigins = new Set([
  env.FRONTEND_ORIGIN,
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])
app.disable('x-powered-by'); app.use(helmet({ crossOriginResourcePolicy: false })); app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedFrontendOrigins.has(origin)), methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] })); app.use(express.json({ limit: '1mb' }))
app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/internal', internal)
app.use('/api', (req, res, next) => ['/auth/login', '/collectors/register', '/collectors/pair', '/collectors/heartbeat', '/sms'].includes(req.path) ? next() : requireAuth(req, res, next), router)
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (error instanceof ZodError) return res.status(422).json({ error: 'Validation failed', fields: error.flatten() }); const status = typeof error === 'object' && error && 'status' in error ? Number((error as any).status) : 500; if (status >= 500) console.error('Unhandled request error', error instanceof Error ? error.message : 'unknown'); res.status(status).json({ error: status === 500 ? 'Internal server error' : (error as Error).message }) })
return app
}
const app = createApp()
if (process.env.NODE_ENV !== 'test') void ensureDocumentStorageReady().then(() => app.listen(env.PORT, () => console.info(`IVAC API listening on ${env.PORT}`))).catch(() => { console.error('Document storage is unavailable; API startup aborted'); process.exit(1) })
