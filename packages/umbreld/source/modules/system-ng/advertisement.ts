import fse from 'fs-extra'

import type Umbreld from '../../index.ts'

const serviceFilePath = '/etc/avahi/services/umbrel.service'
// LAN ingress owns the public HTTP port; umbreld.port is loopback-only.
const publicHttpPort = 80

// Escape XML special characters so interpolated values can't produce a malformed
// service file that avahi would silently refuse to load
function escapeXml(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Advertises this device on the local network as an _umbrel._tcp mDNS service so
// discovery clients can find it without knowing its address. The TXT id is only a hint;
// clients confirm identity and state via system.discoveryInfo.
//
// avahi-daemon watches the services directory with inotify, so writing the file is all
// that's needed for changes to apply. It lives on the root partition and is lost on OTA
// updates, so we rewrite it on every start. The %h wildcard tracks hostname changes.
//
// Privacy: TXT records are passively visible to the whole local network, so they only
// carry what our public API already exposes. Deliberately excluded: the username
// (personal data) and the OS version (vulnerability fingerprinting). The id is random,
// unrelated to hardware serials, and regenerates on factory reset. Keep these
// constraints in mind before adding records.
export default class Advertisement {
	#umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`systemng:${name.toLowerCase()}`)
	}

	async start() {
		this.logger.log('Starting advertisement')

		// Non-fatal: environments without Avahi (development, tests) fail the write
		await this.update().catch((error) => this.logger.error('Failed to write mDNS service file', error))
	}

	async stop() {
		this.logger.log('Stopping advertisement')
	}

	// Writes the Avahi service file with the device's stable discovery hint.
	async update() {
		const id = await this.#umbreld.systemNg.device.getDiscoveryId()

		const serviceFile = `<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
	<name replace-wildcards="yes">%h</name>
	<service>
		<type>_umbrel._tcp</type>
		<port>${publicHttpPort}</port>
		<txt-record>id=${escapeXml(id)}</txt-record>
	</service>
</service-group>
`
		await fse.writeFile(serviceFilePath, serviceFile)
		this.logger.log('Wrote mDNS service file')
	}
}
