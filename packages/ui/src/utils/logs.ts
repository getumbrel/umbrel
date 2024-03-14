/* eslint-disable */
// @ts-nocheck

/**
 * Redirect all logs to our own thing so they can be downloaded
 */
export function monkeyPatchConsoleLog() {
	// default
	console.defaultLog = console.log.bind(console)
	console.logs = []
	console.log = function () {
		// default &  console.log()
		console.defaultLog.apply(console, arguments)
		// new & array data
		console.logs.push(Array.from(arguments))
	}

	// error
	console.defaultError = console.error.bind(console)
	console.errors = []
	console.error = function () {
		// default &  console.error()
		console.defaultError.apply(console, arguments)
		// new & array data
		console.errors.push(Array.from(arguments))
	}

	// warn
	console.defaultWarn = console.warn.bind(console)
	console.warns = []
	console.warn = function () {
		// default &  console.warn()
		console.defaultWarn.apply(console, arguments)
		// new & array data
		console.warns.push(Array.from(arguments))
	}

	// debug
	console.defaultDebug = console.debug.bind(console)
	console.debugs = []
	console.debug = function () {
		// default &  console.debug()
		console.defaultDebug.apply(console, arguments)
		// new & array data
		console.debugs.push(Array.from(arguments))
	}
}
