import express from 'express'

import * as authHandlers from './handlers/auth.js'
import errorHandler from './middleware/error-handler.js'
import session from './middleware/session.js'
import log from './middleware/log.js'
import Router from './router.js'

const createHandler = ({umbreld, sessionsPath, sessionSecret, logger}) => {
	const app = express()

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

	return app
}

export default createHandler
