import {Buffer} from 'node:buffer'
import {appendFileSync, existsSync} from 'node:fs'
import process from 'node:process'

import CloudWebDavFixture from './cloud-webdav-fixture.ts'
import {
	VM_CLOUD_FIXTURE_ROOT,
	VM_CLOUD_WEBDAV_MUTATION_LOG,
	VM_CLOUD_WEBDAV_PASSWORD,
	VM_CLOUD_WEBDAV_PORT,
	VM_CLOUD_WEBDAV_RELEASE_PATH,
	VM_CLOUD_WEBDAV_USERNAME,
} from './cloud.vm-test-helpers.ts'

type Stall = {path: string; afterBytes: number}

const encodedStall = process.argv[2]
const stall =
	encodedStall && encodedStall !== '-'
		? (JSON.parse(Buffer.from(encodedStall, 'base64').toString()) as Stall)
		: undefined
const tlsMode = process.argv[3] ?? 'plain'
if (!['plain', 'tls'].includes(tlsMode)) throw new Error('[invalid-fixture-tls-mode]')
if (stall && (!stall.path.startsWith('/') || !Number.isInteger(stall.afterBytes) || stall.afterBytes < 1)) {
	throw new Error('[invalid-fixture-stall]')
}

const fixture = new CloudWebDavFixture(VM_CLOUD_FIXTURE_ROOT)
fixture.setCredentials(VM_CLOUD_WEBDAV_USERNAME, VM_CLOUD_WEBDAV_PASSWORD)
// Persist mutating requests across fixture restarts so suites can assert the
// source was never written to over their whole lifetime.
fixture.onMutatingRequest = (request) => appendFileSync(VM_CLOUD_WEBDAV_MUTATION_LOG, `${JSON.stringify(request)}\n`)
if (stall) {
	fixture.setReadBehavior(stall.path, {stallAfterBytes: stall.afterBytes})
	const releaseTimer = setInterval(() => {
		if (!existsSync(VM_CLOUD_WEBDAV_RELEASE_PATH)) return
		fixture.setReadBehavior(stall.path)
		clearInterval(releaseTimer)
	}, 25)
	releaseTimer.unref()
}
await fixture.start({port: VM_CLOUD_WEBDAV_PORT, tls: tlsMode === 'tls'})
