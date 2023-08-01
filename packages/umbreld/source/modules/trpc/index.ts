import {createExpressMiddleware} from '@trpc/server/adapters/express'

import {router} from './trpc.js'
import {createContext} from './context.js'
import {debug} from './routes/debug.js'
import migration from './routes/migration.js'
import system from './routes/system.js'
import auth from './routes/auth.js'

const appRouter = router({
	debug,
	migration,
	system,
	auth,
})

export type AppRouter = typeof appRouter

export const trpcHandler = createExpressMiddleware({
	router: appRouter,
	createContext,
})
