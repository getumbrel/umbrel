import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import type {MachineState, OsImage} from '@/features/machines/types'
import {t} from '@/utils/i18n'
import {roundForPrettyBytes} from '@/utils/round-for-pretty-bytes'

export const isMachineStartable = (state: MachineState) =>
	state === 'stopped' || state === 'suspended' || state === 'error'

// OS image sizes are modelled in MB (SI)
export const prettyMb = (mb: number) => prettyBytes(roundForPrettyBytes(mb * 1e6), {locale: i18next.language})

// The edition line under an OS name. Media that only accepts product keys from
// one licensing channel names it up front, before anyone types a key Setup
// will reject.
export const osImageVersionLabel = ({version, licenseChannel}: Pick<OsImage, 'version' | 'licenseChannel'>) =>
	licenseChannel ? `${version} · ${t(`machines.license-channel.${licenseChannel}`)}` : version

// Strip a supported installer/disk-image extension from a filename to get a
// friendly display name
export const stripDiskImageExtension = (filename: string) =>
	filename.replace(/\.(iso|qcow2|img|vmdk|vdi|vhdx|vhd)$/i, '')

// True when an install path lives on an external or network drive, where a
// disconnect would immediately kill the machine
export const isExternalOrNetworkPath = (path: string) =>
	[EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH].some((root) => path === root || path.startsWith(`${root}/`))

// crypto.randomUUID() is only exposed in secure contexts, while umbrelOS is
// commonly opened over plain HTTP on the local network. getRandomValues() is
// explicitly available in insecure contexts, so build UUIDs from it instead.
// The Math.random fallback only covers old browsers without Web Crypto; these
// IDs coordinate UI/console state and are not used as authentication secrets.
export function createBrowserUuid() {
	const bytes = new Uint8Array(16)
	if (typeof globalThis.crypto?.getRandomValues === 'function') {
		globalThis.crypto.getRandomValues(bytes)
	} else {
		for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
	return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

// Compact "x of y" size pair: collapses the unit when both values share it,
// e.g. "141 of 700 MB" / "1.2 of 6.1 GB", but "900 MB of 6.1 GB"
export function prettyMbPair(downloadedMb: number, totalMb: number) {
	const downloaded = prettyMb(downloadedMb)
	const total = prettyMb(totalMb)
	const downloadedUnit = downloaded.split(' ')[1]
	const totalUnit = total.split(' ')[1]
	const downloadedValue = downloadedUnit === totalUnit ? downloaded.split(' ')[0] : downloaded
	return {downloaded: downloadedValue, total}
}
