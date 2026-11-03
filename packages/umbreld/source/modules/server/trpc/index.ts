import {createExpressMiddleware} from '@trpc/server/adapters/express'
import {applyWSSHandler} from '@trpc/server/adapters/ws'

import {router, t} from './trpc.ts'
import {createContextExpress, createContextWss} from './context.ts'
import {coalesceWrites} from './coalesce-writes.ts'
import migration from '../../migration/routes.ts'
import system from '../../system/routes.ts'
import update, {legacySystemRoutes as legacySystemUpdateRoutes} from '../../update/routes.ts'
// Temporary name while migrating from the legacy system module. Will be renamed to "system" once migration is complete.
import systemNg from '../../system-ng/routes.ts'
import wifi from '../../system/wifi-routes.ts'
import user from '../../user/routes.ts'
import {appStore, apps} from '../../apps/routes.ts'
import widget from '../../widgets/routes.ts'
import files from '../../files/routes.ts'
import hardware from '../../hardware/routes.ts'
import notifications from '../../notifications/routes.ts'
import eventBus from '../../event-bus/routes.ts'
import backups from '../../backups/routes.ts'
import shortcuts from '../../shortcuts/routes.ts'
import machines from '../../machines/routes.ts'
import lanIngress from '../../lan-ingress/routes.ts'
import mcp from '../../mcp/routes.ts'
import photos from '../../photos/routes.ts'

import type {WebSocketServer} from 'ws'
import type Umbreld from '../../../index.ts'

const appRouter = router({
	migration,
	system: t.mergeRouters(system, legacySystemUpdateRoutes),
	update,
	systemNg,
	wifi,
	user,
	appStore,
	apps,
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
	wss.on('connection', coalesceWrites)
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
