import systeminfo from 'systeminformation'
import isUmbrelHome from './is-umbrel-home.js'

export type UmbrelHostEnvironment = 'umbrel-home' | 'raspberry-pi' | 'linux'

/**
 * Could also call this supported environment, host type, environment group, etc...
 * Umbrel OS runs on Linux. But is also supported
 */
export default async function umbrelHostEnvironment(): Promise<UmbrelHostEnvironment | undefined> {
	if (await isUmbrelHome()) {
		return 'umbrel-home'
	}

	const {raspberry} = await systeminfo.system()
	if (!!raspberry) {
		return 'raspberry-pi'
	}

	const {platform} = await systeminfo.osInfo()
	if (platform === 'linux') {
		return 'linux'
	}
}
