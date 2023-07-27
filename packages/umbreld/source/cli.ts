#!/usr/bin/env ts-node
import process from 'node:process'

import arg from 'arg'
import camelcaseKeys from 'camelcase-keys'

import {cliClient} from './modules/cli-client.js'

import update from './migrations/index.js'
import Umbreld from './index.js'

// In the future migrations will run on start and we'll run through
// all required migrations for the version range we've jumped between.
// However during the transition phase we need to run migrations manually
// during the OTA update process because we need to update scripts before
// starting umbrel again.
if (process.argv.includes('--update')) {
	const updateIndex = process.argv.indexOf('--update')
	const updateRoot = process.argv[updateIndex + 1]
	const umbrelRoot = process.argv[updateIndex + 2]
	await update({updateRoot, umbrelRoot})
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
        --help            Shows this help message
        --data-directory  Your Umbrel data directory
        --port            The port to listen on
        --log-level       The logging intensity: silent|normal|verbose

    Examples
        $ umbreld --data-directory ~/umbrel
`)

const args = camelcaseKeys(
	arg({
		'--help': Boolean,
		'--data-directory': String,
		'--port': Number,
		'--log-level': String,
	}),
)

if (args.help) {
	showHelp()
	process.exit(0)
}

const umbreld = new Umbreld(args)

try {
	await umbreld.start()
} catch (error) {
	console.error(process.env.NODE_ENV === 'production' ? error.message : error)
	process.exit(1)
}
