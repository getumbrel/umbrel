import {createExpressMiddleware} from '@trpc/server/adapters/express'
import {applyWSSHandler} from '@trpc/server/adapters/ws'

import {router} from './trpc.js'
import {createContextExpress, createContextWss} from './context.js'
import migration from '../../migration/routes.js'
import system from '../../system/routes.js'
// Temporary name while migrating from the legacy system module. Will be renamed to "system" once migration is complete.
import systemNg from '../../system-ng/routes.js'
import wifi from '../../system/wifi-routes.js'
import user from '../../user/routes.js'
import {appStore, apps, registries} from '../../apps/routes.js'
import widget from '../../widgets/routes.js'
import files from '../../files/routes.js'
import hardware from '../../hardware/routes.js'
import notifications from '../../notifications/routes.js'
import eventBus from '../../event-bus/routes.js'
import backups from '../../backups/routes.js'
import shortcuts from '../../shortcuts/routes.js'
import machines from '../../machines/routes.js'
import lanIngress from '../../lan-ingress/routes.js'
import mcp from '../../mcp/routes.js'
import photos from '../../photos/routes.js'

import {type WebSocketServer} from 'ws'
import type Umbreld from '../../../index.js'

const appRouter = router({
	migration,
	system,
	systemNg,
	wifi,
	user,
	appStore,
	apps,
	registries,
	widget,
	files,
	hardware,
	notifications,
	eventBus,
	backups,
	shortcuts,
	machines,
	lanIngress,
	mcp,
	photos,
})

export type AppRouter = typeof appRouter
export type InternalTrpcCaller = ReturnType<typeof appRouter.createCaller>

// Trusted in-process consumers use the same procedures as external clients
// without paying for an HTTP round trip. Procedure input validation and
// middleware still run; the existing internal bypass supplies the owner-level
// system principal that the root-only CLI token would authenticate as.
export function createInternalTrpcCaller(umbreld: Umbreld): InternalTrpcCaller {
	return appRouter.createCaller({
		umbreld,
		server: umbreld.server,
		user: umbreld.user,
		appStore: umbreld.appStore,
		apps: umbreld.apps,
		logger: umbreld.logger,
		transport: 'express',
		dangerouslyBypassAuthentication: true,
	})
}

export const trpcExpressHandler = createExpressMiddleware({
	router: appRouter,
	createContext: createContextExpress,
	onError({error, ctx}) {
		ctx?.logger.error(`${ctx?.request?.method} ${ctx?.request?.path}`, error)
	},
})

export const trpcWssHandler = ({
	wss,
	umbreld,
	logger,
}: {
	wss: WebSocketServer
	umbreld: Umbreld
	logger: Umbreld['logger']
}) => {
	return applyWSSHandler({
		wss,
		router: appRouter,
		createContext: ({req}) => createContextWss({umbreld, logger, request: req}),
		// Server-side keepAlive compensates for browser background tab throttling,
		// where the client's setTimeout-based pings degrade to ~1/minute.
		keepAlive: {
			enabled: true,
			// trpc defaults
			pingMs: 30_000,
			pongWaitMs: 5_000,
		},
		onError({error, ctx, path}) {
			logger.error(`WS ${path}`, error)
		},
	})
}
