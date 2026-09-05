import process from 'node:process'

import {runCli} from './scripts/translations.mjs'

runCli(process.argv.slice(2)).catch((error) => {
	console.error(error.message)
	process.exitCode = 1
})
