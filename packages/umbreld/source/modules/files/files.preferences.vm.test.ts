import {expect, beforeAll, afterAll, beforeEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

const defaultPreferences = {
	view: 'list',
	sortBy: 'name',
	sortOrder: 'ascending',
} as const

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe('viewPreferences()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.viewPreferences.query()).rejects.toThrow('Invalid token')
	})

	// This runs before anything mutates preferences so it sees pristine state
	test('returns default view preferences on first start', async () => {
		const viewPreferences = await umbreld.client.files.viewPreferences.query()
		expect(viewPreferences).toStrictEqual(defaultPreferences)
	})
})

describe('updateViewPreferences()', () => {
	// Reset to default state through the API before each test
	beforeEach(async () => {
		await umbreld.client.files.updateViewPreferences.mutate(defaultPreferences)
	})

	test('throws invalid error without auth token', async () => {
		await expect(
			umbreld.unauthenticatedClient.files.updateViewPreferences.mutate({
				view: 'icons',
			}),
		).rejects.toThrow('Invalid token')
	})

	test('successfully updates view property', async () => {
		const updatedPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			view: 'icons',
		})

		expect(updatedPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'name',
			sortOrder: 'ascending',
		})

		// Verify the update round-trips through the query
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual({
			view: 'icons',
			sortBy: 'name',
			sortOrder: 'ascending',
		})
	})

	test('successfully updates sortBy property', async () => {
		const updatedPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			sortBy: 'modified',
		})

		expect(updatedPreferences).toStrictEqual({
			view: 'list',
			sortBy: 'modified',
			sortOrder: 'ascending',
		})

		// Verify the update round-trips through the query
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual({
			view: 'list',
			sortBy: 'modified',
			sortOrder: 'ascending',
		})
	})

	test('successfully updates sortOrder property', async () => {
		const updatedPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			sortOrder: 'descending',
		})

		expect(updatedPreferences).toStrictEqual({
			view: 'list',
			sortBy: 'name',
			sortOrder: 'descending',
		})

		// Verify the update round-trips through the query
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual({
			view: 'list',
			sortBy: 'name',
			sortOrder: 'descending',
		})
	})

	test('successfully updates multiple properties in a single call', async () => {
		const updatedPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'descending',
		})

		expect(updatedPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'descending',
		})

		// Verify the update round-trips through the query
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'descending',
		})
	})

	test('preserves existing properties when updating partial preferences', async () => {
		// Set initial non-default preferences
		await umbreld.client.files.updateViewPreferences.mutate({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})

		// Update just one property
		const updatedPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			sortBy: 'size',
		})

		// Check that only the specified property was updated
		expect(updatedPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'descending',
		})
	})

	test('handles sequential updates correctly', async () => {
		// Update step 1
		await umbreld.client.files.updateViewPreferences.mutate({
			view: 'icons',
		})

		// Update step 2
		await umbreld.client.files.updateViewPreferences.mutate({
			sortBy: 'modified',
		})

		// Update step 3
		const finalPreferences = await umbreld.client.files.updateViewPreferences.mutate({
			sortOrder: 'descending',
		})

		// Check final state
		expect(finalPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})
	})
})

describe('persistence', () => {
	test('view preferences persist across a reboot', async () => {
		// Set non-default preferences
		await umbreld.client.files.updateViewPreferences.mutate({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})

		// Power cycle the VM
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		// Preferences survived the reboot
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})
	})
})
