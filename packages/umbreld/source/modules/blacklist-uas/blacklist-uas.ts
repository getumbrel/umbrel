import {globby} from 'globby'
import fse from 'fs-extra'
import {$} from 'execa'

// By default Linux uses the UAS driver for most devices. This causes major
// stability problems on the Raspberry Pi 4, not due to issues with UAS, but due
// to devices running in UAS mode using much more power. The Pi can't reliably
// provide enough power to the USB port and the entire system experiences
// extreme instability. By blacklisting all devices from the UAS driver on first
// and then rebooting we fall back to the mass-storage driver, which results in
// decreased performance, but lower power usage, and much better system stability.
//
// We use console.err for logs so they appear in umbrel-external-storage logs and
// console.log to signal to the mount script that we're rebooting.
export default async function blacklistUASDriver() {
	try {
		console.error('Checking for UAS devices to blacklist')
		const justDidRebootFile = '/umbrel-just-did-reboot'
		// Only run on Raspberry Pi 4
		const cpuInfo = await fse.readFile('/proc/cpuinfo')
		if (!cpuInfo.includes('Raspberry Pi 4 ')) {
			console.error('Not running on Pi 4, exiting...')
			return
		}
		console.error('Running on Pi 4')
		const blacklist = []
		// Get all USB device uevent files
		const usbDeviceUeventFiles = await globby('/sys/bus/usb/devices/*/uevent')
		for (const ueventFile of usbDeviceUeventFiles) {
			const uevent = await fse.readFile(ueventFile, 'utf8')
			if (!uevent.includes('DRIVER=uas')) continue
			const [vendorId, productId] = uevent
				.split('\n')
				.find((line) => line?.startsWith('PRODUCT='))!
				.replace('PRODUCT=', '')
				.split('/')
			const deviceId = `${vendorId}:${productId}`
			console.error(`UAS device found ${deviceId}`)
			blacklist.push(deviceId)
		}

		// Don't reboot if we don't have any UAS devices
		if (blacklist.length === 0) {
			console.error('No UAS devices found!')
			await fse.remove(justDidRebootFile)
			return
		}

		// Check we're not in a boot loop
		if (await fse.pathExists(justDidRebootFile)) {
			console.error('We just rebooted, we could be in a bootloop, skipping reboot')
			return
		}

		// Read current cmdline
		console.error(`Applying quirks to cmdline.txt`)
		let cmdline = await fse.readFile('/boot/cmdline.txt', 'utf8')

		// Don't apply quirks if they're already applied
		const quirksAlreadyApplied = blacklist.every((deviceId) => cmdline.includes(`${deviceId}:u`))
		if (quirksAlreadyApplied) {
			console.error('UAS quirks already applied, skipping')
			return
		}

		// Remove any current quirks
		cmdline = cmdline
			.trim()
			.split(' ')
			.filter((flag) => !flag.startsWith('usb-storage.quirks='))
			.join(' ')
		// Add new quirks
		const quirks = blacklist.map((deviceId) => `${deviceId}:u`).join(',')
		cmdline = `${cmdline} usb-storage.quirks=${quirks}`

		// Remount /boot as writable
		await $`mount -o remount,rw /boot`
		// Write new cmdline
		await fse.writeFile('/boot/cmdline.txt', cmdline)

		// Reboot the system
		console.error(`Rebooting`)
		// We must make exactly this console log so we can detect a reboot in the mount script and halt
		console.log('mount-script-halt')
		// We need to make sure we commit before rebooting otherwise
		// OTA updates will get instantly rolled back.
		try {
			await $`mender commit`
		} catch {}
		await fse.writeFile(justDidRebootFile, cmdline)
		await $`reboot`
		return true
	} catch (error) {
		console.error(`Failed to blacklist UAS driver: ${(error as Error).message}`)
	}
}
