import nodePath from 'node:path'

export type MachineArchitecture = 'amd64' | 'arm64'
export type PlatformProfile = 'modern-x86' | 'windows-7-x86' | 'legacy-x86' | 'windows-98-x86' | 'modern-arm64'
export type PortForwardProtocol = 'tcp' | 'udp'
export const MACHINE_NETWORK_NAME = 'umbrel-machines'

export type PortForward = {
	id: string
	protocol: PortForwardProtocol
	hostPort: number
	guestPort: number
}

export type FirstBootSetup = {
	startedAt: number
	tokenHash: string
	// Some legacy installers need user interaction but still call home when
	// setup completes so their temporary install media can be detached.
	manual?: boolean
}

export type MachineInstallSource = {osId: string; imagePath?: never} | {osId?: never; imagePath: string}

export type MachineDefinition = {
	version: 1
	id: string
	name: string
	osId: string
	osName: string
	osVersion: string
	osVariant?: string
	arch: MachineArchitecture
	platformProfile: PlatformProfile
	machineType: string
	firmware: 'uefi' | 'bios'
	// Custom images can opt into broadly compatible SATA storage. Catalog
	// profiles keep using their profile-specific default when this is absent.
	diskBus?: 'virtio' | 'sata'
	// Files virtual path for a disk intentionally stored outside Umbrel data.
	// The canonical machine directory remains the source of truth for all other
	// machine state and records where this disk can be reattached after restore.
	diskPath?: string
	uuid: string
	macAddress: string
	ipAddress?: string
	diskSizeGb: number
	cores: number
	memoryMb: number
	username?: string
	autostart: boolean
	pinned: boolean
	createdAt: number
	firstBootSetup?: FirstBootSetup
	// Present only while the machine is being prepared. This contains no
	// credentials; it lets an interrupted install remain visible and recoverable
	// instead of looking like a valid stopped machine with no disk.
	installSource?: MachineInstallSource
	secureBoot?: boolean
	tpm?: boolean
	installMedia?: string
	seedMedia?: string
	bootMedia?: string
	portForwards: PortForward[]
}

export function machineDiskBus(definition: MachineDefinition) {
	if (definition.diskBus) return definition.diskBus
	if (definition.platformProfile === 'legacy-x86' || definition.platformProfile === 'windows-98-x86') return 'ide'
	if (definition.platformProfile === 'windows-7-x86') return 'sata'
	return 'virtio'
}

export function machineDiskTarget(definition: MachineDefinition) {
	const bus = machineDiskBus(definition)
	return bus === 'ide' ? 'hda' : bus === 'sata' ? 'sda' : 'vda'
}

export type HostVirtualization = {
	hostArchitecture: MachineArchitecture
	kvmAvailable: boolean
	libvirtAvailable: boolean
	acceleration: 'kvm' | 'tcg'
}

export const hostArchitecture = (): MachineArchitecture => (process.arch === 'arm64' ? 'arm64' : 'amd64')

export function defaultPlatformProfile(arch: MachineArchitecture): PlatformProfile {
	return arch === 'arm64' ? 'modern-arm64' : 'modern-x86'
}

export function defaultMachineType(profile: PlatformProfile) {
	switch (profile) {
		case 'modern-x86':
		case 'windows-7-x86':
			return 'pc-q35-9.2'
		case 'legacy-x86':
		case 'windows-98-x86':
			return 'pc-i440fx-9.2'
		case 'modern-arm64':
			return 'virt-9.2'
	}
}

// Legacy profiles carry PS/2 devices only. Everything else gets a USB tablet,
// which is what makes absolute pointer input from the console possible.
export function isLegacyPlatformProfile(profile: PlatformProfile) {
	return profile === 'legacy-x86' || profile === 'windows-98-x86'
}

export function architectureForProfile(profile: PlatformProfile): MachineArchitecture {
	return profile === 'modern-arm64' ? 'arm64' : 'amd64'
}

export function resolveAcceleration(guestArchitecture: MachineArchitecture, kvmAvailable: boolean) {
	return guestArchitecture === hostArchitecture() && kvmAvailable ? ('kvm' as const) : ('tcg' as const)
}

function escapeXml(value: string | number) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

export function buildDomainXml({
	definition,
	machineDirectory,
	runtimeDirectory,
	acceleration,
	firmwareCode,
	diskPath,
	graphicsRenderNode,
	audioPlaybackDevice,
}: {
	definition: MachineDefinition
	machineDirectory: string
	runtimeDirectory: string
	acceleration: 'kvm' | 'tcg'
	firmwareCode?: string
	diskPath?: string
	graphicsRenderNode?: string
	audioPlaybackDevice?: string
}) {
	if (!definition.ipAddress) throw new Error('[machine-ip-address-invalid]')
	const windows7 = definition.platformProfile === 'windows-7-x86'
	const windows98 = definition.platformProfile === 'windows-98-x86'
	const legacy = isLegacyPlatformProfile(definition.platformProfile)
	const modern = !legacy
	const arm = definition.arch === 'arm64'
	const windowsArm = arm && definition.osId === 'windows-11'
	const resolvedDiskPath = diskPath ?? nodePath.join(machineDirectory, 'disk.qcow2')
	const nvramPath = nodePath.join(machineDirectory, 'nvram.fd')
	const displaySocket = nodePath.join(runtimeDirectory, 'display.sock')
	const qemuLog = nodePath.join(runtimeDirectory, 'qemu.log')
	const diskBus = machineDiskBus(definition)
	const diskTarget = machineDiskTarget(definition)
	const networkModel = windows98
		? 'ne2k_isa'
		: windows7
			? 'e1000'
			: definition.platformProfile === 'legacy-x86'
				? 'rtl8139'
				: 'virtio'
	const networkAddress = windows98 ? "<address type='isa' iobase='0x200' irq='3'/>" : ''
	const emulator = definition.arch === 'arm64' ? '/usr/bin/qemu-system-aarch64' : '/usr/bin/qemu-system-x86_64'
	const loader =
		definition.firmware === 'uefi'
			? `<loader readonly='yes'${definition.secureBoot && !arm ? " secure='yes'" : ''} type='pflash'>${escapeXml(firmwareCode!)}</loader><nvram>${escapeXml(nvramPath)}</nvram>`
			: ''
	// Native ARM guests must use the interrupt controller exposed by the host:
	// Raspberry Pi 5 KVM provides GICv2, while server-class ARM hosts commonly
	// provide GICv3. TCG can consistently emulate GICv3.
	const features = arm
		? `<acpi/><gic version="${acceleration === 'kvm' ? 'host' : '3'}"/>`
		: windows98
			? "<apic/><vmport state='on'/>"
			: `<acpi/><apic/>${definition.secureBoot ? "<smm state='on'/>" : ''}`
	const cdrom = definition.installMedia
		? arm
			? windowsArm
				? `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${escapeXml(nodePath.join(machineDirectory, definition.installMedia))}' startupPolicy='optional'/><target dev='sda' bus='usb' removable='on'/><readonly/><boot order='${definition.bootMedia ? '3' : '2'}'/></disk>`
				: `<controller type='scsi' model='virtio-scsi'/><disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${escapeXml(nodePath.join(machineDirectory, definition.installMedia))}' startupPolicy='optional'/><target dev='sda' bus='scsi'/><readonly/><boot order='${definition.bootMedia ? '3' : '2'}'/></disk>`
			: `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${escapeXml(nodePath.join(machineDirectory, definition.installMedia))}' startupPolicy='optional'/><target dev='${windows7 || diskBus === 'sata' ? 'sdb' : modern ? 'sda' : 'hdb'}' bus='${modern ? 'sata' : 'ide'}'/><readonly/><boot order='${definition.bootMedia ? '3' : '2'}'/></disk>`
		: ''
	const bootFloppy = definition.bootMedia
		? `<controller type='fdc'/><disk type='file' device='floppy'><driver name='qemu' type='raw'/><source file='${escapeXml(nodePath.join(machineDirectory, definition.bootMedia))}' startupPolicy='optional'/><target dev='fda' bus='fdc'/><boot order='1'/></disk>`
		: ''
	const networkDriver = networkModel === 'virtio' ? "<driver name='vhost'/>" : ''
	const tpm = definition.tpm
		? `<tpm model='${arm ? 'tpm-tis' : 'tpm-crb'}'><backend type='emulator' version='2.0' persistent_state='yes'/></tpm>`
		: ''
	const videoModel = windows7 || windows98 ? 'vga' : definition.platformProfile === 'legacy-x86' ? 'cirrus' : 'virtio'
	const acceleratedGraphics = graphicsRenderNode
		? `<graphics type='egl-headless'><gl rendernode='${escapeXml(graphicsRenderNode)}'/></graphics>`
		: ''
	// Waydroid sizes Android's display once, from the output Cage finds at boot,
	// and Cage never switches modes afterwards, so give Android machines a
	// phone-shaped scanout up front instead of QEMU's 1280x800 default.
	const resolution = definition.osId === 'android' ? "<resolution x='720' y='1560'/>" : ''
	const video = windowsArm
		? "<video><model type='none'/></video>"
		: graphicsRenderNode
			? `<video><model type='virtio' heads='1' primary='yes'><acceleration accel3d='yes'/>${resolution}</model></video>`
			: `<video><model type='${videoModel}' primary='yes'>${resolution}</model></video>`
	// Keep HDA separate from libvirt's VNC audiodev. When they share one
	// backend QEMU lets VNC suspend it, leaving snd-aloop in PREPARED forever.
	// qemu:commandline also exposes ALSA's try-poll switch, which snd-aloop does
	// not support reliably.
	const qemuArguments = [
		// Keep Windows Arm on QEMU's firmware framebuffer throughout setup and
		// normal use. The upstream ARM viogpudo driver can black-screen recent
		// Windows 11 builds when it activates during unattended installation.
		...(windowsArm ? ['-device', 'ramfb'] : []),
		...(modern && audioPlaybackDevice
			? [
					'-audiodev',
					`alsa,id=umbrel-audio,out.dev=${audioPlaybackDevice.split(',').join(',,')},out.mixing-engine=on,out.fixed-settings=on,out.frequency=48000,out.channels=2,out.format=s16,out.try-poll=off`,
					'-device',
					'ich9-intel-hda,id=umbrel-sound,bus=pcie.0,addr=0x3',
					'-device',
					'hda-output,id=umbrel-sound-codec,bus=umbrel-sound.0,audiodev=umbrel-audio',
				]
			: []),
	]
	const qemuCommandline = qemuArguments.length
		? `<qemu:commandline>${qemuArguments.map((argument) => `<qemu:arg value='${escapeXml(argument)}'/>`).join('')}</qemu:commandline>`
		: ''
	const modernInputs = arm
		? "<controller type='usb' model='qemu-xhci'/><input type='tablet' bus='usb'/><input type='keyboard' bus='usb'/>"
		: "<controller type='usb' model='qemu-xhci'/><input type='tablet' bus='usb'/><input type='keyboard' bus='ps2'/>"

	return `<?xml version='1.0' encoding='UTF-8'?>
<domain type='${acceleration === 'kvm' ? 'kvm' : 'qemu'}' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>umbrel-machine-${escapeXml(definition.id)}</name>
  <uuid>${escapeXml(definition.uuid)}</uuid>
  <memory unit='MiB'>${definition.memoryMb}</memory>
  <currentMemory unit='MiB'>${definition.memoryMb}</currentMemory>
  <vcpu placement='static'>${definition.cores}</vcpu>
  <os>
    <type arch='${definition.arch === 'arm64' ? 'aarch64' : 'x86_64'}' machine='${escapeXml(definition.machineType)}'>hvm</type>
    ${loader}
  </os>
  <features>${features}</features>
  <cpu mode='${acceleration === 'kvm' ? 'host-passthrough' : 'maximum'}' check='none'/>
  <clock offset='utc'/>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>restart</on_crash>
  <seclabel type='dynamic' model='apparmor' relabel='yes'/>
  <devices>
    <emulator>${emulator}</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='none' discard='unmap'/>
      <source file='${escapeXml(resolvedDiskPath)}'/>
      <target dev='${diskTarget}' bus='${diskBus}'/>
      <boot order='${definition.bootMedia ? '2' : '1'}'/>
    </disk>
    ${cdrom}
    ${definition.seedMedia ? `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${escapeXml(nodePath.join(machineDirectory, definition.seedMedia))}' startupPolicy='optional'/><target dev='sdb' bus='sata'/><readonly/></disk>` : ''}
    ${bootFloppy}
		<interface type='network'>
			<mac address='${escapeXml(definition.macAddress)}'/>
			<source network='${MACHINE_NETWORK_NAME}'/>
			<port isolated='yes'/>
			<filterref filter='clean-traffic'><parameter name='IP' value='${escapeXml(definition.ipAddress)}'/></filterref>
			<model type='${networkModel}'/>
			${networkDriver}
			${networkAddress}
		</interface>
    <graphics type='vnc' socket='${escapeXml(displaySocket)}' sharePolicy='allow-exclusive'/>
    ${acceleratedGraphics}
    ${video}
    ${modern && !windows98 ? modernInputs : "<input type='mouse' bus='ps2'/><input type='keyboard' bus='ps2'/>"}
    <serial type='file'><source path='${escapeXml(qemuLog)}'/><target port='0'/></serial>
    <console type='file'><source path='${escapeXml(qemuLog)}'/><target type='serial' port='0'/></console>
    <memballoon model='virtio' freePageReporting='on'/>
    ${tpm}
  </devices>
  ${qemuCommandline}
</domain>
`
}
