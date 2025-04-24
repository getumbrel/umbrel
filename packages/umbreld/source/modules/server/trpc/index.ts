import {createExpressMiddleware} from '@trpc/server/adapters/express'
import {applyWSSHandler} from '@trpc/server/adapters/ws'

import {router} from './trpc.js'
import {createContextExpress, createContextWss} from './context.js'
import migration from './routes/migration.js'
import system from './routes/system.js'
import wifi from './routes/wifi.js'
import user from './routes/user.js'
import appStore from './routes/app-store.js'
import apps from './routes/apps.js'
import widget from './routes/widget.js'
import files from '../../files/routes.js'
import notifications from '../../notifications/routes.js'
import eventBus from '../../event-bus/routes.js'

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
