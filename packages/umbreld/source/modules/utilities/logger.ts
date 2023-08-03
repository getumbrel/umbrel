import chalkTemplate from 'chalk-template'

const value = (logLevel) => ['silent', 'normal', 'verbose'].indexOf(logLevel)

let longestScope = 0

function createLogger(scope: string, globalLogLevel = 'normal') {
	if (scope.length > longestScope) longestScope = scope.length
	const log = (message = '', logLevel = 'normal') => {
		if (value(globalLogLevel) >= value(logLevel)) {
			scope = scope.padEnd(longestScope, ' ')

			console.log(chalkTemplate`{white {blue [${scope}]} ${message}}`)
		}
	}

	return {
		log,
		verbose: (message: string) => log(chalkTemplate`{grey ${message}}`, 'verbose'),
		error: (message: string) => log(chalkTemplate`{red [error]} ${message}`),
		createChildLogger(scope: string) {
			return createLogger(scope, globalLogLevel)
		},
	}
}

export default createLogger
