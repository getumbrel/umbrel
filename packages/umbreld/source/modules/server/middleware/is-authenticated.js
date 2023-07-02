import {HttpError} from './error-handler.js'

const isAuthenticated = (request, response, next) => {
	if (!request.session.renewed) throw new HttpError(401, 'Not authenticated')
	next()
}

export default isAuthenticated
