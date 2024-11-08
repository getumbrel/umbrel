#!/usr/bin/env tsx
import process from 'node:process'

import arg from 'arg'
import camelcaseKeys from 'camelcase-keys'

import {cliClient} from './modules/cli-client.js'
import blacklistUas from './modules/blacklist-uas/blacklist-uas.js'

import Umbreld, {type UmbreldOptions} from './index.js'

// Blacklists uas drivers early in the boot process
if (process.argv.includes('blacklist-uas')) {
	await blacklistUas()
	process.exit(0)
}

// Quick trpc client for testing
if (process.argv.includes('client')) {
	const clientIndex = process.argv.indexOf('client')
	const query = process.argv[clientIndex + 1]
	const args = process.argv.slice(clientIndex + 2)

	await cliClient({query, args})
	process.exit(0)
}

const showHelp = () =>
	console.log(`
    Usage
        $ umbreld

    Options
        --help                    Shows this help message
        --data-directory          Your Umbrel data directory
        --port                    The port to listen on
        --log-level               The logging intensity: silent|normal|verbose
		--default-app-store-repo  The default app store repository

    Examples
        $ umbreld --data-directory ~/umbrel
`)

const args = camelcaseKeys(
	arg({
		'--help': Boolean,
		'--data-directory': String,
		'--port': Number,
		'--log-level': String,
		'--default-app-store-repo': String,
	}),
)

if (args.help) {
	showHelp()
	process.exit(0)
}

// TODO: Validate these args are valid
const umbreld = new Umbreld(args as UmbreldOptions)

// Shutdown cleanly on SIGINT and SIGTERM
let isShuttingDown = false
async function cleanShutdown(signal: string) {
	if (isShuttingDown) return
	isShuttingDown = true

	umbreld.logger.log(`Received ${signal}, shutting down cleanly...`)
	await umbreld.stop()
	process.exit(0)
}
process.on('SIGINT', cleanShutdown.bind(null, 'SIGINT'))
process.on('SIGTERM', cleanShutdown.bind(null, 'SIGTERM'))

try {
	await umbreld.start()
} catch (error) {
	console.error(process.env.NODE_ENV === 'production' ? (error as Error).message : error)
	process.exit(1)
}
