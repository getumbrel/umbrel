import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {execa} from 'execa'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {
	prepareOmarchySeed,
	probeOmarchySetup,
	removeOmarchySetupCredentials,
	renderOmarchyConfiguration,
	renderOmarchySetupKey,
} from './omarchy-install.js'

vi.mock('execa', () => ({execa: vi.fn()}))
afterEach(() => vi.resetAllMocks())

describe('Omarchy unattended configuration', () => {
	test.each([25, 40, 100])('fits the standard unencrypted Btrfs layout into a %s GiB virtio disk', (diskSizeGb) => {
		const config = renderOmarchyConfiguration('my-omarchy', diskSizeGb)
		const disk = config.disk_config.device_modifications[0]
		const [boot, root] = disk.partitions
		expect(disk.device).toBe('/dev/vda')
		expect(disk.wipe).toBe(true)
		expect(boot.start.value).toBe(1024 ** 2)
		expect(boot.size.value).toBe(2 * 1024 ** 3)
		expect(boot.mountpoint).toBe('/boot')
		// Archinstall requires these fields even when their values are empty.
		expect(boot.mount_options).toEqual([])
		expect(boot.dev_path).toBeNull()
		expect(root.mountpoint).toBeNull()
		expect(root.dev_path).toBeNull()
		expect(root.start.value).toBe(boot.start.value + boot.size.value)
		expect(root.start.value + root.size.value).toBe(diskSizeGb * 1024 ** 3 - 1024 ** 2)
		expect(root.btrfs).toEqual([
			{name: '@', mountpoint: '/'},
			{name: '@home', mountpoint: '/home'},
			{name: '@log', mountpoint: '/var/log'},
			{name: '@pkg', mountpoint: '/var/cache/pacman/pkg'},
		])
		expect(config.disk_config).not.toHaveProperty('disk_encryption')
		expect(config.hostname).toBe('my-omarchy')
	})

	test('configures graceful poweroff before allowing the readiness-gated callback', () => {
		const key = renderOmarchySetupKey(
			'ssh-ed25519 AAAATEST umbrel-omarchy-first-boot\n',
			'http://10.203.0.1:22080/api/machines/first-boot/omarchy/test-token',
		)
		expect(key).toMatch(/^restrict,from="10\.203\.0\.1",command="\/bin\/bash -c '/)
		expect(key).toMatch(/ ssh-ed25519 AAAATEST umbrel-omarchy-first-boot\n$/)
		const encoded = key.match(/echo ([A-Za-z0-9+/=]+) \| base64/)![1]
		const script = Buffer.from(encoded, 'base64').toString()
		expect(script).toContain('test ! -d /run/archiso')
		expect(script).toContain('.finished_at != null and all(.phases[]; .status == "ok")')
		expect(key).toContain('exec 3<&0;')
		expect(script).toContain("sudo --stdin --prompt=''")
		expect(script).toContain('HandlePowerKey=poweroff')
		expect(script).toContain('hl.unbind("XF86PowerOff")')
		expect(script.indexOf('systemctl reload systemd-logind.service')).toBeLessThan(script.indexOf('curl '))
		expect(script.indexOf('systemctl is-active --quiet sddm.service')).toBeLessThan(script.indexOf('curl '))
		expect(script).toContain('--request POST')
		expect(script.indexOf('sed -i')).toBeGreaterThan(script.indexOf('curl '))
	})

	test('keeps the setup password off the configuration CD, sends it over stdin, and removes it with the key', async () => {
		const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omarchy-setup-'))
		const password = 'secret with spaces and \' " $characters'
		const media = path.join(directory, 'media')
		try {
			vi.mocked(execa).mockImplementation((async (command: string, args: string[]) => {
				if (command === 'mkpasswd') return {stdout: '$6$hashed-password'} as any
				if (command === 'ssh-keygen') {
					const key = args.at(-1)!
					await fsp.writeFile(key, 'private key', {mode: 0o600})
					await fsp.writeFile(`${key}.pub`, 'ssh-ed25519 AAAATEST')
				}
				if (command === 'genisoimage') {
					const seed = args.at(-1)!
					const files = await fsp.readdir(seed)
					expect(files.sort()).toEqual(['authorized_keys', 'user_configuration.json', 'user_credentials.json'])
					for (const file of files) expect(await fsp.readFile(path.join(seed, file), 'utf8')).not.toContain(password)
				}
				return {exitCode: 0, stdout: ''} as any
			}) as typeof execa)
			await prepareOmarchySeed(
				directory,
				{hostname: 'omarchy', diskSizeGb: 40, username: 'umbrel', password, completionUrl: 'http://host/ready'},
				new AbortController().signal,
			)
			const passwordFile = path.join(media, 'omarchy-setup-password')
			expect((await fsp.stat(passwordFile)).mode & 0o777).toBe(0o600)
			await probeOmarchySetup(directory, 'umbrel', '10.203.0.2')
			const [, args, options] = vi.mocked(execa).mock.calls.find(([command]) => command === 'ssh')! as any
			expect(args.join(' ')).not.toContain(password)
			expect(options.input).toBe(`${password}\n`)
			await removeOmarchySetupCredentials(directory)
			expect(await fsp.readdir(media)).toEqual([])
		} finally {
			await fsp.rm(directory, {recursive: true, force: true})
		}
	})
})
