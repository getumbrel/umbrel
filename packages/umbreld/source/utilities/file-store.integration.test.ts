import path from 'node:path'
import {describe, beforeAll, afterAll, expect, test} from 'vitest'

import temporaryDirectory from './temporary-directory.js'

import FileStore from './file-store.js'

const directory = temporaryDirectory('store')

beforeAll(directory.createRoot)
afterAll(directory.destroyRoot)

const createStore = async () => {
	const filePath = path.join(await directory.create(), 'store.yaml')
	const store = new FileStore({filePath})

	return store
}

describe('Filestore', () => {
	test('FileStore is a class', () => {
		expect(FileStore).toBeTypeOf('function')
		expect(FileStore.toString().startsWith('class ')).toBe(true)
	})
})

describe('store.get()', () => {
	test('can get a value', async () => {
		const store = await createStore()
		await store.set('one', 1)
		expect(await store.get('one')).toBe(1)
	})

	test('can get a deep value with dot notation', async () => {
		const store = await createStore()
		await store.set('deep.one', 1)
		expect(await store.get('deep.one')).toBe(1)
	})

	test('can get entire store', async () => {
		const store = await createStore()
		await store.set('one', 1)
		await store.set('two', 2)
		expect(await store.get()).toEqual({
			one: 1,
			two: 2,
		})
	})

	test("throws if it can't read the store file", async () => {
		const store = new FileStore({filePath: `/this/file/doesnt/exist/store-throws.json`})
		expect(store.get()).rejects.toThrow('Unable to create initial file')
	})
})

describe('store.set()', () => {
	test('can set a value', async () => {
		const store = await createStore()
		expect(await store.set('one', 1)).toBe(true)
	})

	test('can set a deep value with dot notation', async () => {
		const store = await createStore()
		expect(await store.set('deep.one', 1)).toBe(true)
		expect(await store.get()).toStrictEqual({
			deep: {
				one: 1,
			},
		})
	})

	test('queues async writes', async () => {
		const store = await createStore()
		// If there was no write queue these async writes would all overwrite eachother
		await Promise.all([
			store.set('one', 1),
			store.set('two', 2),
			store.set('three', 3),
			store.set('four', 4),
			store.set('five', 5),
		])
		expect(await store.get()).toStrictEqual({
			one: 1,
			two: 2,
			three: 3,
			four: 4,
			five: 5,
		})
	})

	test('throws on missing or invalid arguments', async () => {
		const store = await createStore()

		expect(store.set()).rejects.toThrow('Invalid argument')

		expect(store.set('key')).rejects.toThrow('Invalid argument')

		expect(store.set(undefined, 'value')).rejects.toThrow('Invalid argument')
	})
})

describe('store.delete()', () => {
	test('can delete a value', async () => {
		const store = await createStore()

		await store.set('one', 1)
		await store.set('two', 2)
		expect(await store.get()).toStrictEqual({
			one: 1,
			two: 2,
		})

		await store.delete('one')
		expect(await store.get()).toStrictEqual({
			two: 2,
		})
	})

	test('can delete a deep value with dot notation', async () => {
		const store = await createStore()

		await store.set('deep.one', 1)
		await store.set('deep.two', 2)
		expect(await store.get('deep')).toStrictEqual({
			one: 1,
			two: 2,
		})

		await store.delete('deep.one')
		expect(await store.get('deep')).toStrictEqual({
			two: 2,
		})
	})
})

describe('store.getWriteLock()', () => {
	test('allows custom control over write lock', async () => {
		const store = await createStore()
		await store.set('counter', 0)

		const incrementWithWritelock = async () => {
			return store.getWriteLock(async ({set}) => {
				let counter = await store.get('counter')
				counter++
				await set('counter', counter)
			})
		}

		await Promise.all([incrementWithWritelock(), incrementWithWritelock()])

		expect(await store.get('counter')).toBe(2)
	})

	test('exposes expected methods', async (t) => {
		const store = await createStore()

		await store.getWriteLock(async (methods) => {
			await methods.set('one', 1)
			expect(await methods.get('one')).toBe(1)
			await methods.delete('one')
			expect(await methods.get('one')).toBe(undefined)
		})
	})
})
