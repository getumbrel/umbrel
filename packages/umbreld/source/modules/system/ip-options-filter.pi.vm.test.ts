import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The Pi VM runs under TCG emulation and first boot runs the full rugix
// bootstrap through the emulated SD card, so startup takes much longer than
// the default timeout.
const startupTimeout = 2_700_000

// Connects to a local listener with and without IPv4 options in the SYN.
// The listener never calls accept(): the kernel completes the handshake into
// the backlog, so a connect only fails if the SYN is dropped.
const probe = `python3 - <<'EOF'
import socket
listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.bind(('127.0.0.1', 0))
listener.listen()
port = listener.getsockname()[1]

def attempt(options):
	client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
	client.settimeout(3)
	if options:
		# NOP NOP NOP EOL: four bytes of options, so a header length of 6 words
		client.setsockopt(socket.IPPROTO_IP, socket.IP_OPTIONS, b'\\x01\\x01\\x01\\x00')
	try:
		client.connect(('127.0.0.1', port))
		return 'connected'
	except socket.timeout:
		return 'timeout'
	finally:
		client.close()

print(attempt(False), attempt(True))
EOF`

// Remove this test with the filter once the Raspberry Pi kernel has the fix
// for CVE-2026-98432 (see overlay-pi/opt/umbrel-ip-options-filter).
describe('Pi IP options filter', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', startupTimeout})
		await umbreld.vm.powerOn()
	}, startupTimeout + 60_000)

	afterAll(async () => await umbreld?.cleanup())

	test('loads the filter table at boot', async () => {
		expect((await umbreld.vm.sshAsRoot('systemctl is-active umbrel-ip-options-filter')).trim()).toBe('active')
		const rules = await umbreld.vm.sshAsRoot('nft list table ip umbrel_ip_options_filter')
		expect(rules).toContain('hook prerouting priority raw')
		expect(rules).toMatch(/ip protocol tcp ip hdrlength > 5 counter packets \d+ bytes \d+ drop/)
	})

	test('drops TCP SYNs that carry IP options and lets plain TCP through', async () => {
		expect((await umbreld.vm.ssh(probe)).trim()).toBe('connected timeout')
		const rules = await umbreld.vm.sshAsRoot('nft list table ip umbrel_ip_options_filter')
		expect(rules).not.toMatch(/counter packets 0 bytes 0 drop/)
	})
})
