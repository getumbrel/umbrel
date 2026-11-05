import chalkTemplate from 'chalk-template'

const logLevels = ['silent', 'normal', 'verbose'] as const

export type LogLevel = (typeof logLevels)[number]

function value(logLevel: LogLevel) {
	return logLevels.indexOf(logLevel)
}

let longestScope = 0

type LogOptions = {
	logLevel?: LogLevel
	error?: any
}

function createLogger(scope: string, globalLogLevel: LogLevel = 'normal') {
	if (scope.length > longestScope) longestScope = scope.length
	const log = (message = '', {logLevel, error}: LogOptions = {}) => {
		if (!logLevel) logLevel = 'normal'
		if (value(globalLogLevel) >= value(logLevel)) {
			scope = scope.padEnd(longestScope, ' ')

			console.log(chalkTemplate`{white {blue [${scope}]} ${message}}`)
			if (error) console.log(error)
		}
	}

	// Callers on hot paths, such as every file event, check this before building
	// an expensive message
	const isVerbose = value(globalLogLevel) >= value('verbose')

	return {
		log: (message?: string) => log(message),
		isVerbose,
		// Formatting is skipped entirely when verbose logging is off
		verbose: (message: string) => {
			if (isVerbose) log(chalkTemplate`{grey ${message}}`, {logLevel: 'verbose'})
		},
		error: (message: string, error?: any) => log(chalkTemplate`{red [error]} ${message}`, {error}),
		createChildLogger: (scope: string) => createLogger(scope, globalLogLevel),
	}
}

export default createLogger
