import {z} from 'zod'
import {privateProcedure, router} from '../server/trpc/trpc.js'
import {hasWifi, getWifiNetworks, connectToWiFiNetwork, deleteWifiConnections} from './system.js'

export default router({
	supported: privateProcedure.query(() => hasWifi()),

	networks: privateProcedure.query(() => getWifiNetworks()),

	connect: privateProcedure
		.input(z.object({ssid: z.string(), password: z.string().optional()}))
		.mutation(async ({input, ctx}) => {
			const previousWifiCredentials = await ctx.umbreld.store.get('settings.wifi')
			try {
				await connectToWiFiNetwork({ssid: input.ssid, password: input.password})
				await ctx.umbreld.store.set('settings.wifi', {ssid: input.ssid, password: input.password})
			} catch (error) {
				// Best effort attempt to restore previous credentials on failure
				if (previousWifiCredentials) {
					ctx.umbreld.logger.error(`Failed to connect to WiFi network, attempting to restore previous credentials...`)
					connectToWiFiNetwork(previousWifiCredentials).catch((error) => {
						ctx.umbreld.logger.error(`Failed to restore previous WiFi connection`, error)
					})
				}

				throw error
			}
		}),

	connected: privateProcedure.query(async () => {
		const networks = await getWifiNetworks()
		const connection = networks.find((network) => network.active)
		if (!connection) return {status: 'disconnected'} as const

		return {
			status: 'connected',
			ssid: connection.ssid,
			signal: connection.signal,
			authenticated: connection.authenticated,
		} as const
	}),

	disconnect: privateProcedure.mutation(async ({ctx}) => {
		// Nuke all WiFi connections
		await deleteWifiConnections({inactiveOnly: false})
		await ctx.umbreld.store.delete('settings.wifi')

		return true
	}),
})
