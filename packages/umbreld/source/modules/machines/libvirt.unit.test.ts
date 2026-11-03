import {randomUUID} from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {MachineDefinition} from './domain.ts'
import {MACHINE_INSTALL_COMMAND_TIMEOUT_MS, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS} from './install-command.ts'
import Libvirt, {
	audioDevicesForSlot,
	buildWindows98Mbr,
	createWithGraphicsFallback,
	findGpuRenderNode,
	isClipboardAgentConnected,
	isMissingDomainError,
	parseQemuImgProgress,
	parseDomainResourceStats,
	MACHINE_SHORT_CONTROL_TIMEOUT_MS,
	qemuImageConvertArguments,
	qemuImageFormatForPath,
	qemuImageInfoArguments,
	supportsVirglGraphics,
} from './libvirt.ts'

const execaMock = vi.hoisted(() =>
	vi.fn(async (_command?: string, _arguments?: string[], _options?: Record<string, unknown>) => ({
		stdout: '',
		stderr: '',
		exitCode: 0,
	})),
)

vi.mock('execa', () => ({execa: execaMock}))

const temporaryDirectories: string[] = []

afterEach(async () => {
	execaMock.mockReset()
	execaMock.mockResolvedValue({stdout: '', stderr: '', exitCode: 0})
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
})

function definition(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
	return {
		version: 1,
		id: randomUUID(),
		name: 'Test machine',
		osId: 'ubuntu',
		osName: 'Ubuntu Desktop',
		osVersion: 'Ubuntu 26.04 LTS',
		osVariant: 'Desktop',
		arch: 'amd64',
		platformProfile: 'modern-x86',
		machineType: 'pc-q35-9.2',
		firmware: 'uefi',
		uuid: randomUUID(),
		macAddress: '02:00:00:00:00:01',
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

describe('virgl graphics', () => {
	test('selects the first character render device and ignores ordinary files', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-render-nodes-'))
		temporaryDirectories.push(root)
		await fsp.writeFile(nodePath.join(root, 'renderD128'), 'not a device')
		await fsp.symlink('/dev/null', nodePath.join(root, 'renderD129'))

		await expect(findGpuRenderNode(root)).resolves.toBe(nodePath.join(root, 'renderD129'))
	})

	test('returns no render node when the host has no GPU device', async () => {
		await expect(findGpuRenderNode('/path/that/does/not/exist')).resolves.toBeUndefined()
	})

	test('only enables virgl for built-in modern Linux desktops', () => {
		expect(supportsVirglGraphics(definition())).toBe(true)
		expect(supportsVirglGraphics(definition({osId: 'omarchy'}))).toBe(true)
		expect(supportsVirglGraphics(definition({osId: 'omarchy', osVariant: undefined}))).toBe(true)
		expect(supportsVirglGraphics(definition({arch: 'arm64', platformProfile: 'modern-arm64'}))).toBe(true)
		expect(supportsVirglGraphics(definition({osId: 'android', osVariant: undefined}))).toBe(true)
		expect(supportsVirglGraphics(definition({osVariant: 'Server'}))).toBe(false)
		expect(supportsVirglGraphics(definition({osId: 'custom'}))).toBe(false)
		expect(supportsVirglGraphics(definition({osId: 'windows-11'}))).toBe(false)
		expect(supportsVirglGraphics(definition({platformProfile: 'legacy-x86'}))).toBe(false)
	})

	test('starts directly with software graphics when no render node exists', async () => {
		const create = vi.fn(async () => {})
		const onFallback = vi.fn()

		await createWithGraphicsFallback(undefined, create, onFallback)

		expect(create).toHaveBeenCalledOnce()
		expect(create).toHaveBeenCalledWith()
		expect(onFallback).not.toHaveBeenCalled()
	})

	test('retries with software graphics when accelerated startup fails', async () => {
		const error = new Error('EGL initialization failed')
		const create = vi.fn(async (renderNode?: string) => {
			if (renderNode) throw error
		})
		const onFallback = vi.fn()

		await createWithGraphicsFallback('/dev/dri/renderD128', create, onFallback)

		expect(create.mock.calls).toEqual([['/dev/dri/renderD128'], []])
		expect(onFallback).toHaveBeenCalledWith(error)
	})
})

describe('clipboard agent', () => {
	test('reads whether the guest opened the vdagent port from the live domain XML', () => {
		const channel = (state: string) =>
			`<channel type='qemu-vdagent'><source><clipboard copypaste='yes'/><mouse mode='server'/></source><target type='virtio' name='com.redhat.spice.0' state='${state}'/><alias name='channel0'/></channel>`
		const guestAgent =
			"<channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0' state='connected'/></channel>"

		expect(isClipboardAgentConnected(`<devices>${channel('connected')}</devices>`)).toBe(true)
		expect(isClipboardAgentConnected(`<devices>${channel('disconnected')}${guestAgent}</devices>`)).toBe(false)
		expect(isClipboardAgentConnected('<devices></devices>')).toBe(false)
	})
})

describe('machine audio slots', () => {
	test('maps each slot to an independent snd-aloop playback/capture pair', () => {
		expect(audioDevicesForSlot(0)).toEqual({
			cardIndex: 8,
			playback: 'hw:8,0,0',
			capture: 'hw:8,1,0',
			playbackStatus: '/proc/asound/card8/pcm0p/sub0/status',
		})
		expect(audioDevicesForSlot(12)).toEqual({
			cardIndex: 9,
			playback: 'hw:9,0,4',
			capture: 'hw:9,1,4',
			playbackStatus: '/proc/asound/card9/pcm0p/sub4/status',
		})
		expect(audioDevicesForSlot(63)).toEqual({
			cardIndex: 15,
			playback: 'hw:15,0,7',
			capture: 'hw:15,1,7',
			playbackStatus: '/proc/asound/card15/pcm0p/sub7/status',
		})
		expect(() => audioDevicesForSlot(64)).toThrow('[machine-audio-slot-invalid]')
	})
})

describe('qemu-img conversion progress', () => {
	test('parses the newest streamed percentage', () => {
		expect(parseQemuImgProgress('    (12.34/100%)\r    (67.89/100%)\r')).toBe(67.89)
		expect(parseQemuImgProgress('no progress here')).toBeUndefined()
	})
})

describe('qemu-img input format', () => {
	test.each([
		['disk.qcow2', 'qcow2'],
		['disk.img', 'raw'],
		['disk.vmdk', 'vmdk'],
		['disk.vdi', 'vdi'],
		['disk.vhdx', 'vhdx'],
		['disk.vhd', 'vpc'],
	])('maps %s to an explicit %s driver', (path, expected) => {
		expect(qemuImageFormatForPath(path)).toBe(expected)
	})

	test('rejects formats that would require qemu-img probing', () => {
		expect(() => qemuImageFormatForPath('disk.unknown')).toThrow('[machine-image-format-unsupported]')
	})

	test('passes the selected input driver to both inspection and conversion', () => {
		expect(qemuImageInfoArguments('/input/disk.vmdk', 'vmdk')).toEqual([
			'info',
			'-f',
			'vmdk',
			'--output=json',
			'/input/disk.vmdk',
		])
		expect(qemuImageConvertArguments('/input/disk.vmdk', '/output/disk.qcow2', 'vmdk')).toEqual([
			'convert',
			'-p',
			'-f',
			'vmdk',
			'-O',
			'qcow2',
			'/input/disk.vmdk',
			'/output/disk.qcow2',
		])
	})

	test('cancels and bounds inspection, conversion, and resize commands', async () => {
		const controller = new AbortController()
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		execaMock.mockResolvedValueOnce({stdout: JSON.stringify({'virtual-size': 1}), stderr: '', exitCode: 0})

		await libvirt.convertDisk('/input/disk.img', '/output/disk.qcow2', 1, 'raw', controller.signal)

		const calls = execaMock.mock.calls as unknown as Array<[string, string[], Record<string, unknown>]>
		expect(calls.map(([, , options]) => options)).toEqual([
			{signal: controller.signal, timeout: MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS, cleanup: true},
			{signal: controller.signal, timeout: MACHINE_INSTALL_COMMAND_TIMEOUT_MS, cleanup: true},
			{signal: controller.signal, timeout: MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS, cleanup: true},
		])
	})
})

describe('libvirt machine resource stats', () => {
	test('parses CPU time and host RSS for every running Umbrel machine', () => {
		const stats = parseDomainResourceStats(`Domain: 'umbrel-machine-11111111-1111-4111-8111-111111111111'
  cpu.time=1500000000
  balloon.current=2097152
  balloon.rss=707476

Domain: 'unrelated-domain'
  cpu.time=999
  balloon.rss=999

Domain: 'umbrel-machine-22222222-2222-4222-8222-222222222222'
  cpu.time=2500000000
  balloon.rss=104164
`)

		expect(stats).toEqual([
			{
				id: '11111111-1111-4111-8111-111111111111',
				cpuTimeNs: 1_500_000_000,
				memoryBytes: 707_476 * 1024,
			},
			{
				id: '22222222-2222-4222-8222-222222222222',
				cpuTimeNs: 2_500_000_000,
				memoryBytes: 104_164 * 1024,
			},
		])
	})
})

describe('libvirt domain state', () => {
	test.each([
		['running', 'running'],
		['idle', 'running'],
		['blocked', 'running'],
		['paused', 'paused'],
		['pmsuspended', 'suspended'],
		['shut off', 'stopped'],
		['in shutdown', 'stopped'],
		['crashed', 'stopped'],
	] as const)('maps %s to %s', async (reported, expected) => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		execaMock.mockResolvedValueOnce({stdout: reported, stderr: '', exitCode: 0})

		await expect(libvirt.state('machine')).resolves.toBe(expected)
	})

	test('fails closed for an unrecognized successful response', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		execaMock.mockResolvedValueOnce({stdout: 'no state', stderr: '', exitCode: 0})

		await expect(libvirt.state('machine')).rejects.toThrow('[machine-state-unavailable] Unexpected state: no state')
	})

	test('only treats an explicitly missing domain as stopped', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)

		execaMock.mockResolvedValueOnce({
			stdout: '',
			stderr: "error: Domain not found: no domain with matching name 'vm'",
			exitCode: 1,
		})
		await expect(libvirt.state('missing')).resolves.toBe('stopped')
		execaMock.mockResolvedValueOnce({stdout: '', stderr: 'error: failed to connect to the hypervisor', exitCode: 1})
		await expect(libvirt.state('unknown')).rejects.toThrow('[machine-state-unavailable]')
	})

	test('force-stops a power-management-suspended domain with destroy', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		let destroyed = false
		execaMock.mockImplementation(async (command?: string, args?: string[]) => {
			if (command === 'virsh' && args?.includes('domstate')) {
				return {stdout: destroyed ? 'shut off' : 'pmsuspended', stderr: '', exitCode: 0}
			}
			if (command === 'virsh' && args?.includes('destroy')) destroyed = true
			return {stdout: '', stderr: '', exitCode: 0}
		})

		await expect(libvirt.stop('sleeping', {force: true})).resolves.toBeUndefined()
		expect(execaMock).toHaveBeenCalledWith(
			'virsh',
			['--connect', 'qemu:///system', 'destroy', 'umbrel-machine-sleeping'],
			{reject: false, timeout: 10_000},
		)
	})

	test('recognizes only libvirt missing-domain diagnostics', () => {
		expect(isMissingDomainError('Domain not found: no domain with matching name')).toBe(true)
		expect(isMissingDomainError("error: failed to get domain 'umbrel-machine-missing'")).toBe(true)
		expect(isMissingDomainError('failed to connect to the hypervisor')).toBe(false)
		expect(isMissingDomainError("error: failed to get domain 'umbrel-machine-missing': monitor unavailable")).toBe(
			false,
		)
	})
})

describe('machine firewall', () => {
	const managedDockerUserRules = [
		'-A DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT',
		'-A DOCKER-USER -o umbrel-vm -m conntrack --ctstate DNAT -m comment --comment umbrel-machines -j ACCEPT',
		'-A DOCKER-USER -o umbrel-vm -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment umbrel-machines -j ACCEPT',
		'-A DOCKER-USER -i umbrel-vm -m comment --comment umbrel-machines -j ACCEPT',
	]
	const managedLanBridgeRule =
		'-A DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT'
	const createLibvirt = () =>
		new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
	const calls = (command: string, prefix: string) =>
		execaMock.mock.calls
			.filter(([called, args]) => called === command && args?.join(' ').startsWith(prefix))
			.map(([, args]) => args!.join(' '))
	const mockFirewall = ({
		dockerUser = ['-N DOCKER-USER'],
		nftDockerUser = '',
		iptablesReadable = true,
		dockerUser6 = ['-N DOCKER-USER', managedLanBridgeRule],
		defaultRoute = () => 'enp1s0' as string | undefined,
	}: {
		dockerUser?: string[]
		nftDockerUser?: string
		iptablesReadable?: boolean
		// null when Docker doesn't manage ip6tables
		dockerUser6?: string[] | null
		defaultRoute?: () => string | undefined
	} = {}) =>
		execaMock.mockImplementation(async (command?: string, args: string[] = [], options: {reject?: boolean} = {}) => {
			const joined = args.join(' ')
			if (command === 'ip6tables' && joined === '-w -S DOCKER-USER') {
				if (dockerUser6) return {stdout: dockerUser6.join('\n'), stderr: '', exitCode: 0}
				return {stdout: '', stderr: 'ip6tables: No chain/target/match by that name.', exitCode: 1}
			}
			if (command === 'ip' && joined === '-json route show default') {
				const dev = defaultRoute()
				return {stdout: JSON.stringify(dev ? [{dev, metric: 100}] : []), stderr: '', exitCode: 0}
			}
			if (command === 'iptables' && joined === '-w -S DOCKER-USER') {
				if (iptablesReadable) return {stdout: dockerUser.join('\n'), stderr: '', exitCode: 0}
				const stderr = "iptables v1.8.11 (nf_tables): chain `DOCKER-USER' in table `filter' is incompatible"
				if (options.reject === false) return {stdout: '', stderr, exitCode: 1}
				throw new Error(stderr)
			}
			if (command === 'nft' && joined === '-a list chain ip filter DOCKER-USER') {
				return {stdout: nftDockerUser, stderr: '', exitCode: 0}
			}
			if (command === 'nft' && joined.includes('list chain ip libvirt_network')) {
				return {stdout: 'counter accept comment "umbrel-machines" # handle 100', stderr: '', exitCode: 0}
			}
			return {stdout: '', stderr: '', exitCode: 0}
		})

	test('writes DOCKER-USER rules with iptables so iptables can still read the filter table', async () => {
		mockFirewall()

		await createLibvirt().reconcileFirewall([])

		expect(calls('iptables', '-w -I')).toEqual([
			'-w -I DOCKER-USER -i umbrel-vm -m comment --comment umbrel-machines -j ACCEPT',
			'-w -I DOCKER-USER -o umbrel-vm -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment umbrel-machines -j ACCEPT',
			'-w -I DOCKER-USER -o umbrel-vm -m conntrack --ctstate DNAT -m comment --comment umbrel-machines -j ACCEPT',
			'-w -I DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT',
		])
		expect(calls('nft', 'insert rule ip filter')).toEqual([])
	})

	test('lets bridged traffic cross the LAN bridge despite Docker dropping forwarded IPv4 and IPv6', async () => {
		mockFirewall({dockerUser6: ['-N DOCKER-USER', managedLanBridgeRule, '-A DOCKER-USER -j RETURN']})

		await createLibvirt().reconcileFirewall([])

		expect(calls('iptables', '-w -I')).toContain(
			'-w -I DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT',
		)
		// The IPv6 rule is replaced, not stacked
		expect(calls('ip6tables', '-w -D')).toEqual([`-w ${managedLanBridgeRule.replace(/^-A/, '-D')}`])
		expect(calls('ip6tables', '-w -I')).toEqual([
			'-w -I DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT',
		])
	})

	test('skips IPv6 when Docker does not manage ip6tables', async () => {
		mockFirewall({dockerUser: ['-N DOCKER-USER', ...managedDockerUserRules], dockerUser6: null})

		await createLibvirt().reconcileFirewall([])
		expect(calls('ip6tables', '-w -I')).toEqual([])

		// And a missing IPv6 chain doesn't count as missing rules
		execaMock.mockClear()
		await createLibvirt().ensureFirewall([])
		expect(calls('iptables', '-w -I')).toEqual([])
	})

	test('reinstalls the IPv6 LAN bridge rule when it goes missing', async () => {
		mockFirewall({dockerUser: ['-N DOCKER-USER', ...managedDockerUserRules], dockerUser6: ['-N DOCKER-USER']})

		await createLibvirt().ensureFirewall([])

		expect(calls('ip6tables', '-w -I')).toHaveLength(1)
	})

	test('replaces only its own DOCKER-USER rules', async () => {
		mockFirewall({dockerUser: ['-N DOCKER-USER', ...managedDockerUserRules, '-A DOCKER-USER -j RETURN']})

		await createLibvirt().reconcileFirewall([])

		expect(calls('iptables', '-w -D')).toEqual(managedDockerUserRules.map((rule) => `-w ${rule.replace(/^-A/, '-D')}`))
	})

	test('removes DOCKER-USER rules older versions wrote with nft', async () => {
		mockFirewall({
			nftDockerUser: [
				'oifname "umbrel-vm" ct status dnat counter packets 0 bytes 0 accept comment "umbrel-machines" # handle 7',
				'counter packets 0 bytes 0 return # handle 4',
			].join('\n'),
		})

		await createLibvirt().reconcileFirewall([])

		expect(calls('nft', 'delete rule ip filter DOCKER-USER')).toEqual(['delete rule ip filter DOCKER-USER handle 7'])
		expect(calls('iptables', '-w -I')).toHaveLength(4)
	})

	test('leaves a complete rule set in place', async () => {
		mockFirewall({dockerUser: ['-N DOCKER-USER', ...managedDockerUserRules]})

		await createLibvirt().ensureFirewall([])

		expect(calls('iptables', '-w -I')).toEqual([])
	})

	test('reinstalls DOCKER-USER rules that have gone missing', async () => {
		mockFirewall({dockerUser: ['-N DOCKER-USER', managedDockerUserRules[0]]})

		await createLibvirt().ensureFirewall([])

		expect(calls('iptables', '-w -D')).toHaveLength(1)
		expect(calls('iptables', '-w -I')).toHaveLength(4)
	})

	test('rebinds port forwards when Umbrel moves to another LAN interface', async () => {
		let lanInterface: string | undefined = 'enp1s0'
		mockFirewall({dockerUser: ['-N DOCKER-USER', ...managedDockerUserRules], defaultRoute: () => lanInterface})
		const forwarded = definition({
			ipAddress: '10.203.0.2',
			portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}],
		})
		const libvirt = createLibvirt()
		const rulesets = () =>
			execaMock.mock.calls
				.filter(([command, args]) => command === 'nft' && args?.join(' ') === '-f -')
				.map(([, , options]) => String(options?.input))
		await libvirt.reconcileFirewall([forwarded])
		expect(rulesets().at(-1)).toContain('iifname "enp1s0" fib daddr type local tcp dport 40022')

		// Nothing changed, so nothing is rewritten
		vi.setSystemTime(Date.now() + 10_000)
		await libvirt.ensureFirewall([forwarded])
		expect(rulesets()).toHaveLength(1)

		// While the address is moving there's no default route, so leave the rules
		lanInterface = undefined
		vi.setSystemTime(Date.now() + 10_000)
		await libvirt.ensureFirewall([forwarded])
		expect(rulesets()).toHaveLength(1)

		// Once it's on the bridge bridged machines join the LAN through, follow it
		lanInterface = 'umbrel-lan'
		vi.setSystemTime(Date.now() + 10_000)
		await libvirt.ensureFirewall([forwarded])
		expect(rulesets()).toHaveLength(2)
		expect(rulesets().at(-1)).toContain('iifname "umbrel-lan" fib daddr type local tcp dport 40022')
		vi.useRealTimers()
	})

	test('waits for the default route while Umbrel moves onto or off the LAN bridge', async () => {
		let lookups = 0
		mockFirewall({defaultRoute: () => (++lookups < 3 ? undefined : 'umbrel-lan')})
		const forwarded = definition({
			ipAddress: '10.203.0.2',
			portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}],
		})

		await createLibvirt().reconcileFirewall([forwarded])

		expect(lookups).toBe(3)
		const ruleset = execaMock.mock.calls.find(([command, args]) => command === 'nft' && args?.join(' ') === '-f -')
		expect(String(ruleset?.[2]?.input)).toContain('iifname "umbrel-lan" fib daddr type local tcp dport 40022')
	})

	test('gives up on port forwards when Umbrel stays off the network', async () => {
		vi.useFakeTimers()
		try {
			mockFirewall({defaultRoute: () => undefined})
			const forwarded = definition({
				ipAddress: '10.203.0.2',
				portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}],
			})

			const reconcile = expect(createLibvirt().reconcileFirewall([forwarded])).rejects.toThrow(
				'[machine-lan-interface-unavailable]',
			)
			await vi.advanceTimersByTimeAsync(31_000)
			await reconcile
		} finally {
			vi.useRealTimers()
		}
	})

	test('does not stack duplicate rules when iptables cannot read DOCKER-USER', async () => {
		mockFirewall({iptablesReadable: false})

		await expect(createLibvirt().ensureFirewall([])).rejects.toThrow('incompatible')
		expect(calls('iptables', '-w -I')).toEqual([])
	})
})

describe('installation media eject', () => {
	test('ejects both Omarchy CDs after setup', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		const machine = definition({osId: 'omarchy', installMedia: 'media/install.iso', seedMedia: 'media/seed.iso'})
		execaMock.mockResolvedValueOnce({stdout: 'running', stderr: '', exitCode: 0})
		await libvirt.ejectInstallMedia(machine)
		const targets = execaMock.mock.calls
			.filter(([, args]) => args?.includes('change-media'))
			.map(([, args]) => args?.[4])
		expect(targets).toEqual(['sda', 'sdb'])
	})

	test('detaches a SATA installer from its actual live target', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		const machine = definition({diskBus: 'sata', installMedia: 'media/install.iso'})
		execaMock
			.mockResolvedValueOnce({stdout: 'running', stderr: '', exitCode: 0})
			.mockResolvedValueOnce({stdout: '', stderr: '', exitCode: 0})

		await expect(libvirt.ejectInstallMedia(machine)).resolves.toBeUndefined()
		expect(execaMock.mock.calls[1]).toEqual([
			'virsh',
			expect.arrayContaining(['change-media', 'umbrel-machine-' + machine.id, 'sdb', '--eject', '--live']),
			{reject: false, timeout: 10_000},
		])
	})

	test('fails safely when libvirt cannot detach live media', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		const machine = definition({installMedia: 'media/install.iso'})
		execaMock
			.mockResolvedValueOnce({stdout: 'running', stderr: '', exitCode: 0})
			.mockResolvedValueOnce({stdout: '', stderr: 'device is busy', exitCode: 1})

		await expect(libvirt.ejectInstallMedia(machine)).rejects.toThrow(
			'[machine-install-media-eject-failed] device is busy',
		)
		expect(execaMock.mock.calls[1]).toEqual([
			'virsh',
			expect.arrayContaining(['change-media', 'umbrel-machine-' + machine.id, '--eject', '--live']),
			{reject: false, timeout: 10_000},
		])
	})
})

describe('disk resize safety', () => {
	test('reads the virtual capacity from the qcow2 header', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		execaMock.mockResolvedValueOnce({
			stdout: JSON.stringify({'virtual-size': 64 * 1_024 ** 3}),
			stderr: '',
			exitCode: 0,
		})

		await expect(libvirt.diskVirtualSizeBytes('/data/machines/test/disk.qcow2')).resolves.toBe(64 * 1_024 ** 3)
		expect(execaMock).toHaveBeenCalledWith(
			'qemu-img',
			['info', '-f', 'qcow2', '--force-share', '--output=json', '/data/machines/test/disk.qcow2'],
			{reject: false},
		)
	})

	test('grows a live disk through libvirt', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		const machine = definition({id: 'safe-resize'})
		execaMock
			.mockResolvedValueOnce({stdout: 'running', stderr: '', exitCode: 0})
			.mockResolvedValueOnce({stdout: '', stderr: '', exitCode: 0})

		await libvirt.resizeDisk(machine, '/data/machines/safe-resize/disk.qcow2', 64)

		expect(execaMock.mock.calls[1]).toEqual([
			'virsh',
			['--connect', 'qemu:///system', 'blockresize', 'umbrel-machine-safe-resize', 'vda', '64G'],
		])
	})
})

describe('live USB passthrough', () => {
	async function libvirtWithRuntime(id: string) {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-machine-runtime-'))
		temporaryDirectories.push(root)
		const previousRoot = process.env.UMBREL_MACHINES_RUNTIME_DIR
		process.env.UMBREL_MACHINES_RUNTIME_DIR = root
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		if (previousRoot === undefined) delete process.env.UMBREL_MACHINES_RUNTIME_DIR
		else process.env.UMBREL_MACHINES_RUNTIME_DIR = previousRoot
		await fse.ensureDir(libvirt.runtimeDirectory(id))
		return libvirt
	}

	test('hotplugs and unplugs a device by its current host address', async () => {
		const libvirt = await libvirtWithRuntime('miner')
		const documents: string[] = []
		execaMock.mockImplementation(async (_command?: string, args?: string[]) => {
			documents.push(await fsp.readFile(args![4], 'utf8'))
			return {stdout: '', stderr: '', exitCode: 0}
		})

		await libvirt.attachUsbDevice('miner', {bus: 3, device: 7})
		await libvirt.detachUsbDevice('miner', {bus: 3, device: 2})

		expect(
			execaMock.mock.calls.map(([command, args, options]) => [command, args?.slice(2, 4), args?.[5], options]),
		).toEqual([
			['virsh', ['attach-device', 'umbrel-machine-miner'], '--live', {timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS}],
			['virsh', ['detach-device', 'umbrel-machine-miner'], '--live', {timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS}],
		])
		expect(documents).toEqual([
			"<hostdev mode='subsystem' type='usb'><source><address bus='3' device='7'/></source></hostdev>",
			"<hostdev mode='subsystem' type='usb'><source><address bus='3' device='2'/></source></hostdev>",
		])
		// The device XML is only needed for the duration of the command
		await expect(fsp.readdir(libvirt.runtimeDirectory('miner'))).resolves.toEqual([])
	})

	test('cleans up the device XML when libvirt refuses the device', async () => {
		const libvirt = await libvirtWithRuntime('miner')
		execaMock.mockRejectedValueOnce(new Error('USB device 003:007 is in use by driver QEMU, domain other'))

		await expect(libvirt.attachUsbDevice('miner', {bus: 3, device: 7})).rejects.toThrow('in use by driver QEMU')
		await expect(fsp.readdir(libvirt.runtimeDirectory('miner'))).resolves.toEqual([])
	})

	test('reads attached devices from the live domain and none from a stopped one', async () => {
		const libvirt = await libvirtWithRuntime('miner')
		execaMock
			.mockResolvedValueOnce({
				stdout:
					"<domain><devices><hostdev mode='subsystem' type='usb' managed='no'><source><address bus='3' device='2'/></source><alias name='hostdev0'/><address type='usb' bus='0' port='1'/></hostdev></devices></domain>",
				stderr: '',
				exitCode: 0,
			})
			.mockResolvedValueOnce({stdout: '', stderr: "error: failed to get domain 'umbrel-machine-miner'", exitCode: 1})

		await expect(libvirt.attachedUsbDevices('miner')).resolves.toEqual([{bus: 3, device: 2}])
		await expect(libvirt.attachedUsbDevices('miner')).resolves.toEqual([])
		expect(execaMock.mock.calls[0][1]).toEqual(['--connect', 'qemu:///system', 'dumpxml', 'umbrel-machine-miner'])
	})
})

describe('libvirt runtime cleanup', () => {
	test('removes runtime data after confirming failed unmounts are already detached', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-machine-runtime-'))
		temporaryDirectories.push(root)
		const previousRoot = process.env.UMBREL_MACHINES_RUNTIME_DIR
		process.env.UMBREL_MACHINES_RUNTIME_DIR = root
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		if (previousRoot === undefined) delete process.env.UMBREL_MACHINES_RUNTIME_DIR
		else process.env.UMBREL_MACHINES_RUNTIME_DIR = previousRoot
		await fse.ensureDir(libvirt.storageDirectory('detached'))
		execaMock.mockImplementation(async (command?: string) =>
			command === 'umount' ? {stdout: '', stderr: 'not mounted', exitCode: 32} : {stdout: '', stderr: '', exitCode: 32},
		)

		await libvirt.cleanupRuntime('detached')

		await expect(fse.pathExists(libvirt.runtimeDirectory('detached'))).resolves.toBe(false)
	})

	test('removes runtime data when its mount paths do not exist', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-machine-runtime-'))
		temporaryDirectories.push(root)
		const previousRoot = process.env.UMBREL_MACHINES_RUNTIME_DIR
		process.env.UMBREL_MACHINES_RUNTIME_DIR = root
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		if (previousRoot === undefined) delete process.env.UMBREL_MACHINES_RUNTIME_DIR
		else process.env.UMBREL_MACHINES_RUNTIME_DIR = previousRoot
		execaMock.mockImplementation(async (command?: string) => {
			if (command === 'mountpoint') throw new Error('mountpoint should not inspect a missing path')
			return {stdout: '', stderr: 'not mounted', exitCode: 32}
		})

		await expect(libvirt.cleanupRuntime('missing')).resolves.toBeUndefined()
	})

	test('preserves runtime data when a mount cannot be detached', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-machine-runtime-'))
		temporaryDirectories.push(root)
		const previousRoot = process.env.UMBREL_MACHINES_RUNTIME_DIR
		process.env.UMBREL_MACHINES_RUNTIME_DIR = root
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		if (previousRoot === undefined) delete process.env.UMBREL_MACHINES_RUNTIME_DIR
		else process.env.UMBREL_MACHINES_RUNTIME_DIR = previousRoot
		await fse.ensureDir(libvirt.storageDirectory('mounted'))
		execaMock.mockImplementation(async (command?: string) =>
			command === 'umount'
				? {stdout: '', stderr: 'permission denied', exitCode: 32}
				: {stdout: '', stderr: '', exitCode: 0},
		)

		await expect(libvirt.cleanupRuntime('mounted')).rejects.toThrow('[machine-runtime-unmount-failed]')
		await expect(fse.pathExists(libvirt.runtimeDirectory('mounted'))).resolves.toBe(true)
	})
})

describe('backup control command timeouts', () => {
	test('bounds suspend, resume, and external snapshot creation', async () => {
		const libvirt = new Libvirt({
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		} as unknown as Umbreld)
		const machine = definition({id: 'backup-timeout'})

		await libvirt.pause(machine.id)
		await libvirt.resume(machine.id)
		await libvirt.pivotToBackupOverlay(machine, '/data/machines/backup-timeout/operations/overlay.qcow2')
		const calls = execaMock.mock.calls as unknown as Array<[string, string[], Record<string, unknown>]>

		expect(calls.map(([, , options]) => options)).toEqual([
			{timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS},
			{reject: false, timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS},
			{timeout: MACHINE_SHORT_CONTROL_TIMEOUT_MS},
		])
		expect(calls[2][1]).toEqual(
			expect.arrayContaining(['snapshot-create-as', 'umbrel-machine-backup-timeout', '--atomic']),
		)
	})
})

describe('Windows 98 disk initialization', () => {
	test('creates one active FAT32 LBA partition after the 1 MiB alignment gap', () => {
		const diskSizeBytes = 16_000_000_000
		const mbr = buildWindows98Mbr(diskSizeBytes)
		const partition = 446

		expect(mbr).toHaveLength(512)
		expect(mbr[partition]).toBe(0x80)
		expect(mbr[partition + 4]).toBe(0x0c)
		expect(mbr.subarray(partition + 1, partition + 4)).toEqual(Buffer.from([0x20, 0x21, 0x00]))
		expect(mbr.subarray(partition + 5, partition + 8)).not.toEqual(Buffer.from([0xff, 0xff, 0xff]))
		expect(mbr.readUInt32LE(partition + 8)).toBe(2_048)
		expect(mbr.readUInt32LE(partition + 12)).toBe(Math.floor(diskSizeBytes / 512) - 2_048)
		expect(mbr.subarray(510)).toEqual(Buffer.from([0x55, 0xaa]))
	})

	test('rejects disks beyond the MBR sector-count limit', () => {
		expect(() => buildWindows98Mbr(3_000_000_000_000)).toThrow('[machine-windows-98-disk-size-unsupported]')
	})
})
