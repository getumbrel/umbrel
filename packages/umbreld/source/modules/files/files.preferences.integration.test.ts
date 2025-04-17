import {expect, beforeAll, afterAll, beforeEach, describe, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe('viewPreferences()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.viewPreferences.query()).rejects.toThrow('Invalid token')
	})

	test('returns default view preferences on first start', async () => {
		const viewPreferences = await umbreld.client.files.viewPreferences.query()
		expect(viewPreferences).toStrictEqual({
			view: 'list',
			sortBy: 'name',
			sortOrder: 'ascending',
		})
	})

	test('returns updated view preferences from the store', async () => {
		// Write a modified value to the store
		await umbreld.instance.store.set('files.preferences', {
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})

		const viewPreferences = await umbreld.client.files.viewPreferences.query()
		expect(viewPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})
	})
})

describe('updateViewPreferences()', () => {
	// Reset to default state before each test
	beforeEach(async () => {
		await umbreld.instance.store.set('files.preferences', {
			view: 'list',
			sortBy: 'name',
			sortOrder: 'ascending',
		})
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

		// Verify the preferences were saved to the store
		const storedPreferences = await umbreld.instance.store.get('files.preferences')
		expect(storedPreferences).toStrictEqual({
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

		// Verify the preferences were saved to the store
		const storedPreferences = await umbreld.instance.store.get('files.preferences')
		expect(storedPreferences).toStrictEqual({
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

		// Verify the preferences were saved to the store
		const storedPreferences = await umbreld.instance.store.get('files.preferences')
		expect(storedPreferences).toStrictEqual({
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

		// Verify the preferences were saved to the store
		const storedPreferences = await umbreld.instance.store.get('files.preferences')
		expect(storedPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'descending',
		})
	})

	test('preserves existing properties when updating partial preferences', async () => {
		// Set initial non-default preferences
		await umbreld.instance.store.set('files.preferences', {
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

		// Verify the store has the correct final state
		const storedPreferences = await umbreld.instance.store.get('files.preferences')
		expect(storedPreferences).toStrictEqual({
			view: 'icons',
			sortBy: 'modified',
			sortOrder: 'descending',
		})
	})
})
