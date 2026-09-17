import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {installPreStartHook} from '../system/custom-hooks.vm-test-helpers.js'
import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const dnsPortHolderScript = `#!/usr/bin/python3
import select
import socket

sockets = []
for socket_type in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
    server = socket.socket(socket.AF_INET, socket_type)
    server.bind(('0.0.0.0', 53))
    if socket_type == socket.SOCK_STREAM:
        server.listen()
    sockets.append(server)

while True:
    readable, _, _ = select.select(sockets, [], [])
    for server in readable:
        if server.type == socket.SOCK_STREAM:
            connection, _ = server.accept()
            connection.close()
        else:
            server.recvfrom(512)
`

const encodedDnsPortHolderScript = Buffer.from(dnsPortHolderScript).toString('base64')
const dnsPortHolderPreStartHook = `#!/bin/bash
set -eu

holder=/run/umbrel-test-dns-port-holder
printf '%s' '${encodedDnsPortHolderScript}' | base64 --decode > "$holder"
chmod 755 "$holder"

if ! systemctl is-active --quiet umbrel-test-dns-port-holder.service; then
  systemd-run --quiet --unit=umbrel-test-dns-port-holder /usr/bin/python3 "$holder"
fi

for attempt in $(seq 1 50); do
  if ss -Hlnpt 'sport = :53' | grep -Fq '0.0.0.0:53' && ss -Hlnpu 'sport = :53' | grep -Fq '0.0.0.0:53'; then
    exit 0
  fi
  sleep 0.1
done
exit 1
`

describe('Umbrel Machines host virtualization', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let machineId: string
	let failed = false
	const resourceUsage = () =>
		pRetry(
			() =>
				Promise.all([
					umbreld.client.system.cpuUsage.query(),
					umbreld.client.system.memoryUsage.query(),
					umbreld.client.system.diskUsage.query(),
				]),
			{retries: 5, minTimeout: 1_000, maxTimeout: 1_000},
		)

	beforeAll(async () => {
		const image = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../os/build/umbrelos-amd64.img')
		umbreld = await createTestVm({device: 'umbrel-home', image, memory: 4096})
		await umbreld.vm.powerOn()

		// Model a host-networked DNS app that starts before umbreld. Keep it in
		// place for the entire scenario so every VM lifecycle check runs with
		// TCP and UDP port 53 already occupied.
		await installPreStartHook(umbreld, dnsPortHolderPreStartHook)
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())
	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})
	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('ships a socket-activated libvirt/QEMU/nftables stack without persistent networks', async () => {
		const output = await umbreld.vm.sshAsRoot(`
set -eu
command -v virsh
command -v qemu-system-x86_64
command -v qemu-system-aarch64
command -v qemu-img
command -v dnsmasq
command -v nft
command -v arecord
command -v bsdtar
command -v xorriso
command -v genisoimage
command -v mformat
command -v wimlib-imagex
command -v mkfs.fat
command -v swtpm
dpkg-query --show qemu-system-modules-opengl libegl1
qemu-system-x86_64 -display help | grep -q '^egl-headless'
qemu-system-x86_64 -device help | grep -q 'virtio-vga-gl'
qemu-system-aarch64 -device help | grep -q 'virtio-gpu-gl'
test -e /usr/share/OVMF/OVMF_CODE_4M.fd
test -e /usr/share/OVMF/OVMF_CODE_4M.ms.fd
test -e /usr/share/AAVMF/AAVMF_CODE.fd
test -c /dev/snd/pcmC8D0p
grep -Fq '"/dev/snd/pcmC15D0p"' /etc/libvirt/qemu.conf
grep -Fqx 'firewall_backend = "nftables"' /etc/libvirt/network.conf
test ! -e /etc/libvirt/qemu/networks/default.xml
test "$(systemctl is-enabled libvirt-guests.service)" = masked
systemctl is-active libvirtd.socket
virsh --connect qemu:///system version
virsh --connect qemu:///system nwfilter-list | grep -Fq 'clean-traffic'
`)
		expect(output).toContain('active')
		expect(output).toContain('Using library: libvirt')
		expect(output).toContain('qemu-system-modules-opengl')
		expect(output).toContain('libegl1')
	})

	test('reports KVM or the supported TCG fallback', async () => {
		const capabilities = await umbreld.client.machines.capabilities.query()
		expect(capabilities.hostArchitecture).toBe('amd64')
		expect(capabilities.libvirtAvailable).toBe(true)
		expect(capabilities.guestHostAddress).toBe('10.203.0.1')
		expect(['kvm', 'tcg']).toContain(capabilities.nativeAcceleration)
		if (!capabilities.kvmAvailable) expect(capabilities.performanceWarning).toContain('software emulation')
	})

	test('starts the machine bridge without taking port 53 from host apps', async () => {
		await umbreld.client.machines.capabilities.query()
		const output = await umbreld.vm.sshAsRoot(`
set -eu
test "$(systemctl is-active umbrel-test-dns-port-holder.service)" = active
ss -Hlnpt 'sport = :53' | grep -Fq '0.0.0.0:53'
ss -Hlnpu 'sport = :53' | grep -Fq '0.0.0.0:53'
virsh --connect qemu:///system net-info umbrel-machines | grep -q '^Active:.*yes$'
virsh --connect qemu:///system net-dumpxml umbrel-machines | grep -Fq "<dns enable='no'/>"
echo coexisting
`)

		expect(output).toBe('coexisting')
	})

	test('binds only the minimal first-boot callback API to the guest bridge', async () => {
		const output = await umbreld.vm.sshAsRoot(`
set -eu
ss -Hlnpt | grep -F '10.203.0.1:22080'
! ss -Hlnpt | grep -F '0.0.0.0:22080'
curl --silent --output /dev/null --write-out '%{http_code}' http://10.203.0.1:22080/trpc
`)

		expect(output).toContain('10.203.0.1:22080')
		expect(output.trim().endsWith('404')).toBe(true)
	})

	test('ships native Linux templates in the built-in catalog', async () => {
		const allImages = await umbreld.client.machines.osImages.query()
		const images = allImages.filter(({platform}) => platform === 'linux')
		expect(
			images.map(({id, familyId, variantName, arch, requiresCredentials, state}) => ({
				id,
				familyId,
				variantName,
				arch,
				requiresCredentials,
				state,
			})),
		).toEqual([
			{
				id: 'ubuntu-26.04-desktop-amd64',
				familyId: 'ubuntu',
				variantName: 'Desktop',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'ubuntu-26.04-server-amd64',
				familyId: 'ubuntu',
				variantName: 'Server',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'fedora-44-desktop-amd64',
				familyId: 'fedora',
				variantName: 'Desktop',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'fedora-44-server-amd64',
				familyId: 'fedora',
				variantName: 'Server',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'debian-13-desktop-amd64',
				familyId: 'debian',
				variantName: 'Desktop',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'debian-13-server-amd64',
				familyId: 'debian',
				variantName: 'Server',
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'alpine-3.24.1-amd64',
				familyId: 'alpine',
				variantName: undefined,
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'android-13-amd64',
				familyId: 'android',
				variantName: undefined,
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
			{
				id: 'omarchy-4.0.4-amd64',
				familyId: 'omarchy',
				variantName: undefined,
				arch: 'amd64',
				requiresCredentials: true,
				state: 'available',
			},
		])
		expect(images.every((image) => !('cloudInit' in image) && !('sourceUrl' in image) && !('sha256' in image))).toBe(
			true,
		)
		const windows = allImages.filter(({platform}) => platform === 'windows')
		expect(windows.map(({familyId}) => familyId)).toEqual([
			'windows-11',
			'windows-server',
			'windows-7',
			'windows-xp',
			'windows-98',
		])
		expect(windows.every((image) => !('preview' in image))).toBe(true)
		expect(
			windows
				.filter(({familyId}) => ['windows-xp', 'windows-98'].includes(familyId))
				.every(({requiresLicenseKey}) => requiresLicenseKey),
		).toBe(true)
		expect(windows.find(({familyId}) => familyId === 'windows-98')?.manualSetup).toBe(true)
		expect(windows.filter(({familyId}) => familyId !== 'windows-98').every(({manualSetup}) => !manualSetup)).toBe(true)
		expect(windows.every((image) => !('windows' in image) && !('resources' in image) && !('sha256' in image))).toBe(
			true,
		)
	})

	test('rejects unauthenticated machine access', async () => {
		await expect(umbreld.unauthenticatedClient.machines.list.query()).rejects.toThrow()
		await expect(umbreld.unauthenticatedClient.machines.capabilities.query()).rejects.toThrow()
	})

	test('creates and boots a persistent VM from a Files disk image', async () => {
		// A four-byte boot program disables interrupts and halts forever. This
		// keeps the real QEMU lifecycle stable without downloading an external OS
		// or depending on a firmware screen that eventually times out.
		const disk = Buffer.alloc(1024 * 1024)
		disk.set([0xfa, 0xf4, 0xeb, 0xfd])
		disk.set([0x55, 0xaa], 510)
		await umbreld.api.post('files/upload?path=/Home/machines-blank.img', {body: disk})
		const machine = await umbreld.client.machines.create.mutate({
			name: 'VM test machine',
			imagePath: '/Home/machines-blank.img',
			arch: 'amd64',
			firmware: 'bios',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		machineId = machine.id
		expect(machineId).toBe('vm-test-machine')
		expect(machine.ipAddress).toBe('10.203.0.2')

		await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
				expect(current?.state).toBe('running')
				expect(['kvm', 'tcg']).toContain(current?.acceleration)
			},
			{retries: 60, minTimeout: 500, maxTimeout: 500},
		)
	})

	test('advertises a working guest resolver without running a DNS proxy', async () => {
		const output = await umbreld.vm.sshAsRoot(`
set -eu
config=/var/lib/libvirt/dnsmasq/umbrel-machines.conf
grep -Fqx 'port=0' "$config"
dns_servers=$(sed -n 's/^dhcp-option=option:dns-server,//p' "$config")
test -n "$dns_servers"
server=$(printf '%s' "$dns_servers" | cut -d, -f1)

# Confirm the host can reach the first resolver offered to guests. The existing
# libvirt NAT path remains unchanged and masquerades guest traffic through it.
python3 - "$server" <<'PY'
import socket
import sys

query = b'\\x12\\x34\\x01\\x00\\x00\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x07example\\x03com\\x00\\x00\\x01\\x00\\x01'
client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
client.settimeout(5)
client.sendto(query, (sys.argv[1], 53))
response, _ = client.recvfrom(512)
assert response[:2] == b'\\x12\\x34'
assert response[2] & 0x80
assert response[3] & 0x0f == 0
PY

test "$(systemctl is-active umbrel-test-dns-port-holder.service)" = active
ss -Hlnpt 'sport = :53' | grep -Fq '0.0.0.0:53'
ss -Hlnpu 'sport = :53' | grep -Fq '0.0.0.0:53'
echo configured
`)

		expect(output).toBe('configured')
	})

	test('recreates a power-management-suspended domain before starting it', async () => {
		// This tiny BIOS guest replaces its own first instruction with a halt loop,
		// persists that sector through INT 13h, then writes the Q35 ACPI S3 value.
		// The first boot therefore reaches pmsuspended; the recreated domain stays
		// running on its second boot without needing a heavyweight guest image.
		const disk = Buffer.alloc(1024 * 1024)
		disk.set([
			0xfa, 0x31, 0xc0, 0x8e, 0xd8, 0x8e, 0xc0, 0xc7, 0x06, 0x00, 0x7c, 0xfa, 0xf4, 0xc7, 0x06, 0x02, 0x7c, 0xeb, 0xfd,
			0xb8, 0x01, 0x03, 0xbb, 0x00, 0x7c, 0xb9, 0x01, 0x00, 0xb6, 0x00, 0xcd, 0x13, 0xba, 0x04, 0x06, 0xb8, 0x00, 0x24,
			0xef, 0xf4, 0xeb, 0xfd,
		])
		disk.set([0x55, 0xaa], 510)
		await umbreld.api.post('files/upload?path=/Home/machines-acpi-s3.img', {body: disk})
		const machine = await umbreld.client.machines.create.mutate({
			name: 'ACPI S3 test machine',
			imagePath: '/Home/machines-acpi-s3.img',
			arch: 'amd64',
			firmware: 'bios',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		const domain = `umbrel-machine-${machine.id}`

		await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machine.id)
				expect(current?.state).toBe('suspended')
				await expect(umbreld.vm.sshAsRoot(`virsh --connect qemu:///system domstate '${domain}'`)).resolves.toBe(
					'pmsuspended',
				)
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)

		await umbreld.client.machines.start.mutate({id: machine.id})
		await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machine.id)
				expect(current?.state).toBe('running')
			},
			{retries: 60, minTimeout: 500, maxTimeout: 500},
		)
		const domains = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system list --name | grep -Fxc '${domain}'`)
		expect(domains).toBe('1')

		await umbreld.client.machines.uninstall.mutate({id: machine.id})
	})

	test('exposes machine data through Files without allowing the machine root to be removed', async () => {
		const root = await umbreld.client.files.list.query({path: '/'})
		expect(root.files).toContainEqual(expect.objectContaining({path: '/Machines'}))

		const machines = await umbreld.client.files.list.query({path: '/Machines'})
		const machine = machines.files.find(({path}) => path === `/Machines/${machineId}`)
		expect(machine).toBeDefined()
		expect(machine?.operations).not.toEqual(expect.arrayContaining(['move', 'rename', 'trash', 'delete', 'share']))

		const files = await umbreld.client.files.list.query({path: `/Machines/${machineId}`})
		expect(files.files.map(({name}) => name)).toEqual(
			expect.arrayContaining(['disk.qcow2', 'machine.yaml', 'operations']),
		)
		for (const file of files.files) {
			expect(file.operations).not.toEqual(
				expect.arrayContaining(['writable', 'move', 'rename', 'trash', 'delete', 'share']),
			)
		}
		await expect(
			umbreld.client.files.rename.mutate({
				path: `/Machines/${machineId}/disk.qcow2`,
				newName: 'renamed.qcow2',
			}),
		).rejects.toThrow('[operation-not-allowed]')
		await expect(umbreld.client.files.trash.mutate({path: `/Machines/${machineId}/machine.yaml`})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('lists the running machine in every Live Usage resource breakdown', async () => {
		// Prime the cumulative libvirt CPU sample, then measure across a real interval.
		await umbreld.client.system.cpuUsage.query()
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		const [cpu, memory, storage] = await resourceUsage()

		for (const breakdown of [cpu.machines, memory.machines, storage.machines]) {
			expect(breakdown).toContainEqual(
				expect.objectContaining({id: machineId, name: 'VM test machine', osId: 'custom'}),
			)
		}
		expect(cpu.machines.find(({id}) => id === machineId)?.used).toBeGreaterThanOrEqual(0)
		expect(memory.machines.find(({id}) => id === machineId)?.used).toBeGreaterThan(0)
		expect(storage.machines.find(({id}) => id === machineId)?.used).toBeGreaterThan(0)
	})

	test('only lists running machines in CPU and memory usage while retaining stopped machine storage', async () => {
		await umbreld.client.machines.forceStop.mutate({id: machineId})

		// Runtime usage is cached for less than a second. Wait for a fresh
		// libvirt sample so this asserts the stopped state, not the prior sample.
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		const [stoppedCpu, stoppedMemory, stoppedStorage] = await resourceUsage()

		expect(stoppedCpu.machines).not.toContainEqual(expect.objectContaining({id: machineId}))
		expect(stoppedMemory.machines).not.toContainEqual(expect.objectContaining({id: machineId}))
		expect(stoppedStorage.machines).toContainEqual(
			expect.objectContaining({id: machineId, name: 'VM test machine', osId: 'custom'}),
		)

		// A newly started idle machine has no previous CPU delta and therefore
		// reports 0%. It must still reappear because inclusion follows libvirt's
		// running-domain set rather than filtering on the measured value.
		await umbreld.client.machines.start.mutate({id: machineId})
		await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
				expect(current?.state).toBe('running')
			},
			{retries: 60, minTimeout: 500, maxTimeout: 500},
		)
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		const [runningCpu, runningMemory] = await Promise.all([
			umbreld.client.system.cpuUsage.query(),
			umbreld.client.system.memoryUsage.query(),
		])
		expect(runningCpu.machines).toContainEqual(expect.objectContaining({id: machineId, used: expect.any(Number)}))
		expect(runningMemory.machines).toContainEqual(expect.objectContaining({id: machineId, used: expect.any(Number)}))
	})

	test('keeps hostile custom media in a transient AppArmor domain on the managed tap network', async () => {
		const domain = `umbrel-machine-${machineId}`
		const persistent = await umbreld.vm.sshAsRoot(
			`virsh --connect qemu:///system dominfo '${domain}' | awk '/Persistent:/ {print $2}'`,
		)
		expect(persistent.toLowerCase()).toBe('no')
		const networkInfo = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system net-info umbrel-machines`)
		expect(networkInfo).toContain('Active:         yes')
		expect(networkInfo).toContain('Persistent:     no')
		expect(networkInfo).toContain('Bridge:         umbrel-vm')
		const networkXml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system net-dumpxml umbrel-machines`)
		expect(networkXml).toContain("address='10.203.0.1'")
		expect(networkXml).toContain("port isolated='yes'")
		expect(networkXml).toContain(`name='${machineId}' ip='10.203.0.2'`)

		const xml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml '${domain}'`)
		expect(xml).toContain("interface type='network'")
		expect(xml).toContain("source network='umbrel-machines'")
		expect(xml).toContain("bridge='umbrel-vm'")
		expect(xml).toContain("port isolated='yes'")
		expect(xml).toContain("filterref filter='clean-traffic'")
		expect(xml).toContain("parameter name='IP' value='10.203.0.2'")
		expect(xml).toContain("driver name='vhost'")
		expect(xml).toMatch(/target dev='vnet\d+'/)
		expect(xml).toContain('ich9-intel-hda,id=umbrel-sound,bus=pcie.0,addr=0x3')
		expect(xml).toContain('hda-output,id=umbrel-sound-codec')
		expect(xml).toMatch(/alsa,id=umbrel-audio,out\.dev=hw:(?:8|9|1[0-5]),,0,,[0-7]/)
		expect(xml).toContain("model='apparmor'")
		expect(xml).toContain("<memballoon model='virtio' freePageReporting='on'")
		expect(xml).toContain(`/run/umbrel-machines/${machineId}/display.sock`)
		// Custom and server machines retain the universally available software
		// display even on hosts that expose a render node.
		expect(xml).not.toContain("type='egl-headless'")
		expect(xml).not.toContain('accel3d')

		await pRetry(
			async () => {
				const ready = await umbreld.vm.sshAsRoot(`
					test -S /run/umbrel-machines/${machineId}/display.sock
					findmnt --mountpoint /run/umbrel-machines/${machineId}/storage >/dev/null
					test -f /home/umbrel/umbrel/machines/${machineId}/machine.yaml
					test -f /home/umbrel/umbrel/machines/${machineId}/disk.qcow2
					echo ready
				`)
				expect(ready).toBe('ready')
			},
			{retries: 20, minTimeout: 250, maxTimeout: 250},
		)

		const networkRuntime = await umbreld.vm.sshAsRoot(`
set -eu
nft list table ip umbrel_machines >/dev/null
! pgrep -x passt >/dev/null
echo managed
`)
		expect(networkRuntime).toBe('managed')
	})

	test('persists memory in MiB as part of the portable machine schema', async () => {
		const definition = await umbreld.vm.sshAsRoot(`cat /home/umbrel/umbrel/machines/${machineId}/machine.yaml`)
		expect(definition).toContain('memoryMb: 1024')
		expect(definition).not.toContain('memoryGb:')
	})

	test('persists settings and applies a LAN forward outside domain XML', async () => {
		// The minimal guest cannot handle an ACPI shutdown, so use the public
		// force-stop escape hatch here.
		await umbreld.client.machines.forceStop.mutate({id: machineId})
		await umbreld.client.machines.updateSettings.mutate({
			id: machineId,
			autostart: true,
			portForwards: [
				{id: 'tcp-test', protocol: 'tcp', hostPort: 40_022, guestPort: 22_022},
				{id: 'udp-test', protocol: 'udp', hostPort: 40_053, guestPort: 53_053},
			],
		})
		await umbreld.client.machines.start.mutate({id: machineId})

		const xml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml umbrel-machine-${machineId}`)
		expect(xml).not.toContain('portForward')
		const rules = await umbreld.vm.sshAsRoot(`nft list table ip umbrel_machines`)
		expect(rules).toMatch(/iifname "[^"]+" fib daddr type local tcp dport 40022/)
		expect(rules).toContain('ip daddr != 127.0.0.0/8 fib daddr type local tcp dport 40022')
		expect(rules).toContain('dnat to 10.203.0.2:22022')
		expect(rules).toMatch(/iifname "[^"]+" fib daddr type local udp dport 40053/)
		expect(rules).toContain('dnat to 10.203.0.2:53053')
		expect(rules).not.toContain('ip daddr 127.0.0.1 tcp dport 40022')
	})

	test('keeps guests isolated while explicit TCP and UDP forwards remain usable', async () => {
		await umbreld.client.machines.forceStop.mutate({id: machineId})
		const result = await umbreld.vm.sshAsRoot(`
set -eu
tcp_pid=''
udp_pid=''
cleanup() {
  test -z "$tcp_pid" || kill "$tcp_pid" 2>/dev/null || true
  test -z "$udp_pid" || kill "$udp_pid" 2>/dev/null || true
  ip netns delete umbrel-test-a 2>/dev/null || true
  ip netns delete umbrel-test-b 2>/dev/null || true
  ip link delete umbrel-test-a 2>/dev/null || true
  ip link delete umbrel-test-b 2>/dev/null || true
}
trap cleanup EXIT

ip netns add umbrel-test-a
ip netns add umbrel-test-b
ip link add umbrel-test-a type veth peer name eth0 netns umbrel-test-a
ip link add umbrel-test-b type veth peer name eth0 netns umbrel-test-b
for side in a b; do
  ip link set "umbrel-test-$side" master umbrel-vm
  ip link set "umbrel-test-$side" up
  bridge link set dev "umbrel-test-$side" isolated on
  ip netns exec "umbrel-test-$side" ip link set lo up
  ip netns exec "umbrel-test-$side" ip link set eth0 up
done
ip netns exec umbrel-test-a ip address add 10.203.0.2/24 dev eth0
ip netns exec umbrel-test-a ip route add default via 10.203.0.1
ip netns exec umbrel-test-b ip address add 10.203.0.3/24 dev eth0
ip netns exec umbrel-test-b ip route add default via 10.203.0.1

! ip netns exec umbrel-test-a ping -c 1 -W 1 10.203.0.3 >/dev/null 2>&1
ip netns exec umbrel-test-a ip route add 10.203.0.3/32 via 10.203.0.1
! ip netns exec umbrel-test-a ping -c 1 -W 1 10.203.0.3 >/dev/null 2>&1

ip netns exec umbrel-test-a python3 -c 'import socket; s=socket.socket(); s.bind(("",22022)); s.listen(); c,_=s.accept(); c.sendall(b"tcp-forward")' &
tcp_pid=$!
ip netns exec umbrel-test-a python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.bind(("",53053)); _,a=s.recvfrom(64); s.sendto(b"udp-forward",a)' &
udp_pid=$!
sleep 1
lan_interface=$(ip -json route show default | jq -r 'sort_by(.metric // 0)[0].dev')
host_ip=$(ip -4 -json address show dev "$lan_interface" | jq -r '.[0].addr_info[] | select(.scope == "global") | .local' | head -n 1)
tcp=$(python3 -c 'import socket,sys; s=socket.create_connection((sys.argv[1],40022),5); print(s.recv(64).decode())' "$host_ip")
udp=$(python3 -c 'import socket,sys; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(5); s.sendto(b"test",(sys.argv[1],40053)); print(s.recv(64).decode())' "$host_ip")
printf '%s\n%s\n' "$tcp" "$udp"
`)

		expect(result.split('\n')).toEqual(['tcp-forward', 'udp-forward'])
		await umbreld.client.machines.start.mutate({id: machineId})
	})

	test('repairs Docker firewall chains without interrupting the VM or transient network', async () => {
		await umbreld.vm.sshAsRoot(`systemctl restart docker`)

		await pRetry(
			async () => {
				const health = await umbreld.vm.sshAsRoot(`
set -eu
test "$(virsh --connect qemu:///system domstate umbrel-machine-${machineId})" = running
virsh --connect qemu:///system net-info umbrel-machines | grep -q '^Persistent:.*no$'
nft list table ip umbrel_machines >/dev/null
test "$(nft list chain ip filter DOCKER-USER | grep -c 'comment "umbrel-machines"')" = 3
test "$(nft list chain ip libvirt_network guest_input | grep -c 'comment "umbrel-machines"')" = 1
test "$(nft list chain ip libvirt_network guest_cross | grep -c 'comment "umbrel-machines"')" = 1
echo healthy
`)
				expect(health).toBe('healthy')
			},
			{retries: 30, minTimeout: 500, maxTimeout: 500},
		)
	})

	test('grows a running machine disk through libvirt', async () => {
		await umbreld.client.machines.updateSettings.mutate({id: machineId, diskSizeGb: 2})
		const capacity = await umbreld.vm.sshAsRoot(
			`virsh --connect qemu:///system domblkinfo umbrel-machine-${machineId} vda | awk '/Capacity:/ {print $2}'`,
		)
		expect(Number(capacity)).toBe(2 * 1024 * 1024 * 1024)
	})

	test('reconstructs an autostart transient domain after a full OS reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await pRetry(
			async () => {
				const machine = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
				expect(machine?.state).toBe('running')
				expect(machine?.ipAddress).toBe('10.203.0.2')
				expect(machine?.portForwards[0]?.hostPort).toBe(40_022)
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)

		const persistent = await umbreld.vm.sshAsRoot(
			`virsh --connect qemu:///system dominfo umbrel-machine-${machineId} | awk '/Persistent:/ {print $2}'`,
		)
		expect(persistent.toLowerCase()).toBe('no')
		const network = await umbreld.vm.sshAsRoot(`
set -eu
virsh --connect qemu:///system net-info umbrel-machines | grep -q '^Persistent:.*no$'
virsh --connect qemu:///system net-dumpxml umbrel-machines | grep -q "name='${machineId}' ip='10.203.0.2'"
nft list table ip umbrel_machines | grep -q 'tcp dport 40022'
echo reconstructed
`)
		expect(network).toBe('reconstructed')
	})

	test('recovers an interrupted live backup after abrupt power loss', async () => {
		// Reproduce the durable state left after prepareBackup has pivoted QEMU
		// into an external overlay, then kill the outer umbrelOS VM. On the next
		// boot the ephemeral /run backing path is gone, so recovery must retarget
		// and commit the overlay before autostarting from canonical data. The tiny
		// fixture is intentionally BIOS-only, so add representative portable NVRAM
		// state here and verify that its live copy wins during recovery too.
		await umbreld.vm.sshAsRoot(`
set -eu
id='${machineId}'
domain="umbrel-machine-$id"
machine="/home/umbrel/umbrel/machines/$id"
operations="$machine/operations"
runtime="/run/umbrel-machines/$id/storage"
mkdir -p "$operations"
chown libvirt-qemu:libvirt-qemu "$operations"
printf 'frozen-nvram-state' > "$machine/nvram.fd"
virsh --connect qemu:///system suspend "$domain"
virsh --connect qemu:///system snapshot-create-as "$domain" interrupted-backup \
  --no-metadata --disk-only --atomic \
  --diskspec "vda,snapshot=external,file=$runtime/operations/backup-overlay.qcow2,driver=qcow2"
cp "$machine/nvram.fd" "$operations/backup-nvram-frozen.fd"
mv "$machine/nvram.fd" "$operations/backup-nvram-live.fd"
mv "$operations/backup-nvram-frozen.fd" "$machine/nvram.fd"
printf 'live-nvram-state' > "$operations/backup-nvram-live.fd"
cat > "$operations/backup.yaml" <<YAML
version: 1
machineId: $id
phase: pivoted
overlay: $operations/backup-overlay.qcow2
nvramLive: $operations/backup-nvram-live.fd
YAML
virsh --connect qemu:///system resume "$domain"
# The backup protocol operates on already-durable VM state. Flush this
# hand-built fixture before cutting power so the test isolates recovery from
# unrelated guest page-cache loss.
sync
`)

		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await pRetry(
			async () => {
				const machine = (await umbreld.client.machines.list.query()).find(({id}) => id === machineId)
				expect(machine?.state).toBe('running')
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)

		const recoveryState = await umbreld.vm.sshAsRoot(`
machine='/home/umbrel/umbrel/machines/${machineId}'
journal=$(test -e "$machine/operations/backup.yaml" && echo present || echo absent)
overlay=$(test -e "$machine/operations/backup-overlay.qcow2" && echo present || echo absent)
source=$(virsh --connect qemu:///system domblklist 'umbrel-machine-${machineId}' --details | awk '$3 == "vda" {print $4}')
backing=$(qemu-img info --force-share --output=json "$machine/disk.qcow2" | jq -r '.["backing-filename"] // "none"')
nvram=$(cat "$machine/nvram.fd")
printf 'journal=%s\noverlay=%s\nsource=%s\nbacking=%s\nnvram=%s\n' "$journal" "$overlay" "$source" "$backing" "$nvram"
`)
		expect(recoveryState.split('\n')).toEqual([
			'journal=absent',
			'overlay=absent',
			`source=/run/umbrel-machines/${machineId}/storage/disk.qcow2`,
			'backing=none',
			'nvram=live-nvram-state',
		])
	})

	test('runs a cross-architecture custom guest through TCG', async () => {
		const machine = await umbreld.client.machines.create.mutate({
			name: 'ARM64 TCG test machine',
			imagePath: '/Home/machines-blank.img',
			arch: 'arm64',
			platformProfile: 'modern-arm64',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})

		expect(machine.id).toBe('arm64-tcg-test-machine')
		expect(machine.ipAddress).toBe('10.203.0.3')
		expect(machine.state).toBe('installing')
		expect(machine.installPending).toBe(true)
		const running = await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machine.id)
				expect(current?.state).toBe('running')
				return current!
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)
		expect(running.installPending).toBe(false)
		expect(running.acceleration).toBe('tcg')
		expect(running.performanceWarning).toContain('cross-architecture software emulation')

		const xml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml umbrel-machine-${machine.id}`)
		expect(xml).toContain("<domain type='qemu'")
		expect(xml).toContain("<type arch='aarch64'")
		expect(xml).toContain("<cpu mode='maximum'")
		const networkWithLease = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system net-dumpxml umbrel-machines`)
		expect(networkWithLease).toContain(`name='${machine.id}' ip='10.203.0.3'`)

		await umbreld.client.machines.uninstall.mutate({id: machine.id})
		const networkWithoutLease = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system net-dumpxml umbrel-machines`)
		expect(networkWithoutLease).not.toContain(`name='${machine.id}'`)
		expect(networkWithoutLease).not.toContain("ip='10.203.0.3'")
	})

	test('uninstalls the domain and its complete canonical directory', async () => {
		await umbreld.client.machines.uninstall.mutate({id: machineId})
		await expect(umbreld.client.machines.list.query()).resolves.toEqual([])
		const exists = await umbreld.vm.sshAsRoot(`test ! -e /home/umbrel/umbrel/machines/${machineId} && echo removed`)
		expect(exists).toBe('removed')
	})
})
