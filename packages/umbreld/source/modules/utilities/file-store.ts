import * as fs from 'node:fs/promises'
import process from 'node:process'

import yaml from 'js-yaml'
import {getProperty, setProperty, deleteProperty} from 'dot-prop'
import PQueue from 'p-queue'

import getOrCreateFile from './get-or-create-file.js'

type DotProp<T, P extends string> = P extends `${infer K}.${infer R}`
	? K extends keyof T
		? DotProp<T[K], R>
		: never
	: P extends keyof T
	? T[P]
	: never

type StorePath<T, P extends string> = DotProp<T, P> extends never ? 'The provided path does not exist in the store' : P

export default class FileStore<T> {
	filePath: string

	#parser
	#writes = 0
	#writeQueue

	constructor({filePath}: {filePath: string}) {
		this.filePath = filePath

		// TODO: Allow configuring
		this.#parser = {
			encode: yaml.dump,
			decode: yaml.load,
		}

		this.#writeQueue = new PQueue({concurrency: 1})
	}

	async #read() {
		const rawData = await getOrCreateFile(this.filePath, this.#parser.encode({}))

		const store = this.#parser.decode(rawData) as T

		return store
	}

	async #write(store: T): Promise<boolean> {
		const rawData = this.#parser.encode(store)

		// Write atomically
		const processId = Number(process.pid)
		const temporaryFilePath = `${this.filePath}.${processId}.${this.#writes++}.tmp`
		await fs.writeFile(temporaryFilePath, rawData, 'utf8')
		await fs.rename(temporaryFilePath, this.filePath)

		return true
	}

	async #set<P extends string>(property: StorePath<T, P>, value: DotProp<T, P>) {
		const store = await this.#read()
		setProperty(store as any, property as string, value)

		return this.#write(store)
	}

	async #delete<P extends string>(property: StorePath<T, P>): Promise<boolean> {
		const store = await this.#read()
		deleteProperty(store as any, property as string)

		return this.#write(store)
	}

	async get<P extends string>(property?: StorePath<T, P>) {
		const store = await this.#read()

		return getProperty(store, property as string) as DotProp<T, P>
	}

	async set<P extends string>(property: StorePath<T, P>, value: DotProp<T, P>): Promise<boolean> {
		if (typeof property !== 'string' || typeof value === 'undefined') {
			throw new TypeError('Invalid argument')
		}

		// Add this write job to the queue
		return this.#writeQueue.add(async () => this.#set(property, value))
	}

	async delete<P extends string>(property: StorePath<T, P>): Promise<boolean> {
		if (typeof property !== 'string') throw new TypeError('Invalid argument')

		// Add this write job to the queue
		return this.#writeQueue.add(async () => this.#delete(property))
	}

	async getWriteLock(
		job: (methods: {
			get: typeof FileStore.prototype.get
			set: typeof FileStore.prototype.set
			delete: typeof FileStore.prototype.delete
		}) => Promise<void>,
	): Promise<void> {
		const nonLockedMethods = {
			get: this.get.bind(this),
			set: this.#set.bind(this),
			delete: this.#delete.bind(this),
		}

		return this.#writeQueue.add(async () => job(nonLockedMethods))
	}

	// TODO: Method to overwrite entire store

	// TODO: Method to register migration hook
}
