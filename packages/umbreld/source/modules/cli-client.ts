import process from 'node:process'

import {createTRPCClient, httpLink, createWSClient, wsLink, splitLink} from '@trpc/client'
import fse from 'fs-extra'

import * as jwt from './jwt.js'

import {type AppRouter, httpOnlyPaths} from './server/trpc/common.js'

// TODO: Maybe just read the endpoint from the data dir
const dataDir = process.env.UMBREL_DATA_DIR ?? '/home/umbrel/umbrel'
const trpcEndpoint = process.env.UMBREL_TRPC_ENDPOINT ?? `http://localhost/trpc`

async function signJwt() {
	const secret = await fse.readFile(`${dataDir}/secrets/jwt`, {encoding: 'utf8'})
	const token = await jwt.sign(secret)
	return token
}

// The CLI client always authenticates by signing a JWT; no unauthenticated mode.
// We use HTTP only for `httpOnlyPaths` (needs request/response semantics like cookies/headers), and WS otherwise.
const trpc = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition: (operation) => httpOnlyPaths.includes(operation.path as (typeof httpOnlyPaths)[number]),
			true: httpLink({
				url: trpcEndpoint,
				headers: async () => ({
					Authorization: `Bearer ${await signJwt()}`,
				}),
			}),
			false: wsLink({
				client: createWSClient({url: async () => `${trpcEndpoint}?token=${await signJwt()}`}),
			}),
		}),
	],
})

function parseValue(value: string): any {
	// Check if the value can be parsed as JSON
	try {
		return JSON.parse(value)
	} catch {
		// If not, check if the value can be converted to a number
		if (/^\d+\.?\d*$/.test(value)) {
			return Number(value)
		}

		// Check if the value is a comma-separated list
		if (value.includes(',')) {
			return value.split(',').map((v) => parseValue(v))
		}

		// Return as string
		return String(value)
	}
}

function parseArgs(args: string[]): any {
	if (args.length === 1) return parseValue(args[0])

	const result: Record<string, any> = {}
	for (let i = 0; i < args.length; i++) {
		if (!args[i].startsWith('--')) throw new Error('Invalid argument')
		const key = args[i].slice(2)
		const value = parseValue(args[i + 1])
		result[key] = value
		i++ // Skip next item which is the current value
	}

	return result
}

type CliClientOptions = {
	query: string
	args: string[]
}

export const cliClient = async ({query, args}: CliClientOptions) => {
	// Parse flags into an object
	const parsedArgs = parseArgs(args)

	// Split the query into parts and grab the procedure via dot notation
	const parts = query.split('.')
	let procedure: any = trpc
	for (const part of parts) procedure = procedure[part]

	// Subscription
	if (parts.at(-1) === 'subscribe') {
		return await new Promise((resolve, reject) => {
			procedure(parsedArgs, {
				onData: (data: any) => console.log(JSON.stringify(data, null, 2)),
				onError: (error: any) => reject(error),
				onComplete: () => resolve(void 0),
			})
		})
	}

	// Query or Mutation
	console.log(JSON.stringify(await procedure(parsedArgs), null, 2))
}
