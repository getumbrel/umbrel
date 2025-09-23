import {createExpressMiddleware} from '@trpc/server/adapters/express'
import {applyWSSHandler} from '@trpc/server/adapters/ws'

import {router} from './trpc.js'
import {createContextExpress, createContextWss} from './context.js'
import migration from '../../migration/routes.js'
import system from '../../system/routes.js'
import wifi from '../../system/wifi-routes.js'
import user from '../../user/routes.js'
import {appStore, apps} from '../../apps/routes.js'
import widget from '../../widgets/routes.js'
import files from '../../files/routes.js'
import notifications from '../../notifications/routes.js'
import eventBus from '../../event-bus/routes.js'
import backups from '../../backups/routes.js'

import {type WebSocketServer} from 'ws'
import type Umbreld from '../../../index.js'

const appRouter = router({
	migration,
	system,
	wifi,
	user,
	appStore,
	apps,
	widget,
	files,
	notifications,
	eventBus,
	backups,
})

export type AppRouter = typeof appRouter

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
		createContext: () => createContextWss({umbreld, logger}),
		onError({error, ctx, path}) {
			logger.error(`WS ${path}`, error)
		},
	})
}
