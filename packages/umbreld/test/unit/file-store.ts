import path from 'node:path'

import test from 'ava'

import FileStore from '../../source/utilities/file-store.js'

import temporaryDirectory from '../../test/helpers/temporary-directory.js'

const directory = temporaryDirectory('store')

test.before(directory.createRoot)
test.after.always(directory.destroyRoot)

const createStore = async () => {
	const filePath = path.join(await directory.create(), 'store.yaml')
	const store = new FileStore({filePath})

	return store
}

test('FileStore is a class', (t) => {
	t.is(typeof FileStore, 'function')
	t.true(FileStore.toString().startsWith('class '))
})

test('store.set() can set a value', async (t) => {
	const store = await createStore()
	t.is(await store.set('one', 1), true)
})

test('store.get() can get a value', async (t) => {
	const store = await createStore()
	await store.set('one', 1)
	t.is(await store.get('one'), 1)
})

test('store.get() can get entire store', async (t) => {
	const store = await createStore()
	await store.set('one', 1)
	await store.set('two', 2)
	t.deepEqual(await store.get(), {
		one: 1,
		two: 2,
	})
})

test('store.delete() can delete a value', async (t) => {
	const store = await createStore()

	await store.set('one', 1)
	await store.set('two', 2)
	t.deepEqual(await store.get(), {
		one: 1,
		two: 2,
	})

	await store.delete('one')
	t.deepEqual(await store.get(), {
		two: 2,
	})
})

test('store.set() can set a deep value with dot notation', async (t) => {
	const store = await createStore()
	t.is(await store.set('deep.one', 1), true)
	t.deepEqual(await store.get(), {
		deep: {
			one: 1,
		},
	})
})

test('store.get() can get a deep value with dot notation', async (t) => {
	const store = await createStore()
	await store.set('deep.one', 1)
	t.is(await store.get('deep.one'), 1)
})

test('store.delete() can delete a deep value with dot notation', async (t) => {
	const store = await createStore()

	await store.set('deep.one', 1)
	await store.set('deep.two', 2)
	t.deepEqual(await store.get('deep'), {
		one: 1,
		two: 2,
	})

	await store.delete('deep.one')
	t.deepEqual(await store.get('deep'), {
		two: 2,
	})
})

test('store.set() queues async writes', async (t) => {
	const store = await createStore()
	// If there was no write queue these async writes would all overwrite eachother
	await Promise.all([
		store.set('one', 1),
		store.set('two', 2),
		store.set('three', 3),
		store.set('four', 4),
		store.set('five', 5),
	])
	t.deepEqual(await store.get(), {
		one: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
	})
})

test('store.getWriteLock() allows custom control over write lock', async (t) => {
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

	t.is(await store.get('counter'), 2)
})

test('store.getWriteLock() exposes expected methods', async (t) => {
	const store = await createStore()

	await store.getWriteLock(async (methods) => {
		await methods.set('one', 1)
		t.is(await methods.get('one'), 1)
		await methods.delete('one')
		t.is(await methods.get('one'), undefined)
	})
})

test("store.get() throws if it can't read the store file", async (t) => {
	const store = new FileStore({filePath: `/this/file/doesnt/exist/store-throws.json`})
	const error = await t.throwsAsync(store.get())
	t.is(error.message, 'Unable to create initial file')
})

test('store.set() throws on missing or invalid arguments', async (t) => {
	const store = await createStore()

	const noArgumentsError = await t.throwsAsync(store.set())
	t.is(noArgumentsError.message, 'Invalid argument')

	const noValueError = await t.throwsAsync(store.set('key'))
	t.is(noValueError.message, 'Invalid argument')

	const noKeyError = await t.throwsAsync(store.set(undefined, 'value'))
	t.is(noKeyError.message, 'Invalid argument')
})
