/* eslint-disable */
// @ts-nocheck

console.allLogs = []

function pushLog(log: any) {
	try {
		console.allLogs.push(`${new Date().toUTCString()} LOG: `, Array.from(log))
	} catch (e) {
		// ignore
	}
}

/**
 * Redirect all logs to our own thing so they can be downloaded
 * https://stackoverflow.com/a/52142526
 */
export function monkeyPatchConsoleLog() {
	// default
	console.defaultLog = console.log.bind(console)
	console.log = function () {
		// default &  console.log()
		console.defaultLog.apply(console, arguments)

		pushLog(arguments)
	}

	// error
	console.defaultError = console.error.bind(console)

	console.error = function () {
		// default &  console.error()
		console.defaultError.apply(console, arguments)
		pushLog(arguments)
	}

	// warn
	// Not doing ths for now

	// debug
	console.defaultDebug = console.debug.bind(console)

	console.debug = function () {
		// default &  console.debug()
		console.defaultDebug.apply(console, arguments)
		pushLog(arguments)
	}
}

// https://stackoverflow.com/a/19818659
export function downloadLogs() {
	let data = console.allLogs

	if (!data) {
		console.error('Console.save: No data')
		return
	}

	const filename = 'console.json'

	if (typeof data === 'object') {
		data = JSON.stringify(data)
	}

	const blob = new Blob([data], {type: 'text/json'}),
		e = document.createEvent('MouseEvents'),
		a = document.createElement('a')

	a.download = filename
	a.href = window.URL.createObjectURL(blob)
	a.dataset.downloadurl = ['text/json', a.download, a.href].join(':')
	e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
	a.dispatchEvent(e)
}
