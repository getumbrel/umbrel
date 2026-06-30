import os from 'node:os'
import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import pWaitFor from 'p-wait-for'

import type {RcloneMountOptions, RcloneRemoteConfig} from './types.js'

const MOUNT_READY_TIMEOUT_MS = 30_000

export async function obscurePassword(password: string) {
	const {stdout} = await $`rclone obscure ${password}`
	return stdout.trim()
}

function buildConfigContents(remote: RcloneRemoteConfig) {
	const lines = [`[${remote.name}]`, `type = ${remote.type}`]
	for (const [key, value] of Object.entries(remote.options)) {
		lines.push(`${key} = ${value}`)
	}
	return `${lines.join('\n')}\n`
}

export function buildWebdavRemote(
	name: string,
	{url, username, obscuredPassword}: {url: string; username: string; obscuredPassword: string},
): RcloneRemoteConfig {
	return {
		name,
		type: 'webdav',
		options: {
			url,
			vendor: 'other',
			user: username,
			pass: obscuredPassword,
			no_check_certificate: 'true',
		},
	}
}

export async function mountRemote(remote: RcloneRemoteConfig, options: RcloneMountOptions) {
	const {systemMountPath, userId, groupId, vfsCacheMode = 'writes'} = options

	await fse.ensureDir(systemMountPath)

	const configDirectory = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-rclone-config-'))
	const configPath = nodePath.join(configDirectory, 'rclone.conf')
	await fse.writeFile(configPath, buildConfigContents(remote), {mode: 0o600})

	try {
		await $`rclone mount ${remote.name}: ${systemMountPath} --config ${configPath} --daemon --allow-other --uid ${userId} --gid ${groupId} --vfs-cache-mode ${vfsCacheMode} --dir-cache-time 30s --poll-interval 30s --umask 002`

		await pWaitFor(
			async () => {
				try {
					await $`mountpoint ${systemMountPath}`
					return true
				} catch {
					return false
				}
			},
			{interval: 200, timeout: {milliseconds: MOUNT_READY_TIMEOUT_MS}},
		)
	} finally {
		await fse.remove(configDirectory).catch(() => {})
	}
}

export async function isRemoteMounted(systemMountPath: string) {
	try {
		await $`mountpoint ${systemMountPath}`
		return true
	} catch {
		return false
	}
}

export async function unmountRemote(systemMountPath: string) {
	if (!(await isRemoteMounted(systemMountPath))) return

	// rclone FUSE mounts are released via fusermount; fall back to umount.
	try {
		await $`fusermount -uz ${systemMountPath}`
	} catch {
		await $`umount ${systemMountPath}`
	}

	// Give the kernel a moment to tear down the mount point.
	await setTimeout(250)
}
