import {EventEmitter} from 'node:events'

import type DBus from './index.js'

const changeDebounceTimeout = 2000

class UDisks extends EventEmitter {
	dbus: DBus
	logger: DBus['logger']
	manager: EventEmitter | null = null
	timeout: NodeJS.Timeout | null = null

	constructor(dbus: DBus) {
		super()
		this.dbus = dbus
		const {name: parentName} = dbus.constructor
		const {name} = this.constructor
		this.logger = dbus.logger.createChildLogger(`${parentName.toLocaleLowerCase()}:${name.toLowerCase()}`)
	}

	async start() {
		this.logger.log('Starting UDisks')
		const udisks = await this.dbus.system.getProxyObject('org.freedesktop.UDisks2', '/org/freedesktop/UDisks2')
		const manager = udisks.getInterface('org.freedesktop.DBus.ObjectManager')
		manager.addListener('InterfacesAdded', this.#handleInterfacesChanged)
		manager.addListener('InterfacesRemoved', this.#handleInterfacesChanged)
		this.manager = manager
	}

	async stop() {
		this.logger.log('Stopping UDisks')
		if (this.manager) {
			this.manager.removeListener('InterfacesAdded', this.#handleInterfacesChanged)
			this.manager.removeListener('InterfacesRemoved', this.#handleInterfacesChanged)
			this.manager = null
		}
	}

	#handleInterfacesChanged = () => {
		if (this.timeout) clearTimeout(this.timeout)
		this.timeout = setTimeout(() => {
			this.logger.log('Interfaces changed')
			this.timeout = null
			this.emit('change')
		}, changeDebounceTimeout)
	}
}

export default UDisks
