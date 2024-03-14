/* eslint-disable */
// @ts-nocheck

console.allLogs = []

/**
 * Redirect all logs to our own thing so they can be downloaded
 */
export function monkeyPatchConsoleLog() {
	// default
	console.defaultLog = console.log.bind(console)
	console.log = function () {
		// default &  console.log()
		console.defaultLog.apply(console, arguments)
		console.allLogs.push(Array.from(arguments))
	}

	// error
	console.defaultError = console.error.bind(console)

	console.error = function () {
		// default &  console.error()
		console.defaultError.apply(console, arguments)
		console.allLogs.push(Array.from(arguments))
	}

	// warn
	console.defaultWarn = console.warn.bind(console)

	console.warn = function () {
		// default &  console.warn()
		console.defaultWarn.apply(console, arguments)
		console.allLogs.push(Array.from(arguments))
	}

	// debug
	console.defaultDebug = console.debug.bind(console)

	console.debug = function () {
		// default &  console.debug()
		console.defaultDebug.apply(console, arguments)
		console.allLogs.push(Array.from(arguments))
	}
}
