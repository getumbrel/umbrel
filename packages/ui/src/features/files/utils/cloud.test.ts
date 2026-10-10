// @vitest-environment jsdom
import {describe, expect, test} from 'vitest'

import {isValidCloudDestination, isValidCloudDestinationParent} from './cloud'

describe('cloud destination parents', () => {
	test('accepts Home paths at any depth', () => {
		expect(isValidCloudDestinationParent('/Home')).toBe(true)
		expect(isValidCloudDestinationParent('/Home/Photos')).toBe(true)
		expect(isValidCloudDestinationParent('/Users/member-1/Photos', '/Users/member-1')).toBe(true)
	})

	test('requires a volume below /External and a share below /Network', () => {
		expect(isValidCloudDestinationParent('/External')).toBe(false)
		expect(isValidCloudDestinationParent('/External/USB')).toBe(true)
		expect(isValidCloudDestinationParent('/Network')).toBe(false)
		expect(isValidCloudDestinationParent('/Network/nas.local')).toBe(false)
		expect(isValidCloudDestinationParent('/Network/nas.local/Media')).toBe(true)
	})

	test('requires an array below /Raid', () => {
		expect(isValidCloudDestinationParent('/Raid')).toBe(false)
		expect(isValidCloudDestinationParent('/Raid/umbrel-md')).toBe(true)
		expect(isValidCloudDestinationParent('/Raid/umbrel-md/Photos')).toBe(true)
	})

	test('rejects non-destination roots', () => {
		expect(isValidCloudDestinationParent('/Apps')).toBe(false)
		expect(isValidCloudDestinationParent('/Trash')).toBe(false)
	})

	test('a destination is a path whose parent is valid', () => {
		expect(isValidCloudDestination('/Raid/umbrel-md/Photos')).toBe(true)
		expect(isValidCloudDestination('/Raid/umbrel-md')).toBe(false)
	})
})
