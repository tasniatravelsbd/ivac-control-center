import { startLocalIvacFixture } from './local-ivac-fixture.js'

const port = Number(process.env.FIXTURE_PORT ?? 4174)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('FIXTURE_PORT must be a valid TCP port')
}

const fixture = await startLocalIvacFixture('happy-path', { port })
console.info(`Local IVAC fixture listening at ${fixture.url}`)

const close = () => fixture.close().finally(() => process.exit(0))
process.once('SIGINT', close)
process.once('SIGTERM', close)
