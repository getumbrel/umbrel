const log = (logger) => (request, response, next) => {
	logger.verbose(`${request.method} ${request.path}`)
	next()
}

export default log
