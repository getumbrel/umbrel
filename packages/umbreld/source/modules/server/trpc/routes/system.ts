import os from 'node:os'

import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import fetch from 'node-fetch'
import {$} from 'execa'
import fse from 'fs-extra'
import stripAnsi from 'strip-ansi'

import type Umbreld from '../../../../index.js'
import type {ProgressStatus} from '../../../apps/schema.js'
import {factoryResetDemoState, startReset} from '../../../factory-reset.js'
import {
	getCpuTemperature,
	getSystemDiskUsage,
	getDiskUsage,
	getMemoryUsage,
	getCpuUsage,
	reboot,
	shutdown,
	detectDevice,
	isUmbrelOS,
	getSystemMemoryUsage,
	getIpAddresses,
} from '../../../system.js'

import {privateProcedure, publicProcedure, router} from '../trpc.js'

type SystemStatus = 'running' | 'updating' | 'shutting-down' | 'restarting' | 'migrating'
let systemStatus: SystemStatus = 'running'

// Quick hack so we can set system status from migration module until we refactor this
export function setSystemStatus(status: SystemStatus) {
	systemStatus = status
}

type UpdateStatus = {
	running: boolean
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

function resetUpdateStatus() {
	updateStatus = {
		running: false,
		progress: 0,
		description: '',
		error: false,
	}
}

let updateStatus: UpdateStatus
resetUpdateStatus()

function setUpdateStatus(properties: Partial<UpdateStatus>) {
	updateStatus = {...updateStatus, ...properties}
}

async function getLatestRelease(umbreld: Umbreld) {
	let deviceId = 'unknown'
	try {
		deviceId = (await detectDevice()).deviceId
	} catch (error) {
		umbreld.logger.error(`Failed to detect device type: ${(error as Error).message}`)
	}

	let platform = 'unknown'
	try {
		if (await isUmbrelOS()) {
			platform = 'umbrelOS'
		}
	} catch (error) {
		umbreld.logger.error(`Failed to detect platform: ${(error as Error).message}`)
	}

	let channel = 'stable'
	try {
		channel = (await umbreld.store.get('settings.releaseChannel')) || 'stable'
	} catch (error) {
		umbreld.logger.error(`Failed to get release channel: ${(error as Error).message}`)
	}

	const updateUrl = new URL('https://api.umbrel.com/latest-release')
	// Provide context to the update server about the underlying device and platform
	// so we can avoid the 1.0 update situation where we need to shim multiple update
	// mechanisms and error-out updates for unsupported platforms. This also helps
	// notifying users for critical security updates that are be relevant only to their specific
	// platform, and avoids notififying users of updates that aren't yet available for their
	// platform.
	updateUrl.searchParams.set('version', umbreld.version)
	updateUrl.searchParams.set('device', deviceId)
	updateUrl.searchParams.set('platform', platform)
	updateUrl.searchParams.set('channel', channel)

	const result = await fetch(updateUrl, {
		headers: {'User-Agent': `umbrelOS ${umbreld.version}`},
	})
	const data = await result.json()
	return data as {version: string; name: string; releaseNotes: string; updateScript?: string}
}

export default router({
	online: publicProcedure.query(() => true),
	version: publicProcedure.query(async ({ctx}) => {
		return {
			version: ctx.umbreld.version,
			name: ctx.umbreld.versionName,
		}
	}),
	status: publicProcedure.query(() => systemStatus),
	updateStatus: privateProcedure.query(() => updateStatus),
	uptime: privateProcedure.query(() => os.uptime()),
	checkUpdate: privateProcedure.query(async ({ctx}) => {
		let {version, name, releaseNotes} = await getLatestRelease(ctx.umbreld)
		// v prefix is needed in the tag name for legacy reasons, remove it before comparing to local version
		const available = version.replace('v', '') !== ctx.umbreld.version
		return {available, version, name, releaseNotes}
	}),
	getReleaseChannel: privateProcedure.query(async ({ctx}) => {
		return (await ctx.umbreld.store.get('settings.releaseChannel')) || 'stable'
	}),
	setReleaseChannel: privateProcedure
		.input(
			z.object({
				channel: z.enum(['stable', 'beta']),
			}),
		)
		.mutation(async ({ctx, input}) => {
			return ctx.umbreld.store.set('settings.releaseChannel', input.channel)
		}),
	update: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'updating'
		setUpdateStatus({running: true, progress: 5, description: 'Updating...', error: false})

		try {
			const {updateScript} = await getLatestRelease(ctx.umbreld)

			if (!updateScript) {
				setUpdateStatus({error: 'No update script found'})
				throw new Error('No update script found')
			}

			const result = await fetch(updateScript, {
				headers: {'User-Agent': `umbrelOS ${ctx.umbreld.version}`},
			})
			const updateSCriptContents = await result.text()

			// Exectute update script and report progress
			const process = $`bash -c ${updateSCriptContents}`
			let menderInstallDots = 0
			async function handleUpdateScriptOutput(chunk: Buffer) {
				const text = chunk.toString()
				const lines = text.split('\n')
				for (const line of lines) {
					// Handle our custom status updates
					if (line.startsWith('umbrel-update: ')) {
						try {
							const status = JSON.parse(line.replace('umbrel-update: ', '')) as Partial<UpdateStatus>
							setUpdateStatus(status)
						} catch (error) {
							// Don't kill update on JSON parse errors
						}
					}

					// Handle mender install progress
					if (line === '.') {
						menderInstallDots++
						// Mender install will stream 70 dots to stdout, lets convert that into 5%-95% of install progress
						const progress = Math.min(95, Math.floor((menderInstallDots / 70) * 90) + 5)
						ctx.umbreld.logger.log(`Update progress: ${progress}%`)
						setUpdateStatus({progress})
					}
				}
			}
			process.stdout?.on('data', (chunk) => handleUpdateScriptOutput(chunk))
			process.stderr?.on('data', (chunk) => handleUpdateScriptOutput(chunk))

			// Wait for script to complete and handle errors
			await process
		} catch (error) {
			// Don't overwrite a useful error message reported by the update script
			if (!updateStatus.error) setUpdateStatus({error: 'Update failed'})

			// Reset the state back to running but leave the error message so ui polls
			// can differentiate between a successful update after reboot and a failed
			// update that didn't reboot.
			const errorStatus = updateStatus.error
			resetUpdateStatus()
			setUpdateStatus({error: errorStatus})
			systemStatus = 'running'

			ctx.umbreld.logger.error(`Update script failed: ${(error as Error).message}`)

			return false
		}

		setUpdateStatus({progress: 95})

		await ctx.umbreld.stop()
		await reboot()

		return true
	}),
	hiddenService: privateProcedure.query(async ({ctx}) => {
		try {
			return await fse.readFile(`${ctx.umbreld.dataDirectory}/tor/data/web/hostname`, 'utf-8')
		} catch (error) {
			ctx.umbreld.logger.error(`Failed to read hidden service for ui: ${(error as Error).message}`)
			return ''
		}
	}),
	device: privateProcedure.query(() => detectDevice()),
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	systemDiskUsage: privateProcedure.query(({ctx}) => getSystemDiskUsage(ctx.umbreld)),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld)),
	systemMemoryUsage: privateProcedure.query(({ctx}) => getSystemMemoryUsage()),
	memoryUsage: privateProcedure.query(({ctx}) => getMemoryUsage(ctx.umbreld)),
	cpuUsage: privateProcedure.query(({ctx}) => getCpuUsage(ctx.umbreld)),
	getIpAddresses: privateProcedure.query(() => getIpAddresses()),
	shutdown: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'shutting-down'
		await ctx.umbreld.stop()
		await shutdown()

		return true
	}),
	restart: privateProcedure.mutation(async ({ctx}) => {
		systemStatus = 'restarting'
		await ctx.umbreld.stop()
		await reboot()

		return true
	}),
	logs: privateProcedure
		.input(
			z.object({
				type: z.enum(['umbrelos', 'system']),
			}),
		)
		.query(async ({input}) => {
			let process
			if (input.type === 'umbrelos') {
				process = await $`journalctl --unit umbrel --unit umbreld-production --unit umbreld --unit ui --lines 1500`
			}
			if (input.type === 'system') {
				process = await $`journalctl --lines 1500`
			}
			return stripAnsi(process!.stdout)
		}),
	//
	factoryReset: privateProcedure
		.input(
			z.object({
				password: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (!(await ctx.user.validatePassword(input.password))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid password'})
			}

			const currentInstall = ctx.umbreld.dataDirectory
			startReset(currentInstall)
			return factoryResetDemoState
		}),
	// Public because we delete the user too and want to continue to get status updates
	getFactoryResetStatus: publicProcedure.query((): ProgressStatus | undefined => {
		return factoryResetDemoState
	}),
})
