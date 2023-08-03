import {initTRPC} from '@trpc/server'

import {type Context} from './context.js'
import {isAuthenticated} from './is-authenticated.js'

const t = initTRPC.context<Context>().create()
export const router = t.router
export const publicProcedure = t.procedure
export const privateProcedure = t.procedure.use(isAuthenticated)
