#!/usr/bin/env node
import process from 'node:process'

import arg from 'arg'
import camelcaseKeys from 'camelcase-keys'

import Umbreld from './index.js'

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
