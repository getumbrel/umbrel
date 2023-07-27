import express from 'express'
import cors from 'cors'

import {trpcHandler} from '../../modules/trpc/index.js'
import * as authHandlers from './handlers/auth.js'
import errorHandler from './middleware/error-handler.js'
import session from './middleware/session.js'
import log from './middleware/log.js'
import Router from './router.js'

const createHandler = ({umbreld, sessionsPath, sessionSecret, logger}) => {
	const app = express()

	// We need CORS so the dashboard can make requests to the umbreld server. We can't lock
	// down to explicit domains because we don't know all potential domains ahead of time.
	// This is safe to enable for now because everything is behind JWT auth and the JWT
	// is stored in localstorage not a cookie so it won't be included in cross site
	// requests. However this is only for the transition period from the legacy codebase
	// to umbreld. We should migrate to serving everything from umbreld, then remove CORS
	// and transmit the JWT in a cookie.
	app.use(cors((request, callback) => callback(null, {origin: true, credentials: true})))

	// TODO: Security hardening, helmet etc.

	// Attach the umbreld instance so it's accessible to routes
	app.set('umbreld', umbreld)

	app.use(express.json())
	app.use(session({sessionsPath, sessionSecret}))
	app.use(log(logger))

	// TODO: This will expose a HMR dev server in development
	// and serve built static files in production
	app.use(express.static('source/ui'))

	const api = new Router({logger})
	app.use('/api', api.routes)

	// TODO: Get feedback on if people think this is the correct
	// place to mount the routes. Or should each handler module
	// create it's own router and mount routes internally and then
	// export it's router to be mounted here.
	api.public.post('/register', authHandlers.register)
	api.public.post('/login', authHandlers.login)
	api.post('/renew-session', authHandlers.renewSession)
	api.post('/logout', authHandlers.logout)

	// Handle errors
	app.use(errorHandler(logger))

	// Add tRPC routes
	app.use('/trpc', trpcHandler)

	return app
}

export default createHandler
