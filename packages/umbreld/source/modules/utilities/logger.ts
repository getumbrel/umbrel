import chalkTemplate from 'chalk-template'

const logLevels = ['silent', 'normal', 'verbose'] as const

export type LogLevel = typeof logLevels[number]

function value(logLevel: LogLevel) {
	return logLevels.indexOf(logLevel)
}

let longestScope = 0

function createLogger(scope: string, globalLogLevel: LogLevel = 'normal') {
	if (scope.length > longestScope) longestScope = scope.length
	const log = (message = '', logLevel: LogLevel = 'normal') => {
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
