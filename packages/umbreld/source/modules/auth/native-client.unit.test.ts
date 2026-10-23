import {describe, expect, test} from 'vitest'

import {nativeClientSchema} from './native-client.ts'

const client = {
	id: 'umbrel',
	platform: 'ios',
	deviceClass: 'phone',
	appVersion: '0.1',
	appBuild: '20',
	osVersion: '26.6.1',
}

describe('native client metadata', () => {
	test('accepts future clients without a server-side catalog entry', () => {
		expect(
			nativeClientSchema.parse({
				...client,
				id: 'example-linux',
				platform: 'linux',
				deviceClass: 'laptop',
			}),
		).toMatchObject({id: 'example-linux', platform: 'linux', deviceClass: 'laptop'})
	})

	test('bounds and normalizes display-only metadata', () => {
		expect(nativeClientSchema.parse({...client, platform: '  ios  '})).toMatchObject({platform: 'ios'})
		expect(() => nativeClientSchema.parse({...client, id: 'Not a slug'})).toThrow()
		expect(() => nativeClientSchema.parse({...client, appVersion: '1.0\nspoofed'})).toThrow()
		expect(() => nativeClientSchema.parse({...client, osVersion: 'x'.repeat(65)})).toThrow()
	})
})
