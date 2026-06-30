import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import pWaitFor from 'p-wait-for'

import type {RcloneMountOptions, RcloneRemoteConfig} from './types.js'

const MOUNT_READY_TIMEOUT_MS = 30_000

export async function assertRcloneAvailable() {
	await $`rclone version`
}

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

export function buildDriveRemote(name: string, {token}: {token: string}): RcloneRemoteConfig {
	return {
		name,
		type: 'drive',
		options: {
			token,
			scope: 'drive',
		},
	}
}

export function buildDropboxRemote(name: string, {token}: {token: string}): RcloneRemoteConfig {
	return {
		name,
		type: 'dropbox',
		options: {
			token,
		},
	}
}

export function buildWebdavRemote(
	name: string,
	{
		url,
		username,
		obscuredPassword,
		vendor = 'other',
	}: {url: string; username: string; obscuredPassword: string; vendor?: 'other' | 'nextcloud'},
): RcloneRemoteConfig {
	return {
		name,
		type: 'webdav',
		options: {
			url,
			vendor,
			user: username,
			pass: obscuredPassword,
			no_check_certificate: 'true',
		},
	}
}

export async function writeRemoteConfig(remote: RcloneRemoteConfig, configPath: string) {
	await fse.ensureDir(nodePath.dirname(configPath))
	await fse.writeFile(configPath, buildConfigContents(remote), {mode: 0o600})
}

export async function mountRemote(remote: RcloneRemoteConfig, options: RcloneMountOptions) {
	const {systemMountPath, userId, groupId, configPath, cacheDirectory, vfsCacheMode = 'writes'} = options

	await fse.ensureDir(systemMountPath)
	await fse.ensureDir(cacheDirectory)
	await writeRemoteConfig(remote, configPath)

	await $`rclone mount ${remote.name}: ${systemMountPath} --config ${configPath} --cache-dir ${cacheDirectory} --daemon --allow-other --uid ${userId} --gid ${groupId} --vfs-cache-mode ${vfsCacheMode} --dir-cache-time 30s --poll-interval 30s --umask 002`

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
}

export async function isRemoteMounted(systemMountPath: string) {
	try {
		await $`mountpoint ${systemMountPath}`
		return true
	} catch {
		return false
	}
}

async function fusermountUnmount(systemMountPath: string) {
	const commands = ['fusermount3', 'fusermount'] as const
	for (const command of commands) {
		const result = await $({reject: false})`${command} -uz ${systemMountPath}`
		if (result.exitCode === 0) return
	}

	await $`umount ${systemMountPath}`
}

export async function unmountRemote(
	systemMountPath: string,
	{cleanupPaths}: {cleanupPaths?: {configPath?: string; cacheDirectory?: string}} = {},
) {
	if (await isRemoteMounted(systemMountPath)) {
		await fusermountUnmount(systemMountPath)
		await setTimeout(250)
	}

	if (cleanupPaths?.configPath) await fse.remove(cleanupPaths.configPath).catch(() => {})
	if (cleanupPaths?.cacheDirectory) await fse.remove(cleanupPaths.cacheDirectory).catch(() => {})
}
