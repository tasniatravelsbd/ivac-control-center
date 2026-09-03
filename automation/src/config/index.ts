import 'dotenv/config'
export const config = { apiUrl: process.env.INTERNAL_API_URL ?? 'http://localhost:4000/internal', name: process.env.WORKER_NAME ?? 'local-fixture-worker', key: process.env.WORKER_API_KEY ?? '', fixtureBaseUrl: process.env.FIXTURE_BASE_URL ?? 'http://127.0.0.1:4174' }
