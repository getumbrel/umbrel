import type Umbreld from '../../index.js'

import InternalStorage from './internal-storage.js'
import Mdadm from './mdadm.js'
import Raid from './raid.js'
import UmbrelPro from './umbrel-pro.js'
import Thunderbolt from './thunderbolt.js'

export default class Hardware {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	internalStorage: InternalStorage
	raid: Raid
	mdadm: Mdadm
	umbrelPro: UmbrelPro
	thunderbolt: Thunderbolt

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())

		this.internalStorage = new InternalStorage(umbreld)
		this.raid = new Raid(umbreld)
		this.mdadm = new Mdadm(umbreld)
		this.umbrelPro = new UmbrelPro(umbreld)
		this.thunderbolt = new Thunderbolt(umbreld)
	}

	async start() {
		this.logger.log('Starting hardware')

		// Start submodules
		await Promise.all([
			this.internalStorage.start().catch((error) => this.logger.error('Failed to start internal storage', error)),
			this.raid.start().catch((error) => this.logger.error('Failed to start RAID', error)),
			this.mdadm.start().catch((error) => this.logger.error('Failed to start mdadm monitor', error)),
			this.umbrelPro.start().catch((error) => this.logger.error('Failed to start Umbrel Pro', error)),
			this.thunderbolt.start().catch((error) => this.logger.error('Failed to start Thunderbolt monitor', error)),
		])
	}

	async stop() {
		this.logger.log('Stopping hardware')

		// Stop submodules
		await Promise.all([
			this.internalStorage.stop().catch((error) => this.logger.error('Failed to stop internal storage', error)),
			this.raid.stop().catch((error) => this.logger.error('Failed to stop RAID', error)),
			this.mdadm.stop().catch((error) => this.logger.error('Failed to stop mdadm monitor', error)),
			this.umbrelPro.stop().catch((error) => this.logger.error('Failed to stop Umbrel Pro', error)),
			this.thunderbolt.stop().catch((error) => this.logger.error('Failed to stop Thunderbolt monitor', error)),
		])
	}
}
