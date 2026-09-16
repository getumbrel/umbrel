import {describe, expect, test} from 'vitest'

import {getNativeTlsPolicy, matchesNativeTlsHostname, NativeTlsHostnameSuffixesSchema} from './native-tls.js'

describe('native TLS hostname policy', () => {
	test('normalizes and deduplicates DNS suffixes', () => {
		expect(NativeTlsHostnameSuffixesSchema.parse(['PLEX.direct', 'plex.direct', 'native.example'])).toEqual([
			'native.example',
			'plex.direct',
		])
	})

	test.each([
		'*.plex.direct',
		'https://plex.direct',
		'plex.direct:32400',
		' plex.direct',
		'plex.direct.',
		'127.0.0.1',
		'::1',
		'localhost',
		'.example',
		'a..example',
		'-a.example',
		'a-.example',
		'bad_name.example',
		'bad name.example',
		'bad\u0000name.example',
		'é.example',
		`${'a'.repeat(64)}.example`,
		`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
	])('rejects the entire optional policy for invalid suffix %s', (suffix) => {
		expect(getNativeTlsPolicy(['valid.example', suffix], {web: {}}, [])).toBeUndefined()
	})

	test('invalid metadata shapes disable the optional policy', () => {
		for (const metadata of [null, false, 'plex.direct', {}, []]) {
			expect(getNativeTlsPolicy(metadata, {web: {}}, [])).toBeUndefined()
		}
	})

	const policy = {
		hostnameSuffixes: ['plex.direct', 'example.local', 'native.example'],
		reservedHostnames: ['device.native.example'],
	}
	test.each(['plex.direct', 'PLEX.DIRECT', '192-168-1-100.server-id.plex.direct'])('matches %s', (hostname) => {
		expect(matchesNativeTlsHostname(hostname, policy)).toBe(true)
	})
	test.each([
		undefined,
		'evilplex.direct',
		'plex.direct.attacker.example',
		'plex.direct.',
		'device.native.example',
		'a.example.local',
		'localhost',
		'a.localhost',
		'é.plex.direct',
	])('keeps %s on Umbrel TLS', (hostname) => {
		expect(matchesNativeTlsHostname(hostname, policy)).toBe(false)
	})
})
