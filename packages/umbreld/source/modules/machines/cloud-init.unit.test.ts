import {describe, expect, test} from 'vitest'
import yaml from 'js-yaml'

import {createHash} from 'node:crypto'

import {
	FIRST_BOOT_SETUP_TIMEOUT_MS,
	WINDOWS_ARM_FIRST_BOOT_SETUP_TIMEOUT_MS,
	builtinMachinesCatalog,
	firstBootSetupTimeoutMs,
	firstBootTokenMatches,
	isFirstBootSetupActive,
	renderCloudInitUserData,
} from './machines.js'

describe('Machines cloud-init seed', () => {
	test('marks an incomplete first-boot setup delayed after one hour', () => {
		const setup = {startedAt: 1_000, tokenHash: 'a'.repeat(64)}
		expect(isFirstBootSetupActive(setup, 1_000 + FIRST_BOOT_SETUP_TIMEOUT_MS - 1)).toBe(true)
		expect(isFirstBootSetupActive(setup, 1_000 + FIRST_BOOT_SETUP_TIMEOUT_MS)).toBe(false)
		expect(isFirstBootSetupActive(undefined, 1_000)).toBe(false)
	})

	test('does not hide an interactive installer behind the setup overlay', () => {
		expect(isFirstBootSetupActive({startedAt: 1_000, tokenHash: 'a'.repeat(64), manual: true}, 1_000)).toBe(false)
	})

	test('keeps the slow Windows Arm setup overlay active for four hours', () => {
		expect(firstBootSetupTimeoutMs({osId: 'windows-11', arch: 'arm64'})).toBe(WINDOWS_ARM_FIRST_BOOT_SETUP_TIMEOUT_MS)
		expect(firstBootSetupTimeoutMs({osId: 'windows-11', arch: 'amd64'})).toBe(FIRST_BOOT_SETUP_TIMEOUT_MS)
	})

	test('validates a first-boot callback token without accepting malformed input', () => {
		const token = 'ab'.repeat(32)
		const hash = createHash('sha256').update(token).digest('hex')
		expect(firstBootTokenMatches(token, hash)).toBe(true)
		expect(firstBootTokenMatches('cd'.repeat(32), hash)).toBe(false)
		expect(firstBootTokenMatches('not-a-token', hash)).toBe(false)
	})
	test('defines the requested account exactly once with password login enabled', () => {
		const document = renderCloudInitUserData('ubuntu', '$6$test-hash')
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			users: Array<{name: string; passwd: string; lock_passwd: boolean; shell: string; sudo: string; groups?: string[]}>
			ssh_pwauth: boolean
		}

		expect(config.users).toEqual([
			expect.objectContaining({
				name: 'ubuntu',
				passwd: '$6$test-hash',
				lock_passwd: false,
				shell: '/bin/bash',
				sudo: 'ALL=(ALL) NOPASSWD:ALL',
			}),
		])
		expect(config.users[0]).not.toHaveProperty('groups')
		expect(config.ssh_pwauth).toBe(true)
	})

	test('uses Alpine ash without adding Debian-specific privilege groups', () => {
		const document = renderCloudInitUserData('alpine', '$6$test-hash', {shell: '/bin/ash', packages: ['sudo']})
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			users: Array<{shell: string; sudo: string; groups?: string[]}>
			packages: string[]
		}

		expect(config.users[0]).toMatchObject({shell: '/bin/ash', sudo: 'ALL=(ALL) NOPASSWD:ALL'})
		expect(config.users[0]).not.toHaveProperty('groups')
		expect(config.packages).toEqual(['sudo'])
	})

	test('reports server setup completion without forcing a reboot', () => {
		const document = renderCloudInitUserData(
			'ubuntu',
			'$6$test-hash',
			{},
			'http://umbrel/api/machines/first-boot/id/token',
		)
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			phone_home: {url: string; post: string[]; tries: number}
			power_state?: unknown
		}

		expect(config.phone_home).toEqual({
			url: 'http://umbrel/api/machines/first-boot/id/token',
			post: ['instance_id'],
			tries: 60,
		})
		expect(config).not.toHaveProperty('power_state')
	})

	test('installs the full Ubuntu desktop and reboots into the graphical target when requested', () => {
		const document = renderCloudInitUserData(
			'ubuntu',
			'$6$test-hash',
			{
				packages: ['ubuntu-desktop'],
				graphical: true,
			},
			'http://umbrel/api/machines/first-boot/id/token',
		)
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			package_update: boolean
			packages: string[]
			runcmd: string[][]
			power_state: {mode: string; condition: boolean}
			phone_home: {url: string; post: string[]; tries: number}
		}

		expect(config.package_update).toBe(true)
		expect(config.packages).toEqual(['ubuntu-desktop'])
		expect(config.runcmd).toContainEqual(['systemctl', 'set-default', 'graphical.target'])
		expect(config.power_state).toMatchObject({mode: 'reboot', condition: true})
		expect(config.phone_home).toEqual({
			url: 'http://umbrel/api/machines/first-boot/id/token',
			post: ['instance_id'],
			tries: 60,
		})
	})

	test('runs Fedora Workstation setup before rebooting', () => {
		const document = renderCloudInitUserData('fedora', '$6$test-hash', {
			commands: [
				['dnf', 'install', '-y', '@workstation-product-environment'],
				['systemctl', 'enable', 'gdm.service'],
			],
			graphical: true,
		})
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			users: Array<{groups?: string[]}>
			runcmd: string[][]
			power_state: {mode: string}
		}

		expect(config.users[0]).not.toHaveProperty('groups')
		expect(config.runcmd).toEqual([
			['dnf', 'install', '-y', '@workstation-product-environment'],
			['systemctl', 'enable', 'gdm.service'],
			['systemctl', 'set-default', 'graphical.target'],
		])
		expect(config.power_state.mode).toBe('reboot')
	})

	test('provisions the Android kiosk before rebooting into its graphical session', () => {
		const android = builtinMachinesCatalog.images.find(({id}) => id === 'android-13-amd64')!
		const document = renderCloudInitUserData(
			'umbrel',
			'$6$test-hash',
			android.cloudInit,
			'http://umbrel/api/machines/first-boot/id/token',
		)
		const config = yaml.load(document.replace(/^#cloud-config\n/, '')) as {
			runcmd: string[][]
			power_state: {mode: string}
		}
		const script = config.runcmd[0]?.[2]

		expect(script).toContain('waydroid init -s VANILLA')
		expect(script).toContain('cage -s -- waydroid show-full-ui')
		expect(script).toContain('export WLR_NO_HARDWARE_CURSORS=1')
		expect(script).toContain('ro.hardware.egl=swiftshader')
		// Waydroid only folds [properties] into waydroid_base.prop during init or
		// an upgrade, so every override has to land between init and the offline
		// upgrade, and the upgrade has to precede the session that boots Android.
		const upgrade = script.indexOf('waydroid upgrade -o')
		expect(upgrade).toBeGreaterThan(script.indexOf('waydroid init -s VANILLA'))
		expect(upgrade).toBeGreaterThan(script.indexOf('ro.hardware.gralloc=default'))
		expect(upgrade).toBeGreaterThan(script.indexOf('ro.sf.lcd_density=320'))
		expect(upgrade).toBeLessThan(script.indexOf('systemctl enable greetd.service'))
		// The dock tidy-up ships as a first-boot one-shot that disables itself
		expect(script).toContain("cat > /usr/local/bin/umbrel-waydroid-dock <<'EOF'\n#!/usr/bin/env python3")
		expect(script).toContain('ConditionPathExists=!/var/lib/waydroid/.umbrel-dock')
		expect(script).toContain('systemctl enable greetd.service waydroid-container.service umbrel-waydroid-dock.service')
		expect(script).not.toContain('${')
		expect(script).toContain('vt = 7')
		expect(script).toContain('user = "$android_user"')
		// ARM translation is a bonus for x86 hosts, and a failed attempt must not
		// take the install with it
		expect(script).toContain('install libndk')
		expect(script).toContain('if [ "$(uname -m)" = x86_64 ]; then')
		expect(script).toMatch(/timeout 900 \/usr\/local\/bin\/umbrel-waydroid-arm-translation \|\|/)
		expect(config.runcmd.at(-1)).toEqual(['systemctl', 'set-default', 'graphical.target'])
		expect(config.power_state.mode).toBe('reboot')
	})
})
