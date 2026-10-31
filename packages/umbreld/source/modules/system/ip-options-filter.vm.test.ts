import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

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

describe('IP options filter', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
	})

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
