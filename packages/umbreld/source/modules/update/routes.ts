import {setTimeout} from 'node:timers/promises'

import {TRPCError} from '@trpc/server'
import {z} from 'zod'

import {reboot} from '../system/system.ts'
import {setSystemStatus} from '../system/routes.ts'
import {privateProcedure, router} from '../server/trpc/trpc.ts'

// Checking or installing a release by URL, like a public test build, is root only, through
// `umbreld update <release url>`. Releases by URL can be any version, so a stolen browser session could
// otherwise roll a device back to an older signed release.
//
// Installing can be given the manifestHash of the release a check showed, so it only installs that one.
const releaseInput = z
	.object({
		releaseUrl: z.string().url().optional(),
		manifestHash: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.optional(),
	})
	.optional()
const releaseProcedure = privateProcedure.input(releaseInput).use(({ctx, input, next}) => {
	if (input?.releaseUrl && ctx.principal?.actor !== 'system') {
		throw new TRPCError({code: 'FORBIDDEN', message: 'Only root can install a release by URL'})
	}
	return next()
})

const procedures = {
	status: privateProcedure.query(({ctx}) => ctx.umbreld.update.getStatus()),
	check: releaseProcedure.query(({ctx, input}) => ctx.umbreld.update.checkUpdate(input)),
	// Always verifies the release. Skipping verification is only possible as root through
	// `umbreld update --skip-signature-check`, which never goes through the API.
	install: releaseProcedure.mutation(async ({ctx, input}) => {
		if (ctx.umbreld.update.getStatus().running) {
			throw new TRPCError({code: 'CONFLICT', message: 'An update is already running'})
		}

		setSystemStatus('updating')
		let success = false
		try {
			success = await ctx.umbreld.update.install(input)
			if (success) {
				await setTimeout(1000)
				await ctx.umbreld.stop()
				await reboot()
			}
		} finally {
			if (!success) setSystemStatus('running')
		}
		return success
	}),
	getReleaseChannel: privateProcedure.query(({ctx}) => ctx.umbreld.update.getReleaseChannel()),
	setReleaseChannel: privateProcedure
		.input(z.object({channel: z.enum(['stable', 'beta'])}))
		.mutation(({ctx, input}) => ctx.umbreld.update.setReleaseChannel(input.channel)),
}

export default router(procedures)

// Older clients update through these, under the system router
export const legacySystemRoutes = router({
	updateStatus: procedures.status,
	checkUpdate: procedures.check,
	update: procedures.install,
	getReleaseChannel: procedures.getReleaseChannel,
	setReleaseChannel: procedures.setReleaseChannel,
})
