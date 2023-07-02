import chalkTemplate from 'chalk-template'

const value = (logLevel) => ['silent', 'normal', 'verbose'].indexOf(logLevel)

let longestScope = 0

const createLogger = (scope, globalLogLevel = 'normal') => {
	if (scope.length > longestScope) longestScope = scope.length
	const log = (message = '', logLevel = 'normal') => {
		if (value(globalLogLevel) >= value(logLevel)) {
			scope = scope.padEnd(longestScope, ' ')

			console.log(chalkTemplate`{white {blue [${scope}]} ${message}}`)
		}
	}

	log.verbose = (message) => log(message, 'verbose')

	return {
		log,
		verbose: (message) => log(chalkTemplate`{grey ${message}}`, 'verbose'),
		error: (message) => log(chalkTemplate`{red [error]} ${message}`),
	}
}

export default createLogger
