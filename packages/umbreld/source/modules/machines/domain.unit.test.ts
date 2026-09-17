import {randomUUID} from 'node:crypto'

import {describe, expect, test} from 'vitest'

import {buildDomainXml, type MachineDefinition} from './domain.js'

function definition(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
	const id = randomUUID()
	return {
		version: 1,
		id,
		name: 'Test machine',
		osId: 'custom',
		osName: 'Test',
		osVersion: '1',
		arch: 'amd64',
		platformProfile: 'modern-x86',
		machineType: 'pc-q35-9.2',
		firmware: 'uefi',
		uuid: randomUUID(),
		macAddress: '02:00:00:00:00:01',
		ipAddress: '10.203.0.2',
		diskSizeGb: 20,
		cores: 2,
		memoryMb: 4_096,
		autostart: false,
		pinned: false,
		createdAt: 1,
		portForwards: [],
		...overrides,
	}
}

describe('libvirt domain XML', () => {
	test('attaches an Omarchy installer and its separate non-bootable configuration CD', () => {
		const xml = buildDomainXml({
			definition: definition({osId: 'omarchy', installMedia: 'media/install.iso', seedMedia: 'media/seed.iso'}),
			machineDirectory: '/data/machines/omarchy',
			runtimeDirectory: '/run/umbrel-machines/omarchy',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		})
		const disks = xml.match(/<disk\b[\s\S]*?<\/disk>/g)!
		expect(disks).toHaveLength(3)
		expect(disks[0]).toContain("<boot order='1'/>")
		expect(disks[1]).toContain('/media/install.iso')
		expect(disks[1]).toContain("<target dev='sda' bus='sata'/>")
		expect(disks[1]).toContain("<boot order='2'/>")
		expect(disks[2]).toContain('/media/seed.iso')
		expect(disks[2]).toContain("<target dev='sdb' bus='sata'/>")
		expect(disks[2]).not.toContain('<boot ')
		expect(xml).not.toContain("secure='yes'")
		expect(xml).not.toContain('<tpm')
	})

	test('uses KVM, pinned q35 hardware, the transient NAT network, UEFI state, and a Unix-only display', () => {
		const xml = buildDomainXml({
			definition: definition(),
			machineDirectory: '/data/machines/test',
			runtimeDirectory: '/run/umbrel-machines/test',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		})

		expect(xml).toContain("<domain type='kvm'")
		expect(xml).toContain("arch='x86_64' machine='pc-q35-9.2'")
		expect(xml).toContain("<cpu mode='host-passthrough'")
		expect(xml).toContain("<interface type='network'>")
		expect(xml).toContain("<source network='umbrel-machines'/>")
		expect(xml).toContain("<port isolated='yes'/>")
		expect(xml).toContain("<filterref filter='clean-traffic'><parameter name='IP' value='10.203.0.2'/></filterref>")
		expect(xml).toContain("<driver name='vhost'/>")
		expect(xml).toContain("<input type='keyboard' bus='ps2'/>")
		expect(xml).not.toContain("<input type='keyboard' bus='usb'/>")
		expect(xml).toContain("socket='/run/umbrel-machines/test/display.sock'")
		expect(xml).toContain('<nvram>/data/machines/test/nvram.fd</nvram>')
		expect(xml).toContain("<boot order='1'/>")
		expect(xml).not.toContain('<boot dev=')
		expect(xml).not.toContain('listen=')
		expect(xml).not.toContain("type='egl-headless'")
		expect(xml).not.toContain('accel3d')
		expect(xml).toContain("<memballoon model='virtio' freePageReporting='on'/>")
	})

	test('adds virgl rendering alongside VNC for an accelerated desktop', () => {
		const xml = buildDomainXml({
			definition: definition({osId: 'ubuntu', osName: 'Ubuntu Desktop', osVariant: 'Desktop'}),
			machineDirectory: '/data/machines/desktop',
			runtimeDirectory: '/run/umbrel-machines/desktop',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
			graphicsRenderNode: '/dev/dri/renderD128',
		})

		expect(xml).toContain("<graphics type='vnc' socket='/run/umbrel-machines/desktop/display.sock'")
		expect(xml).toContain("<graphics type='egl-headless'><gl rendernode='/dev/dri/renderD128'/></graphics>")
		expect(xml).toContain(
			"<video><model type='virtio' heads='1' primary='yes'><acceleration accel3d='yes'/></model></video>",
		)
	})

	test('boots Android machines with a phone-shaped scanout', () => {
		const options = {
			machineDirectory: '/data/machines/android',
			runtimeDirectory: '/run/umbrel-machines/android',
			acceleration: 'kvm' as const,
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		}
		const android = definition({osId: 'android', osName: 'Android'})

		const accelerated = buildDomainXml({...options, definition: android, graphicsRenderNode: '/dev/dri/renderD128'})
		expect(accelerated).toContain(
			"<video><model type='virtio' heads='1' primary='yes'><acceleration accel3d='yes'/><resolution x='720' y='1560'/></model></video>",
		)

		// Hosts without a render node still boot Android into the same display
		const software = buildDomainXml({...options, definition: android})
		expect(software).toContain(
			"<video><model type='virtio' primary='yes'><resolution x='720' y='1560'/></model></video>",
		)

		// Every other guest keeps QEMU's default scanout and follows the browser
		const other = buildDomainXml({...options, definition: definition(), graphicsRenderNode: '/dev/dri/renderD128'})
		expect(other).not.toContain('<resolution')
	})

	test('routes modern guest audio into a fixed-format ALSA loopback stream', () => {
		const xml = buildDomainXml({
			definition: definition(),
			machineDirectory: '/data/machines/audio',
			runtimeDirectory: '/run/umbrel-machines/audio',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
			audioPlaybackDevice: 'hw:10,0,4',
		})

		expect(xml).toContain('alsa,id=umbrel-audio,out.dev=hw:10,,0,,4')
		expect(xml).toContain('out.frequency=48000,out.channels=2,out.format=s16,out.try-poll=off')
		expect(xml).toContain('ich9-intel-hda,id=umbrel-sound,bus=pcie.0,addr=0x3')
		expect(xml).toContain('hda-output,id=umbrel-sound-codec,bus=umbrel-sound.0,audiodev=umbrel-audio')
	})

	test('omits host audio when no loopback device was allocated', () => {
		const xml = buildDomainXml({
			definition: definition(),
			machineDirectory: '/data/machines/no-audio',
			runtimeDirectory: '/run/umbrel-machines/no-audio',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		})

		expect(xml).not.toContain('id=umbrel-audio')
	})

	test('uses TCG maximum CPU for a cross-architecture ARM guest', () => {
		const xml = buildDomainXml({
			definition: definition({
				arch: 'arm64',
				platformProfile: 'modern-arm64',
				machineType: 'virt-9.2',
			}),
			machineDirectory: '/data/machines/arm',
			runtimeDirectory: '/run/umbrel-machines/arm',
			acceleration: 'tcg',
			firmwareCode: '/usr/share/AAVMF/AAVMF_CODE.fd',
		})

		expect(xml).toContain("<domain type='qemu'")
		expect(xml).toContain("arch='aarch64' machine='virt-9.2'")
		expect(xml).toContain("<cpu mode='maximum'")
		expect(xml).toContain('<gic version="3"/>')
		expect(xml).toContain('/usr/bin/qemu-system-aarch64')
	})

	test('uses the host GIC for a native ARM guest', () => {
		const xml = buildDomainXml({
			definition: definition({
				arch: 'arm64',
				platformProfile: 'modern-arm64',
				machineType: 'virt-9.2',
			}),
			machineDirectory: '/data/machines/arm',
			runtimeDirectory: '/run/umbrel-machines/arm',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/AAVMF/AAVMF_CODE.fd',
		})

		expect(xml).toContain("<domain type='kvm'")
		expect(xml).toContain('<gic version="host"/>')
		expect(xml).toContain("<cpu mode='host-passthrough'")
		expect(xml).toContain("<input type='tablet' bus='usb'/>")
		expect(xml).toContain("<input type='keyboard' bus='usb'/>")
	})

	test('keeps port forwarding out of domain XML so umbreld can enforce DNAT centrally', () => {
		const xml = buildDomainXml({
			definition: definition({
				portForwards: [
					{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22},
					{id: 'dns', protocol: 'udp', hostPort: 40_053, guestPort: 53},
				],
			}),
			machineDirectory: '/data/machines/test',
			runtimeDirectory: '/run/umbrel-machines/test',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		})

		expect(xml).not.toContain('portForward')
		expect(xml).toContain("<source network='umbrel-machines'/>")
		expect(xml).toContain("<port isolated='yes'/>")
	})

	test('uses the legacy BIOS device profile without NVRAM', () => {
		const xml = buildDomainXml({
			definition: definition({
				platformProfile: 'legacy-x86',
				machineType: 'pc-i440fx-9.2',
				firmware: 'bios',
			}),
			machineDirectory: '/data/machines/legacy',
			runtimeDirectory: '/run/umbrel-machines/legacy',
			acceleration: 'kvm',
		})

		expect(xml).toContain("machine='pc-i440fx-9.2'")
		expect(xml).toContain("target dev='hda' bus='ide'")
		expect(xml).toContain("model type='rtl8139'")
		expect(xml).not.toContain('<loader')
		expect(xml).not.toContain('<nvram>')
	})

	test('uses a custom external disk path and SATA compatibility target without colliding with install media', () => {
		const xml = buildDomainXml({
			definition: definition({diskBus: 'sata', installMedia: 'media/install.iso'}),
			machineDirectory: '/run/umbrel-machines/import/storage',
			runtimeDirectory: '/run/umbrel-machines/import',
			diskPath: '/run/umbrel-machines/import/external-disk.qcow2',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
		})

		expect(xml).toContain("source file='/run/umbrel-machines/import/external-disk.qcow2'")
		expect(xml).toContain("target dev='sda' bus='sata'")
		expect(xml).toContain("target dev='sdb' bus='sata'")
		expect(xml).toContain(
			"source file='/run/umbrel-machines/import/storage/media/install.iso' startupPolicy='optional'",
		)
		expect(xml).not.toContain("target dev='vda' bus='virtio'")
	})

	test('uses secure boot, canonical TPM state, and virtio devices for Windows 11', () => {
		const xml = buildDomainXml({
			definition: definition({secureBoot: true, tpm: true}),
			machineDirectory: '/data/machines/windows-11',
			runtimeDirectory: '/run/umbrel-machines/windows-11',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/OVMF/OVMF_CODE_4M.ms.fd',
		})

		expect(xml).toContain("<loader readonly='yes' secure='yes' type='pflash'>")
		expect(xml).toContain("<smm state='on'/>")
		expect(xml).toContain("<backend type='emulator' version='2.0' persistent_state='yes'/>")
		expect(xml).not.toContain('/data/machines/windows-11/tpm')
		expect(xml).toContain("target dev='vda' bus='virtio'")
		expect(xml).toContain("model type='virtio'")
	})

	test('uses ARM secure boot, TPM, virtio devices, and removable install media for Windows 11 on Arm', () => {
		const xml = buildDomainXml({
			definition: definition({
				osId: 'windows-11',
				arch: 'arm64',
				platformProfile: 'modern-arm64',
				machineType: 'virt-9.2',
				secureBoot: true,
				tpm: true,
				installMedia: 'media/install.img',
			}),
			machineDirectory: '/data/machines/windows-11-arm',
			runtimeDirectory: '/run/umbrel-machines/windows-11-arm',
			acceleration: 'kvm',
			firmwareCode: '/usr/share/AAVMF/AAVMF_CODE.ms.fd',
		})

		expect(xml).toContain("arch='aarch64' machine='virt-9.2'")
		expect(xml).not.toContain("secure='yes'")
		expect(xml).toContain('/usr/share/AAVMF/AAVMF_CODE.ms.fd')
		expect(xml).toContain("target dev='vda' bus='virtio'")
		expect(xml).toContain("target dev='sda' bus='usb' removable='on'")
		expect(xml).toContain("source file='/data/machines/windows-11-arm/media/install.img' startupPolicy='optional'")
		expect(xml).toContain("<input type='keyboard' bus='usb'/>")
		expect(xml).toContain("<tpm model='tpm-tis'>")
		expect(xml).toContain("<video><model type='none'/></video>")
		expect(xml).toContain("<qemu:arg value='ramfb'/>")
		expect(xml).toContain("<backend type='emulator' version='2.0' persistent_state='yes'/>")
	})

	test('uses SeaBIOS, SATA, e1000, and VGA for Windows 7', () => {
		const xml = buildDomainXml({
			definition: definition({platformProfile: 'windows-7-x86', firmware: 'bios', installMedia: 'media/install.iso'}),
			machineDirectory: '/data/machines/windows-7',
			runtimeDirectory: '/run/umbrel-machines/windows-7',
			acceleration: 'kvm',
		})

		expect(xml).toContain("target dev='sda' bus='sata'")
		expect(xml).toContain("target dev='sdb' bus='sata'")
		expect(xml).toContain("source file='/data/machines/windows-7/media/install.iso' startupPolicy='optional'")
		expect(xml).toContain("model type='e1000'")
		expect(xml).toContain("<video><model type='vga'")
		expect(xml).not.toContain('<loader')
	})

	test('uses a 512 MiB APM-era ISA NE2000 profile for Windows 98', () => {
		const xml = buildDomainXml({
			definition: definition({
				platformProfile: 'windows-98-x86',
				firmware: 'bios',
				memoryMb: 512,
				installMedia: 'media/install.iso',
				bootMedia: 'media/boot.img',
			}),
			machineDirectory: '/data/machines/windows-98',
			runtimeDirectory: '/run/umbrel-machines/windows-98',
			acceleration: 'kvm',
		})

		expect(xml).toContain("<memory unit='MiB'>512</memory>")
		expect(xml).toContain("target dev='hda' bus='ide'")
		expect(xml).toContain("model type='ne2k_isa'")
		expect(xml).toContain("address type='isa' iobase='0x200' irq='3'")
		expect(xml).toContain("<features><apic/><vmport state='on'/></features>")
		expect(xml).toContain("device='floppy'")
		expect(xml).toContain("source file='/data/machines/windows-98/media/boot.img' startupPolicy='optional'")
		expect(xml).toContain("target dev='fda' bus='fdc'/><boot order='1'")
		expect(xml).toContain("<boot order='2'/>")
		expect(xml).toContain("target dev='hdb' bus='ide'/><readonly/><boot order='3'")
		expect(xml).toContain("source file='/data/machines/windows-98/media/install.iso' startupPolicy='optional'")
		expect(xml).not.toContain('<acpi/>')
	})
})
