import 'dotenv/config'
import { z } from 'zod'
import path from 'node:path'

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  APP_ENCRYPTION_KEY: z.string().regex(/^base64:/, 'must use base64: prefix'),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  OTP_MATCH_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(600),
  DOCUMENT_MAX_SIZE_MB: z.coerce.number().positive().default(10),
  DOCUMENT_STORAGE_PATH: z.string().min(1).default('./storage/documents')
})
const parsed = configSchema.parse(process.env)
export const env = { ...parsed, DOCUMENT_STORAGE_PATH: path.resolve(process.cwd(), parsed.DOCUMENT_STORAGE_PATH) }
