import {expect, describe, test} from 'vitest'

import {parseUasDeviceId, applyUasQuirks} from './blacklist-uas.ts'

describe('parseUasDeviceId', () => {
	test('returns vendorId:productId for a device bound to the uas driver', () => {
		const uevent = ['MAJOR=8', 'DRIVER=uas', 'PRODUCT=174c/55aa/100', 'TYPE=0/0/0'].join('\n')
		expect(parseUasDeviceId(uevent)).toBe('174c:55aa')
	})

	test('returns undefined for a device not bound to the uas driver', () => {
		const uevent = ['DRIVER=usb', 'PRODUCT=1234/5678/100'].join('\n')
		expect(parseUasDeviceId(uevent)).toBeUndefined()
	})

	test('handles unpadded hex ids (USB PRODUCT= is not zero-padded)', () => {
		const uevent = ['DRIVER=uas', 'PRODUCT=46f4/1/0'].join('\n')
		expect(parseUasDeviceId(uevent)).toBe('46f4:1')
	})
})

describe('applyUasQuirks', () => {
	test('appends a usb-storage quirk that ignores UAS for the device', () => {
		const cmdline = 'console=ttyS0,115200 root=PARTUUID=abcd-01 rootwait'
		expect(applyUasQuirks(cmdline, ['174c:55aa'])).toBe(
			'console=ttyS0,115200 root=PARTUUID=abcd-01 rootwait usb-storage.quirks=174c:55aa:u',
		)
	})

	test('lists every detected device in a single quirks flag', () => {
		expect(applyUasQuirks('rootwait', ['174c:55aa', '0bda:9210'])).toBe(
			'rootwait usb-storage.quirks=174c:55aa:u,0bda:9210:u',
		)
	})

	test('replaces any existing usb-storage.quirks flag rather than duplicating it', () => {
		const cmdline = 'rootwait usb-storage.quirks=152d:1561:u loglevel=3'
		expect(applyUasQuirks(cmdline, ['174c:55aa'])).toBe('rootwait loglevel=3 usb-storage.quirks=174c:55aa:u')
	})
})
