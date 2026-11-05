import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The test VM's own network is QEMU's user-mode network, whose built-in DHCP
// server plays the part of the user's router. A guest bridged onto the LAN
// should get its own lease from it, just like a physical device would.
//
// A network namespace plugged into the bridge stands in for that guest. umbrelOS
// ships no DHCP client a namespace can use, so this asks for a lease the way a
// guest OS does and prints it as "address/prefix router dns".
const dhcpProbeScript = `import random
import socket
import struct
import sys

interface = sys.argv[1]
mac = bytes.fromhex(open(f'/sys/class/net/{interface}/address').read().strip().replace(':', ''))
transaction = random.getrandbits(32)


def packet(message_type, options=b''):
    header = struct.pack('!BBBBIHHIIII', 1, 1, 6, 0, transaction, 0, 0x8000, 0, 0, 0, 0)
    return header + mac + bytes(10 + 192) + b'\\x63\\x82\\x53\\x63' + bytes([53, 1, message_type]) + options + b'\\xff'


def parse_options(raw):
    options = {}
    index = 0
    while index < len(raw) and raw[index] != 255:
        if raw[index] == 0:
            index += 1
            continue
        length = raw[index + 1]
        options[raw[index]] = raw[index + 2 : index + 2 + length]
        index += 2 + length
    return options


client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
client.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
client.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
client.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, interface.encode())
client.bind(('0.0.0.0', 68))
client.settimeout(3)


def exchange(message_type, options, expected_type):
    for _ in range(10):
        client.sendto(packet(message_type, options), ('255.255.255.255', 67))
        try:
            while True:
                data, _ = client.recvfrom(4096)
                if len(data) < 240 or struct.unpack('!I', data[4:8])[0] != transaction:
                    continue
                reply_options = parse_options(data[240:])
                if reply_options.get(53) == bytes([expected_type]):
                    return data, reply_options
        except socket.timeout:
            continue
    sys.exit(f'No DHCP reply of type {expected_type}')


offer, offer_options = exchange(1, b'', 2)
address = socket.inet_ntoa(offer[16:20])
server = offer_options[54]
_, ack_options = exchange(3, bytes([50, 4]) + socket.inet_aton(address) + bytes([54, 4]) + server, 5)
prefix = bin(struct.unpack('!I', ack_options[1])[0]).count('1')
print(f'{address}/{prefix} {socket.inet_ntoa(ack_options[3][:4])} {socket.inet_ntoa(ack_options[6][:4])}')
`

// Report which check failed, since a bare test command fails silently
const reportFailedStep = `step=start
trap 'status=$?; [ $status -eq 0 ] || echo "failed at: $step" >&2' EXIT`

describe('Umbrel Machines bridged networking', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let natMachineId: string
	let bridgedMachineId: string
	let lanInterface: string
	let lanMac: string
	let lanAddress: string

	const machine = async (id: string) => (await umbreld.client.machines.list.query()).find((item) => item.id === id)
	const waitForState = (id: string, state: string) =>
		pRetry(async () => expect((await machine(id))?.state).toBe(state), {
			retries: 120,
			minTimeout: 500,
			maxTimeout: 500,
		})
	const domainXml = (id: string) => umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml umbrel-machine-${id}`)
	const bridgeExists = async () =>
		(await umbreld.vm.sshAsRoot(`test -e /sys/class/net/umbrel-lan && echo yes || echo no`)) === 'yes'
	const ipv4Address = (device: string) =>
		umbreld.vm.sshAsRoot(
			`ip -4 -json address show dev ${device} | jq -r '[(.[0].addr_info // [])[] | select(.scope == "global") | .local][0] // empty'`,
		)

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home', memory: 4096})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		// A four-byte boot program that halts forever keeps the real QEMU lifecycle
		// stable without downloading an OS (see machines.vm.test.ts)
		const disk = Buffer.alloc(1024 * 1024)
		disk.set([0xfa, 0xf4, 0xeb, 0xfd])
		disk.set([0x55, 0xaa], 510)
		await umbreld.api.post('files/upload?path=/Home/halt.img', {body: disk})
		await umbreld.vm.sshAsRoot(
			`printf '%s' '${Buffer.from(dhcpProbeScript).toString('base64')}' | base64 --decode > /run/umbrel-test-dhcp-probe.py`,
		)
	})

	afterAll(async () => await umbreld?.cleanup())
	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})
	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const createHaltMachine = async (name: string, networkMode?: 'nat' | 'bridged') => {
		const created = await umbreld.client.machines.create.mutate({
			name,
			imagePath: '/Home/halt.img',
			arch: 'amd64',
			firmware: 'bios',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
			...(networkMode && {networkMode}),
		})
		await waitForState(created.id, 'running')
		return created.id
	}

	test('reports that machines can join the LAN over the wired interface', async () => {
		const capabilities = await umbreld.client.machines.capabilities.query()
		expect(capabilities.lanBridge.available).toBe(true)
		if (!capabilities.lanBridge.available) return
		lanInterface = capabilities.lanBridge.interface
		lanMac = await umbreld.vm.sshAsRoot(`cat /sys/class/net/${lanInterface}/address`)
		lanAddress = await ipv4Address(lanInterface)
		expect(lanAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/)

		// Nothing touches host networking until a machine needs the LAN
		expect(await bridgeExists()).toBe(false)
		await expect(umbreld.unauthenticatedClient.machines.capabilities.query()).rejects.toThrow()
	})

	test('keeps a NAT machine on the private network without touching host networking', async () => {
		natMachineId = await createHaltMachine('NAT machine')
		expect((await machine(natMachineId))?.networkMode).toBe('nat')

		const xml = await domainXml(natMachineId)
		expect(xml).toContain("<interface type='network'>")
		expect(xml).toContain("<source network='umbrel-machines'")
		expect(xml).toContain("<filterref filter='clean-traffic'>")

		// A forward on the NAT machine, to check it follows Umbrel onto the bridge
		await umbreld.client.machines.updateSettings.mutate({
			id: natMachineId,
			portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}],
		})
		expect(await umbreld.vm.sshAsRoot(`nft list table ip umbrel_machines`)).toContain(
			`iifname "${lanInterface}" fib daddr type local tcp dport 40022`,
		)
		expect(await bridgeExists()).toBe(false)
	})

	test('creates a bridged machine and moves Umbrel onto the LAN bridge', async () => {
		bridgedMachineId = await createHaltMachine('Bridged machine', 'bridged')
		expect((await machine(bridgedMachineId))?.networkMode).toBe('bridged')

		// The guest's card is a plain port on the LAN bridge: no NAT network, port
		// isolation or address filtering
		const xml = await domainXml(bridgedMachineId)
		expect(xml).toContain("<interface type='bridge'>")
		expect(xml).toContain("<source bridge='umbrel-lan'/>")
		expect(xml).not.toContain("<source network='umbrel-machines'")
		expect(xml).not.toContain('clean-traffic')
		expect(xml).not.toMatch(/<port isolated/)

		const output = await umbreld.vm.sshAsRoot(`
set -eu
${reportFailedStep}
lan=${lanInterface}
step='the bridge takes the interface MAC so the router keeps handing out the same lease'
test "$(cat /sys/class/net/umbrel-lan/address)" = "$(cat /sys/class/net/$lan/address)"
step='no spanning tree on the user network, so ports forward as soon as they join'
test "$(cat /sys/class/net/umbrel-lan/bridge/stp_state)" = 0
step='the wired interface and the guest tap are both ports'
test -e /sys/class/net/umbrel-lan/brif/$lan
tap=$(virsh --connect qemu:///system domiflist umbrel-machine-${bridgedMachineId} | awk '$2 == "bridge" {print $1}')
test -n "$tap"
test -e /sys/class/net/umbrel-lan/brif/$tap
step='the guest tap forwards'
bridge -json link show dev $tap | jq -e '.[0].state == "forwarding"' >/dev/null
step='the address left the wired interface'
test -z "$(ip -4 -json address show dev $lan | jq -r '(.[0].addr_info // [])[] | select(.scope == "global") | .local')"
step='the default route is on the bridge'
ip -json route show default | jq -e 'any(.[]; .dev == "umbrel-lan")' >/dev/null
step='remembered so the bridge comes back before NetworkManager starts on boot'
test "$(yq '.settings.lanBridge.mac' /home/umbrel/umbrel/umbrel.yaml)" = "$(cat /sys/class/net/$lan/address)"
echo bridged
`)
		expect(output).toBe('bridged')
		// Docker's FORWARD drop would discard everything crossing the bridge. The
		// managed rules are rewritten when the default route moves, so wait for it.
		await pRetry(
			async () =>
				expect(await umbreld.vm.sshAsRoot(`iptables -S DOCKER-USER`)).toContain(
					'-A DOCKER-USER -i umbrel-lan -o umbrel-lan -m comment --comment umbrel-machines -j ACCEPT',
				),
			{retries: 30, minTimeout: 500, maxTimeout: 500},
		)
		expect(await ipv4Address('umbrel-lan')).toBe(lanAddress)
		expect((await machine(natMachineId))?.state).toBe('running')
	})

	test('lists the wired interface with the address that now lives on the bridge', async () => {
		const interfaces = await umbreld.client.system.getNetworkInterfaces.query()
		expect(interfaces).toEqual([
			expect.objectContaining({id: lanInterface, mac: lanMac, type: 'ethernet', connected: true, ip: lanAddress}),
		])
	})

	test('gives a guest on the bridge its own lease from the router and two-way access to Umbrel', async () => {
		const output = await umbreld.vm.sshAsRoot(`
set -eu
cleanup() {
  ip netns delete umbrel-test-lan 2>/dev/null || true
  ip link delete umbrel-test-lan 2>/dev/null || true
}
trap cleanup EXIT
ip netns add umbrel-test-lan
ip link add umbrel-test-lan type veth peer name eth0 netns umbrel-test-lan
ip link set umbrel-test-lan master umbrel-lan
ip link set umbrel-test-lan up
ip netns exec umbrel-test-lan sh -c '
  ip link set lo up
  ip link set eth0 up
  # The guest has no route back to the DHCP server until it has a lease
  echo 0 > /proc/sys/net/ipv4/conf/all/rp_filter
  echo 0 > /proc/sys/net/ipv4/conf/eth0/rp_filter
'
ip netns exec umbrel-test-lan timeout 120 python3 /run/umbrel-test-dhcp-probe.py eth0 > /run/umbrel-test-lease
read -r address router dns < /run/umbrel-test-lease
ip netns exec umbrel-test-lan ip address add "$address" dev eth0
ip netns exec umbrel-test-lan ip route add default via "$router"
guest=\${address%/*}

# The guest sits on the same network as Umbrel with an address of its own
test "$guest" != "${lanAddress}"
test "$router" = "$(ip -json route show default | jq -r '.[0].gateway')"
echo "lease $guest"

# Umbrel and the guest reach each other directly, like any two LAN devices.
# This is what lets something like Home Assistant use apps running on Umbrel.
ip netns exec umbrel-test-lan ping -c 1 -W 5 ${lanAddress} >/dev/null
ping -c 1 -W 5 "$guest" >/dev/null
ip netns exec umbrel-test-lan curl --silent --max-time 10 --output /dev/null --write-out 'umbrel http %{http_code}\\n' http://${lanAddress}/

# And it reaches the rest of the network through the router, here its DNS server
ip netns exec umbrel-test-lan python3 - "$dns" <<'PY'
import socket
import sys

query = b'\\x12\\x34\\x01\\x00\\x00\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x07example\\x03com\\x00\\x00\\x01\\x00\\x01'
client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
client.settimeout(5)
client.sendto(query, (sys.argv[1], 53))
response, _ = client.recvfrom(512)
assert response[:2] == b'\\x12\\x34'
print('router dns ok')
PY
`)
		const lines = output.split('\n')
		expect(lines[0]).toMatch(/^lease \d+\.\d+\.\d+\.\d+$/)
		expect(lines[1]).toMatch(/^umbrel http [1-5]\d\d$/)
		expect(lines[2]).toBe('router dns ok')
	})

	test('moves NAT port forwards onto the bridge with Umbrel', async () => {
		await pRetry(
			async () =>
				expect(await umbreld.vm.sshAsRoot(`nft list table ip umbrel_machines`)).toContain(
					'iifname "umbrel-lan" fib daddr type local tcp dport 40022',
				),
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
	})

	test('only lets NAT machines forward ports', async () => {
		await expect(
			umbreld.client.machines.updateSettings.mutate({
				id: bridgedMachineId,
				portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_023, guestPort: 22}],
			}),
		).rejects.toThrow('[machine-port-forwards-nat-only]')
		await expect(
			umbreld.client.machines.updateSettings.mutate({id: natMachineId, networkMode: 'bridged'}),
		).rejects.toThrow('[machine-port-forwards-nat-only]')
	})

	test('keeps machines on the bridge through a static IP change', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query())[0]
		// Re-apply the DHCP values as static settings so QEMU's forwards keep working
		const setStaticIp = umbreld.client.system.setStaticIp.mutate({
			mac: before.mac,
			ip: before.ip!,
			subnetPrefix: before.subnetPrefix!,
			gateway: before.gateway!,
			dns: before.dns!,
		})
		await pRetry(
			async () =>
				expect(await umbreld.vm.sshAsRoot(`nmcli --get-values ipv4.method connection show umbrel-lan`)).toBe('manual'),
			{retries: 50, minTimeout: 200, maxTimeout: 200},
		)
		await umbreld.client.system.confirmStaticIp.mutate({ip: before.ip!})
		await setStaticIp

		// Taking the bridge's connection down and up would have detached the guest
		const output = await umbreld.vm.sshAsRoot(`
set -eu
${reportFailedStep}
step='the guest tap is still attached'
tap=$(virsh --connect qemu:///system domiflist umbrel-machine-${bridgedMachineId} | awk '$2 == "bridge" {print $1}')
test -e /sys/class/net/umbrel-lan/brif/$tap
step='the wired interface is still attached'
test -e /sys/class/net/umbrel-lan/brif/${lanInterface}
echo attached
`)
		expect(output).toBe('attached')
		const after = (await umbreld.client.system.getNetworkInterfaces.query())[0]
		expect(after).toMatchObject({id: lanInterface, ipMethod: 'static', ip: before.ip})
		expect(after.configuredStaticSettings).toEqual({
			ip: before.ip,
			subnetPrefix: before.subnetPrefix,
			gateway: before.gateway,
			dns: before.dns,
		})
	})

	test('restores the bridge and its static IP before NetworkManager starts after a reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForState(bridgedMachineId, 'running')
		await waitForState(natMachineId, 'running')

		const output = await umbreld.vm.sshAsRoot(`
set -eu
${reportFailedStep}
lan=${lanInterface}
step='umbrel-static-ip-restore wrote the bridge connections'
test -e /etc/NetworkManager/system-connections/umbrel-lan.nmconnection
test -e /etc/NetworkManager/system-connections/umbrel-lan-port.nmconnection
step='the static settings went on the bridge, not on the interface'
test ! -e /etc/NetworkManager/system-connections/static-ip-$lan.nmconnection
test "$(nmcli --get-values ipv4.method connection show umbrel-lan)" = manual
step='the interface is a bridge port'
test "$(nmcli --get-values GENERAL.CONNECTION device show $lan)" = umbrel-lan-port
step='NetworkManager never brought the interface up on its own, so the address did not move after apps started'
! journalctl --boot --unit NetworkManager --no-pager | grep "device ($lan): Activation: starting connection" | grep -v "'umbrel-lan-port'"
step='the autostarted guest is on the bridge'
tap=$(virsh --connect qemu:///system domiflist umbrel-machine-${bridgedMachineId} | awk '$2 == "bridge" {print $1}')
test -e /sys/class/net/umbrel-lan/brif/$tap
echo restored
`)
		expect(output).toBe('restored')
		expect(await ipv4Address('umbrel-lan')).toBe(lanAddress)
		await pRetry(
			async () =>
				expect(await umbreld.vm.sshAsRoot(`nft list table ip umbrel_machines`)).toContain(
					'iifname "umbrel-lan" fib daddr type local tcp dport 40022',
				),
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
	})

	test('hands Umbrel back to the wired interface once no machine is bridged', async () => {
		// Switching takes effect on the next start, so a running machine keeps the
		// bridge until it stops
		await expect(
			umbreld.client.machines.updateSettings.mutate({id: bridgedMachineId, networkMode: 'nat'}),
		).resolves.toMatchObject({networkMode: 'nat'})
		await new Promise((resolve) => setTimeout(resolve, 5_000))
		expect(await bridgeExists()).toBe(true)

		await umbreld.client.machines.forceStop.mutate({id: bridgedMachineId})
		await pRetry(async () => expect(await bridgeExists()).toBe(false), {
			retries: 60,
			minTimeout: 1_000,
			maxTimeout: 1_000,
		})

		// The address and its static settings are back on the interface
		await pRetry(async () => expect(await ipv4Address(lanInterface)).toBe(lanAddress), {
			retries: 60,
			minTimeout: 500,
			maxTimeout: 500,
		})
		const output = await umbreld.vm.sshAsRoot(`
set -eu
${reportFailedStep}
lan=${lanInterface}
step='the static settings are back on the interface'
connection=$(nmcli --get-values GENERAL.CONNECTION device show $lan)
test "$(nmcli --get-values ipv4.method connection show "$connection")" = manual
step='the bridge is forgotten for the next boot'
test "$(yq '.settings.lanBridge' /home/umbrel/umbrel/umbrel.yaml)" = null
test ! -e /etc/NetworkManager/system-connections/umbrel-lan.nmconnection
test ! -e /etc/NetworkManager/system-connections/umbrel-lan-port.nmconnection
echo unbridged
`)
		expect(output).toBe('unbridged')
		await pRetry(
			async () =>
				expect(await umbreld.vm.sshAsRoot(`nft list table ip umbrel_machines`)).toContain(
					`iifname "${lanInterface}" fib daddr type local tcp dport 40022`,
				),
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)

		// It starts back up on the private network
		await umbreld.client.machines.start.mutate({id: bridgedMachineId})
		expect(await domainXml(bridgedMachineId)).toContain("<source network='umbrel-machines'")
		expect(await bridgeExists()).toBe(false)
	})

	test('boots with the wired interface untouched once no machine is bridged', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForState(bridgedMachineId, 'running')

		expect(await bridgeExists()).toBe(false)
		expect(await ipv4Address(lanInterface)).toBe(lanAddress)
		const interfaces = await umbreld.client.system.getNetworkInterfaces.query()
		expect(interfaces[0]).toMatchObject({id: lanInterface, ipMethod: 'static', ip: lanAddress})
		await umbreld.client.system.clearStaticIp.mutate({mac: lanMac})
	})

	test('removes the bridge when the last bridged machine is uninstalled', async () => {
		await umbreld.client.machines.forceStop.mutate({id: bridgedMachineId})
		await umbreld.client.machines.updateSettings.mutate({id: bridgedMachineId, networkMode: 'bridged'})
		await umbreld.client.machines.start.mutate({id: bridgedMachineId})
		expect(await domainXml(bridgedMachineId)).toContain("<source bridge='umbrel-lan'/>")
		expect(await bridgeExists()).toBe(true)
		await pRetry(async () => expect(await ipv4Address('umbrel-lan')).toBe(lanAddress), {
			retries: 60,
			minTimeout: 500,
			maxTimeout: 500,
		})

		await umbreld.client.machines.uninstall.mutate({id: bridgedMachineId})
		await pRetry(async () => expect(await bridgeExists()).toBe(false), {
			retries: 60,
			minTimeout: 1_000,
			maxTimeout: 1_000,
		})
		await pRetry(async () => expect(await ipv4Address(lanInterface)).toBe(lanAddress), {
			retries: 60,
			minTimeout: 500,
			maxTimeout: 500,
		})
		expect((await machine(natMachineId))?.state).toBe('running')
	})
})
