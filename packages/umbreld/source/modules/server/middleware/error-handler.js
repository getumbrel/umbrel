import ow, {ArgumentError} from 'ow'

export class HttpError extends Error {
	constructor(statusCode = 500, statusMessage) {
		if (typeof statusCode === 'string') {
			statusMessage = statusCode
			statusCode = 500
		}

		super(statusMessage)
		this.statusCode = statusCode
		this.statusMessage = statusMessage
	}
}

// See ow docs for validator api: https://sindresorhus.com/ow/
export const validate = (object, shape) => {
	try {
		ow(object, ow.object.exactShape(shape))
	} catch (error) {
		if (error instanceof ArgumentError) {
			throw new HttpError(error.message.replace(/in object$/, ''))
		}

		throw error
	}
}

validate.is = ow

const errorHandler = (logger) => (error, request, response, next) => {
	if (response.headersSent) return next(error)

	logger.error(`${request.method} ${request.path} ${error.message}`)

	let statusCode = 500
	let message = 'Error'

	if (error instanceof HttpError) {
		statusCode = error.statusCode
		message = error.statusMessage
	}

	response.status(statusCode).json({message})
}

export default errorHandler
