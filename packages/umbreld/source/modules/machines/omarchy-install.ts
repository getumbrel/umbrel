import fsp from 'node:fs/promises'
import path from 'node:path'

import {execa} from 'execa'
import fse from 'fs-extra'

import {installCommandOptions, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS} from './install-command.js'
import {MACHINE_GUEST_HOST_ADDRESS} from './machine-network.js'

const setupKeyName = 'omarchy-setup-key'
const setupPasswordName = 'omarchy-setup-password'
const setupKeyComment = 'umbrel-omarchy-first-boot'

// Omarchy 4.0.4's own configurator layout: a 2 GiB ESP and Btrfs with the
// standard subvolumes. Leave LUKS disabled so host autostart needs no console
// passphrase. The ordinary Omarchy installer still owns all system setup.
export function renderOmarchyConfiguration(hostname: string, diskSizeGb: number) {
	const mib = 1024 ** 2
	const bootSize = 2 * 1024 ** 3
	const size = (value: number) => ({unit: 'B', value, sector_size: {unit: 'B', value: 512}})
	return {
		bootloader_config: {bootloader: 'Limine', uki: false, removable: false},
		audio_config: {audio: 'pipewire'},
		disk_config: {
			config_type: 'default_layout',
			device_modifications: [
				{
					device: '/dev/vda',
					wipe: true,
					partitions: [
						{
							obj_id: 'ea21d3f2-82bb-49cc-ab5d-6f81ae94e18d',
							status: 'create',
							type: 'primary',
							fs_type: 'fat32',
							dev_path: null,
							mount_options: [],
							mountpoint: '/boot',
							flags: ['boot', 'esp'],
							start: size(mib),
							size: size(bootSize),
						},
						{
							obj_id: '8c2c2b92-1070-455d-b76a-56263bab24aa',
							status: 'create',
							type: 'primary',
							fs_type: 'btrfs',
							dev_path: null,
							mountpoint: null,
							mount_options: ['compress=zstd'],
							btrfs: [
								{name: '@', mountpoint: '/'},
								{name: '@home', mountpoint: '/home'},
								{name: '@log', mountpoint: '/var/log'},
								{name: '@pkg', mountpoint: '/var/cache/pacman/pkg'},
							],
							start: size(mib + bootSize),
							size: size(diskSizeGb * 1024 ** 3 - bootSize - 2 * mib),
						},
					],
				},
			],
		},
		hostname,
		network_config: {type: 'iso'},
		ntp: true,
		swap: true,
		timezone: 'UTC',
		locale_config: {kb_layout: 'us', sys_enc: 'UTF-8', sys_lang: 'en_US.UTF-8'},
	}
}

export function renderOmarchySetupKey(publicKey: string, completionUrl: string) {
	// The key cannot run arbitrary commands or forward ports. It can only ask
	// the installed guest to configure its power button and call our first-boot
	// endpoint. The sudo password arrives over SSH stdin, never on the seed CD.
	// Encoding keeps quoting independent of the user's login shell; fd 3 keeps
	// SSH stdin separate from the pipe carrying the script to bash.
	const script = `set -eu
test ! -d /run/archiso
jq -e '.finished_at != null and all(.phases[]; .status == "ok")' /var/log/omarchy-install-timing.json >/dev/null
systemctl is-active --quiet sddm.service
sudo --stdin --prompt='' /bin/sh -ec '
mkdir -p /etc/systemd/logind.conf.d
printf "[Login]\\nHandlePowerKey=poweroff\\n" > /etc/systemd/logind.conf.d/90-umbrel-vm.conf
systemctl reload systemd-logind.service
' <&3
if ! grep -Fxq 'hl.unbind("XF86PowerOff")' "$HOME/.config/hypr/bindings.lua"; then
  printf '\\n-- Let logind handle the virtual power button, including at the login screen.\\nhl.unbind("XF86PowerOff")\\n' >> "$HOME/.config/hypr/bindings.lua"
fi
curl --fail --silent --show-error --max-time 5 --request POST '${completionUrl}'
sed -i '/ ${setupKeyComment}$/d' "$HOME/.ssh/authorized_keys"
`
	const encoded = Buffer.from(script).toString('base64')
	return `restrict,from="${MACHINE_GUEST_HOST_ADDRESS}",command="/bin/bash -c 'exec 3<&0; echo ${encoded} | base64 --decode | /bin/bash'" ${publicKey.trim()}\n`
}

export async function prepareOmarchySeed(
	directory: string,
	options: {hostname: string; diskSizeGb: number; username: string; password: string; completionUrl: string},
	signal: AbortSignal,
) {
	const commandOptions = installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS)
	const media = path.join(directory, 'media')
	const seed = path.join(media, 'cidata')
	await fse.ensureDir(seed)
	try {
		const {stdout: passwordHash} = await execa('mkpasswd', ['--method=sha-512', '--stdin'], {
			...commandOptions,
			input: options.password,
		})
		const keyPath = path.join(media, setupKeyName)
		await execa('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', setupKeyComment, '-f', keyPath], commandOptions)
		const publicKey = await fsp.readFile(`${keyPath}.pub`, 'utf8')
		await fse.remove(`${keyPath}.pub`)
		await Promise.all([
			// Keep sudo authentication only until first-boot setup completes. This
			// host-only file is outside cidata and survives an Umbrel restart.
			fsp.writeFile(path.join(media, setupPasswordName), options.password, {mode: 0o600}),
			fsp.writeFile(
				path.join(seed, 'user_configuration.json'),
				JSON.stringify(renderOmarchyConfiguration(options.hostname, options.diskSizeGb)),
				{mode: 0o600},
			),
			fsp.writeFile(
				path.join(seed, 'user_credentials.json'),
				JSON.stringify({users: [{username: options.username, enc_password: passwordHash.trim(), sudo: true}]}),
				{mode: 0o600},
			),
			fsp.writeFile(path.join(seed, 'authorized_keys'), renderOmarchySetupKey(publicKey, options.completionUrl), {
				mode: 0o600,
			}),
		])
		await execa(
			'genisoimage',
			['-quiet', '-output', path.join(media, 'seed.iso'), '-volid', 'cidata', '-joliet', '-rock', seed],
			commandOptions,
		)
	} finally {
		await fse.remove(seed)
	}
}

export async function probeOmarchySetup(directory: string, username: string, ipAddress: string) {
	// Connection failures are expected throughout installation and reboot. The
	// persistent key lets the normal poller resume after an umbreld restart.
	const password = await fsp.readFile(path.join(directory, 'media', setupPasswordName), 'utf8')
	await execa(
		'ssh',
		[
			'-F',
			'/dev/null',
			'-T',
			'-i',
			path.join(directory, 'media', setupKeyName),
			'-o',
			'BatchMode=yes',
			'-o',
			'IdentitiesOnly=yes',
			'-o',
			'IdentityAgent=none',
			'-o',
			'StrictHostKeyChecking=no',
			'-o',
			'UserKnownHostsFile=/dev/null',
			'-o',
			'GlobalKnownHostsFile=/dev/null',
			'-o',
			'ConnectTimeout=2',
			'-o',
			'ConnectionAttempts=1',
			'-o',
			'LogLevel=ERROR',
			'-l',
			username,
			'--',
			ipAddress,
			'true',
		],
		{input: `${password}\n`, timeout: 10_000, reject: false},
	)
}

export async function removeOmarchySetupCredentials(directory: string) {
	await Promise.all([setupKeyName, setupPasswordName].map((name) => fse.remove(path.join(directory, 'media', name))))
}
