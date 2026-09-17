import type {ErrorRequestHandler} from 'express'

import type createLogger from '../utilities/logger.js'

export default function createErrorHandler(
	logger: Pick<ReturnType<typeof createLogger>, 'error'>,
): ErrorRequestHandler {
	return (error, request, response, _next) => {
		logger.error(`${request.method} ${request.path}`, error)
		if (response.headersSent) return
		// Asset routes may have already set a year-long immutable cache policy.
		// Never let a temporary failure replace the asset in the browser cache.
		response.set('Cache-Control', 'no-store')
		response.status(500).json({error: true})
	}
}
