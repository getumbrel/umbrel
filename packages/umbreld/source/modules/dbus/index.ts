import {type MessageBus, systemBus as connectToSystemBus} from 'dbus-next'

import type Umbreld from '../../index.js'
import UDisks from './udisks.js'

class DBus {
	logger: Umbreld['logger']
	#systemBus: MessageBus | null = null
	udisks: UDisks

	constructor(umbreld: Umbreld) {
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.udisks = new UDisks(this)
	}

	get system() {
		const bus = this.#systemBus
		if (!bus) throw new Error('System bus not connected')
		return bus
	}

	get session() {
		throw new Error('Session bus not implemented')
	}

	async start() {
		this.logger.log('Starting DBus')
		const systemBus = connectToSystemBus()
		systemBus.addListener('connect', () => this.logger.log('Connected to system bus'))
		systemBus.addListener('error', (error) => this.logger.error(`System bus error: ${(error as Error).message}`))
		this.#systemBus = systemBus

		// Start services
		await this.udisks.start()
	}

	async stop() {
		this.logger.log('Stopping DBus')

		// Stop services
		await this.udisks.stop()

		this.system.disconnect()
		this.#systemBus = null
	}
}

export default DBus
