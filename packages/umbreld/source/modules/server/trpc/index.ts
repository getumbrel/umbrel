import {createExpressMiddleware} from '@trpc/server/adapters/express'

import {router} from './trpc.js'
import {createContext} from './context.js'
import {debug} from './routes/debug.js'
import migration from './routes/migration.js'
import system from './routes/system.js'
import user from './routes/user.js'
import appStore from './routes/app-store.js'
import apps from './routes/apps.js'
import widget from './routes/widget.js'

const appRouter = router({
	debug,
	migration,
	system,
	user,
	appStore,
	apps,
	widget,
})

export type AppRouter = typeof appRouter

export const trpcHandler = createExpressMiddleware({
	router: appRouter,
	createContext,
})
