import {describe, expect, test} from 'vitest'

import {builtinMachinesCatalog} from './machines.js'

describe('built-in Machines catalog', () => {
	test.each(['amd64', 'arm64'] as const)('ships native Server and Desktop templates for %s', (arch) => {
		const images = builtinMachinesCatalog.images.filter((image) => image.arch === arch && image.platform === 'linux')

		expect(images.map(({id, familyId, variantName, version}) => ({id, familyId, variantName, version}))).toEqual([
			{
				id: `ubuntu-26.04-desktop-${arch}`,
				familyId: 'ubuntu',
				variantName: 'Desktop',
				version: 'Ubuntu 26.04 LTS',
			},
			{
				id: `ubuntu-26.04-server-${arch}`,
				familyId: 'ubuntu',
				variantName: 'Server',
				version: 'Ubuntu 26.04 LTS',
			},
			{
				id: `fedora-44-desktop-${arch}`,
				familyId: 'fedora',
				variantName: 'Desktop',
				version: 'Fedora 44',
			},
			{
				id: `fedora-44-server-${arch}`,
				familyId: 'fedora',
				variantName: 'Server',
				version: 'Fedora 44',
			},
			{
				id: `debian-13-desktop-${arch}`,
				familyId: 'debian',
				variantName: 'Desktop',
				version: 'Debian 13',
			},
			{
				id: `debian-13-server-${arch}`,
				familyId: 'debian',
				variantName: 'Server',
				version: 'Debian 13',
			},
			{
				id: `alpine-3.24.1-${arch}`,
				familyId: 'alpine',
				variantName: undefined,
				version: 'Alpine Linux 3.24.1',
			},
			{
				id: `android-13-${arch}`,
				familyId: 'android',
				variantName: undefined,
				version: 'Android 13 · Waydroid',
			},
			...(arch === 'amd64'
				? [{id: 'omarchy-4.0.4-amd64', familyId: 'omarchy', variantName: undefined, version: 'Omarchy 4.0.4'}]
				: []),
		])
		expect(images.every((image) => image.requiresCredentials)).toBe(true)
		expect(images.every((image) => image.platformProfile === (arch === 'amd64' ? 'modern-x86' : 'modern-arm64'))).toBe(
			true,
		)
	})

	test('ships Alpine as a server-only native image', () => {
		const familyId = 'alpine'
		const images = builtinMachinesCatalog.images.filter((image) => image.familyId === familyId)
		expect(images.map(({arch}) => arch)).toEqual(['amd64', 'arm64'])
		expect(images.every(({variantName, requiresCredentials}) => variantName === undefined && requiresCredentials)).toBe(
			true,
		)
	})

	test('ships the official Omarchy ISO only on amd64 with credentials for unattended setup', () => {
		const images = builtinMachinesCatalog.images.filter(({familyId}) => familyId === 'omarchy')
		expect(images).toHaveLength(1)
		expect(images[0]).toMatchObject({
			name: 'Omarchy',
			arch: 'amd64',
			platformProfile: 'modern-x86',
			requiresCredentials: true,
			estimatedInstalledSizeMb: 6_800,
			url: 'https://iso.omarchy.org/omarchy-4.0.4.iso',
		})
		expect(images[0].cloudInit).toBeUndefined()
	})

	test('ships Android as a graphical native image on both architectures', () => {
		const images = builtinMachinesCatalog.images.filter((image) => image.familyId === 'android')
		expect(images.map(({arch}) => arch)).toEqual(['amd64', 'arm64'])
		expect(images.every(({cloudInit}) => cloudInit?.graphical)).toBe(true)
		expect(images.every(({cloudInit}) => cloudInit?.commands?.[0]?.[2]?.includes('waydroid init -s GAPPS'))).toBe(true)
	})

	test('ships internal Windows templates with explicit hardware and unattended-install profiles', () => {
		const windows = builtinMachinesCatalog.images.filter((image) => image.platform === 'windows')
		expect(
			windows.map(({familyId, platformProfile, fixedMemoryMb, manualSetup, windows}) => ({
				familyId,
				platformProfile,
				fixedMemoryMb,
				manualSetup,
				windows,
			})),
		).toEqual([
			{
				familyId: 'windows-11',
				platformProfile: 'modern-x86',
				fixedMemoryMb: undefined,
				manualSetup: undefined,
				windows: {installer: 'windows-11'},
			},
			{
				familyId: 'windows-11',
				platformProfile: 'modern-arm64',
				fixedMemoryMb: undefined,
				manualSetup: undefined,
				windows: {installer: 'windows-11'},
			},
			{
				familyId: 'windows-server',
				platformProfile: 'modern-x86',
				fixedMemoryMb: undefined,
				manualSetup: undefined,
				windows: {installer: 'windows-server-2025'},
			},
			{
				familyId: 'windows-7',
				platformProfile: 'windows-7-x86',
				fixedMemoryMb: undefined,
				manualSetup: undefined,
				windows: {installer: 'windows-7'},
			},
			{
				familyId: 'windows-xp',
				platformProfile: 'legacy-x86',
				fixedMemoryMb: undefined,
				manualSetup: undefined,
				windows: {installer: 'windows-xp'},
			},
			{
				familyId: 'windows-98',
				platformProfile: 'windows-98-x86',
				fixedMemoryMb: 512,
				manualSetup: true,
				windows: {installer: 'windows-98'},
			},
		])
		expect(windows.every((image) => image.requiresCredentials)).toBe(true)
		expect(windows.filter(({familyId}) => familyId === 'windows-11').map(({arch}) => arch)).toEqual(['amd64', 'arm64'])
		expect(windows.filter(({familyId}) => familyId !== 'windows-11').every(({arch}) => arch === 'amd64')).toBe(true)
		expect(windows.every((image) => !('preview' in image))).toBe(true)
		expect(windows.find(({familyId}) => familyId === 'windows-server')?.evaluation).toBe(true)
		const windows98 = windows.find(({familyId}) => familyId === 'windows-98')!
		expect(windows98.resources?.map(({id}) => id)).toEqual(['windows-98-se-usb-boot', 'patcher9x-0.9.91'])
		expect(windows98.resources?.every(({sha256}) => /^[0-9a-f]{64}$/.test(sha256))).toBe(true)
	})

	test.each(['amd64', 'arm64'] as const)('uses one cloud image per distro and architecture for %s', (arch) => {
		for (const familyId of ['ubuntu', 'fedora', 'debian']) {
			const pair = builtinMachinesCatalog.images.filter((image) => image.arch === arch && image.familyId === familyId)
			expect(pair).toHaveLength(2)
			expect(new Set(pair.map(({url}) => url)).size).toBe(1)
			expect(new Set(pair.map(({sha256}) => sha256)).size).toBe(1)
		}
	})

	test('defines distro-specific desktop provisioning', () => {
		const ubuntu = builtinMachinesCatalog.images.find(({id}) => id === 'ubuntu-26.04-desktop-amd64')!
		const fedora = builtinMachinesCatalog.images.find(({id}) => id === 'fedora-44-desktop-amd64')!
		const debian = builtinMachinesCatalog.images.find(({id}) => id === 'debian-13-desktop-amd64')!

		expect(ubuntu.cloudInit).toEqual({packages: ['ubuntu-desktop'], graphical: true})
		expect(fedora.cloudInit).toEqual({
			commands: [
				['dnf', 'install', '-y', '@workstation-product-environment'],
				['systemctl', 'enable', 'gdm.service'],
			],
			graphical: true,
		})
		expect(debian.cloudInit?.graphical).toBe(true)
		expect(debian.cloudInit?.commands?.[0]).toEqual(['bash', '-c', expect.stringContaining('task-gnome-desktop')])
		expect(debian.cloudInit?.commands?.[0]?.[2]).toContain('policy-rc.d')
		expect(debian.cloudInit?.commands?.[0]?.[2]).toContain('renderer: NetworkManager')
	})

	test('publishes measured architecture-specific desktop footprint estimates without changing download sizes', () => {
		const desktopEstimates = Object.fromEntries(
			builtinMachinesCatalog.images
				.filter(({variantName}) => variantName === 'Desktop')
				.map(({id, estimatedInstalledSizeMb}) => [id, estimatedInstalledSizeMb]),
		)
		expect(desktopEstimates).toEqual({
			'ubuntu-26.04-desktop-amd64': 5_000,
			'ubuntu-26.04-desktop-arm64': 7_900,
			'fedora-44-desktop-amd64': 5_400,
			'fedora-44-desktop-arm64': 6_200,
			'debian-13-desktop-amd64': 3_400,
			'debian-13-desktop-arm64': 6_100,
		})

		for (const familyId of ['ubuntu', 'fedora', 'debian']) {
			for (const arch of ['amd64', 'arm64']) {
				const variants = builtinMachinesCatalog.images.filter(
					(image) => image.familyId === familyId && image.arch === arch,
				)
				expect(variants[0]?.sizeMb).toBe(variants[1]?.sizeMb)
			}
		}
	})

	test('pins official immutable release images and checksums', () => {
		const ids = builtinMachinesCatalog.images.map(({id}) => id)

		expect(new Set(ids).size).toBe(ids.length)
		for (const image of builtinMachinesCatalog.images) {
			const url = new URL(image.url)
			expect([
				'cloud-images.ubuntu.com',
				'download.fedoraproject.org',
				'cloud.debian.org',
				'dl-cdn.alpinelinux.org',
				'iso.omarchy.org',
				'archive.org',
			]).toContain(url.hostname)
			expect(image.url).not.toMatch(/\/(current|latest|daily)\//)
			expect(image.sha256).toMatch(/^[0-9a-f]{64}$/)

			if (image.platform === 'windows') expect(image.url).toContain('archive.org/download/')
			if (image.familyId === 'ubuntu') expect(image.url).toMatch(/\/release-\d{8}\//)
			if (image.familyId === 'fedora') expect(image.url).toMatch(/\/releases\/44\/.+44-1\.7\./)
			if (image.familyId === 'debian') expect(image.url).toMatch(/\/20260706-2531\/.+-20260706-2531\.qcow2$/)
			if (image.familyId === 'alpine')
				expect(image.url).toMatch(/\/v3\.24\/releases\/cloud\/.+3\.24\.1.+uefi-cloudinit.+\.qcow2$/)
			if (image.familyId === 'android') expect(image.url).toContain('/release-20260627/ubuntu-26.04-server-cloudimg-')
		}
	})
})
