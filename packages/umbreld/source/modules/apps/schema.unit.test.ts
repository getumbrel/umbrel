import {describe, expect, test} from 'vitest'

import {
	APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH,
	APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH,
	AppManifestEnvironmentVariableSchema,
	AppManifestFolderAccessSchema,
	validateManifest,
} from './schema.ts'

describe('app storage manifest compatibility', () => {
	test('allows a version 1 manifest to opt into the data-root capability', () => {
		expect(validateManifest({manifestVersion: 1, storage: {dataRoot: 'data'}})).toMatchObject({
			manifestVersion: '1.0.0',
			storage: {dataRoot: 'data'},
		})
	})

	test('rejects unknown storage contracts instead of silently ignoring them', () => {
		expect(() => validateManifest({manifestVersion: 1, storage: {dataRoot: 'other'}})).toThrow(
			'invalid manifest storage',
		)
		expect(() => validateManifest({manifestVersion: 1, storage: {dataRoot: 'data', nestedPaths: true}})).toThrow(
			'invalid manifest storage',
		)
	})
})

describe('app folder access manifest', () => {
	test('maps one friendly folder choice to multiple service mounts', () => {
		expect(
			AppManifestFolderAccessSchema.parse({
				id: 'downloads',
				name: 'Downloads',
				note: 'This folder will be used to store downloaded files.',
				mounts: [
					{service: 'server', targetPath: '/downloads'},
					{service: 'worker', targetPath: '/downloads', readOnly: true},
				],
			}),
		).toMatchObject({
			id: 'downloads',
			note: 'This folder will be used to store downloaded files.',
			mounts: [
				{service: 'server', targetPath: '/downloads'},
				{service: 'worker', targetPath: '/downloads', readOnly: true},
			],
		})
	})

	test('bounds developer notes without dropping the folder', () => {
		const folder = AppManifestFolderAccessSchema.parse({
			id: 'downloads',
			name: 'Downloads',
			note: 'x'.repeat(APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH + 100),
			mounts: [{service: 'server', targetPath: '/downloads'}],
		})

		expect(folder.note).toHaveLength(APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH)
		expect(folder.note).toBe(`${'x'.repeat(APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH - 1)}…`)
	})

	test('allows the UI to provide generic copy when a developer note is absent', () => {
		const withoutNote = AppManifestFolderAccessSchema.parse({
			id: 'downloads',
			name: 'Downloads',
			mounts: [{service: 'server', targetPath: '/downloads'}],
		})
		const blankNote = AppManifestFolderAccessSchema.parse({
			id: 'downloads',
			name: 'Downloads',
			note: '   ',
			mounts: [{service: 'server', targetPath: '/downloads'}],
		})

		expect(withoutNote.note).toBeUndefined()
		expect(blankNote.note).toBeUndefined()
	})
})

describe('app environment manifest', () => {
	test('requires developers to target at least one service', () => {
		expect(
			AppManifestEnvironmentVariableSchema.parse({name: 'PUID', services: ['server'], default: 1000}),
		).toStrictEqual({name: 'PUID', services: ['server'], default: '1000'})
		expect(() => AppManifestEnvironmentVariableSchema.parse({name: 'PUID', services: []})).toThrow()
		expect(() => AppManifestEnvironmentVariableSchema.parse({name: 'PUID'})).toThrow()
	})

	test('accepts a unique list of predefined values', () => {
		expect(
			AppManifestEnvironmentVariableSchema.parse({
				name: 'GPU_ACCELERATOR',
				services: ['server'],
				default: 'auto',
				options: ['auto', 'cuda', 'rocm', 'intel', 1, true],
			}),
		).toStrictEqual({
			name: 'GPU_ACCELERATOR',
			services: ['server'],
			default: 'auto',
			options: ['auto', 'cuda', 'rocm', 'intel', '1', 'true'],
		})
		expect(() =>
			AppManifestEnvironmentVariableSchema.parse({
				name: 'GPU_ACCELERATOR',
				services: ['server'],
				options: [],
			}),
		).toThrow()
		expect(() =>
			AppManifestEnvironmentVariableSchema.parse({
				name: 'GPU_ACCELERATOR',
				services: ['server'],
				options: ['1', 1],
			}),
		).toThrow('environment options must be unique')
	})

	test('bounds developer notes without dropping the variable', () => {
		const variable = AppManifestEnvironmentVariableSchema.parse({
			name: 'PUID',
			services: ['server'],
			note: 'x'.repeat(APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH + 100),
		})

		expect(variable.note).toHaveLength(APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH)
		expect(variable.note).toBe(`${'x'.repeat(APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH - 1)}…`)
		expect(AppManifestEnvironmentVariableSchema.parse({name: 'PGID', services: ['server'], note: '   '})).toStrictEqual(
			{name: 'PGID', services: ['server'], note: undefined},
		)
	})
})
