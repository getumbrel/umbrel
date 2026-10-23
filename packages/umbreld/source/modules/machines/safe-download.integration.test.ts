import {fileURLToPath} from 'node:url'

import {execa} from 'execa'
import {expect, test} from 'vitest'

// Run inside umbrel-dev, like the other integration tests. A separate network
// namespace keeps the fixture addresses and packet delay off the host network.
test.each(['/image', '/redirect'])('downloads over slow IPv4 with unreachable IPv6 at %s', async (path) => {
	const {stdout} = await execa('unshare', [
		'--net',
		process.execPath,
		fileURLToPath(new URL('./fixtures/slow-download.ts', import.meta.url)),
		path,
	])

	const result = JSON.parse(stdout)
	expect(result.defaultFailureCodes).toEqual(['ETIMEDOUT', 'ENETUNREACH', 'ETIMEDOUT', 'ENETUNREACH'])
	expect(result.contents).toBe('slow machine image fixture')
	expect(result.files).toEqual(['image.qcow2'])
})
