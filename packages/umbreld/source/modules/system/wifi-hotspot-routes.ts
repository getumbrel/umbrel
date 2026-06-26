import {z} from 'zod'

import {privateProcedure, router} from '../server/trpc/trpc.js'
import {supportsWifiHotspot, startWifiHotspot, stopWifiHotspot, getWifiHotspotStatus} from './system.js'

const configSchema = z.object({
	ssid: z.string().min(1).max(32),
	password: z.string().min(8).max(63),
	band: z.enum(['2.4ghz', '5ghz']).optional(),
	channel: z.number().int().min(0).max(165).optional(),
	countryCode: z
		.string()
		.length(2)
		.regex(/^[A-Za-z]{2}$/)
		.optional(),
	hidden: z.boolean().optional(),
	bridgeToLan: z.boolean().optional(),
})

export default router({
	// Whether this device has a WiFi adapter capable of running an access point
	supported: privateProcedure.query(() => supportsWifiHotspot()),

	// Current hotspot configuration + whether it's currently live
	status: privateProcedure.query(({ctx}) => getWifiHotspotStatus(ctx.umbreld)),

	// Enable (or update) the hotspot
	enable: privateProcedure.input(configSchema).mutation(async ({ctx, input}) => {
		const previous = await ctx.umbreld.store.get('settings.wifiHotspot')
		try {
			await startWifiHotspot(input)
			await ctx.umbreld.store.set('settings.wifiHotspot', {enabled: true, ...input})
			return true
		} catch (error) {
			// Best effort: tear down the half-configured hotspot and restore the
			// previous working config so a bad change can't leave the AP broken.
			await stopWifiHotspot().catch(() => {})
			if (previous?.enabled) {
				ctx.umbreld.logger.error(`Failed to enable WiFi hotspot, attempting to restore previous config...`)
				startWifiHotspot(previous).catch((error) => {
					ctx.umbreld.logger.error(`Failed to restore previous WiFi hotspot`, error)
				})
			}
			throw error
		}
	}),

	// Disable the hotspot (keeps the saved config so it can be re-enabled)
	disable: privateProcedure.mutation(async ({ctx}) => {
		await stopWifiHotspot()
		const existing = await ctx.umbreld.store.get('settings.wifiHotspot')
		if (existing) await ctx.umbreld.store.set('settings.wifiHotspot', {...existing, enabled: false})
		return true
	}),
})
