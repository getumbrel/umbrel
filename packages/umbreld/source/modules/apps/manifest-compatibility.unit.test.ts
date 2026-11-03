import {describe, expect, test} from 'vitest'

import {assertManifestVersionCompatible, isManifestVersionCompatible} from './manifest-compatibility.ts'

describe('isManifestVersionCompatible()', () => {
	test.each([
		{manifestVersion: '1.0.0', umbrelVersion: '1.7.3', compatible: true},
		{manifestVersion: '2.0.0', umbrelVersion: '2.0.0', compatible: true},
		{manifestVersion: '2.0.0', umbrelVersion: '2.0.0-beta.1', compatible: true},
		{manifestVersion: '2.0.0', umbrelVersion: '2.0.0-rc.2+build.5', compatible: true},
		{manifestVersion: '2.0.0', umbrelVersion: '1.9.9', compatible: false},
		{manifestVersion: '2.0.1', umbrelVersion: '2.0.0-beta.1', compatible: false},
		{manifestVersion: '2.1.0', umbrelVersion: '2.0.0-beta.1', compatible: false},
		{manifestVersion: 'invalid', umbrelVersion: '2.0.0', compatible: false},
		{manifestVersion: '2.0.0', umbrelVersion: 'invalid', compatible: false},
	])('$umbrelVersion supports $manifestVersion: $compatible', ({manifestVersion, umbrelVersion, compatible}) => {
		expect(isManifestVersionCompatible(manifestVersion, umbrelVersion)).toBe(compatible)
	})
})

describe('assertManifestVersionCompatible()', () => {
	test('distinguishes invalid manifest versions from unsupported versions', () => {
		expect(() => assertManifestVersionCompatible('invalid', '2.0.0')).toThrow('App manifest version is invalid')
		expect(() => assertManifestVersionCompatible('2.0.0', '1.9.9')).toThrow('App manifest version not supported')
	})
})
