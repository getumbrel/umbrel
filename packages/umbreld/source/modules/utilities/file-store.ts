import * as fs from 'node:fs/promises'
import process from 'node:process'

import yaml from 'js-yaml'
import {getProperty, setProperty, deleteProperty} from 'dot-prop'
import PQueue from 'p-queue'

import getOrCreateFile from './get-or-create-file.js'

export default class FileStore {
	#parser
	#writes = 0
	#writeQueue

	constructor({filePath}) {
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

		const store = this.#parser.decode(rawData)

		return store
	}

	async #write(store) {
		const rawData = this.#parser.encode(store)

		// Write atomically
		const processId = Number(process.pid)
		const temporaryFilePath = `${this.filePath}.${processId}.${this.#writes++}.tmp`
		await fs.writeFile(temporaryFilePath, rawData, 'utf8')
		await fs.rename(temporaryFilePath, this.filePath)

		return true
	}

	async #set(property, value) {
		const store = await this.#read()
		setProperty(store, property, value)

		return this.#write(store)
	}

	async #delete(property) {
		const store = await this.#read()
		deleteProperty(store, property)

		return this.#write(store)
	}

	async get(property) {
		const store = await this.#read()

		return getProperty(store, property)
	}

	async set(property, value) {
		if (typeof property !== 'string' || typeof value === 'undefined') {
			throw new TypeError('Invalid argument')
		}

		// Add this write job to the queue
		return this.#writeQueue.add(async () => this.#set(property, value))
	}

	async delete(property) {
		if (typeof property !== 'string') throw new TypeError('Invalid argument')

		// Add this write job to the queue
		return this.#writeQueue.add(async () => this.#delete(property))
	}

	async getWriteLock(job) {
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
