import process from 'node:process'

import {createTRPCClient, httpLink, createWSClient, wsLink, splitLink} from '@trpc/client'
import fse from 'fs-extra'

import {type AppRouter, httpOnlyPaths} from './server/trpc/common.ts'

// TODO: Maybe just read the endpoint from the data dir
const dataDir = process.env.UMBREL_DATA_DIR ?? '/home/umbrel/umbrel'
const trpcEndpoint = process.env.UMBREL_TRPC_ENDPOINT ?? `http://localhost/trpc`

// This credential deliberately lives below a 0700 auth directory as a 0600
// file. The production CLI is therefore root-only; loosening the file mode
// would turn local shell access into full umbreld API access.
const systemToken = () => fse.readFile(`${dataDir}/secrets/auth/system-token`, {encoding: 'utf8'})

const ticketClient = createTRPCClient<AppRouter>({
	links: [
		httpLink({
			url: trpcEndpoint,
			headers: async () => ({Authorization: `Bearer ${await systemToken()}`}),
		}),
	],
})

// tRPC's WS client retries a connection it can't set up forever without failing pending operations,
// so an unreadable system token (e.g. not running as root) or an unreachable umbreld would hang the
// CLI. We surface failures to set up the initial connection so the command errors instead.
let initialConnectionOpened = false
let rejectInitialConnection: (error: unknown) => void
const initialConnectionFailed = new Promise<never>((_, reject) => (rejectInitialConnection = reject))
// The WS client connects eagerly, so this can reject before a command is waiting on it
initialConnectionFailed.catch(() => {})

// The CLI client always authenticates with the local system credential; no unauthenticated mode.
// We use HTTP only for `httpOnlyPaths` (needs request/response semantics like cookies/headers), and WS otherwise.
export const trpc = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition: (operation) => httpOnlyPaths.includes(operation.path as (typeof httpOnlyPaths)[number]),
			true: httpLink({
				url: trpcEndpoint,
				headers: async () => ({
					Authorization: `Bearer ${await systemToken()}`,
				}),
			}),
			false: wsLink({
				client: createWSClient({
					url: async () => {
						try {
							return `${trpcEndpoint}?ticket=${await ticketClient.user.createWebSocketTicket.mutate({target: 'trpc'})}`
						} catch (error) {
							if (!initialConnectionOpened) rejectInitialConnection(error)
							throw error
						}
					},
					onOpen: () => {
						initialConnectionOpened = true
					},
				}),
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

	// Only operations routed over WS are left pending by a failed connection
	const path = parts.slice(0, -1).join('.')
	const usesWebSocket = !httpOnlyPaths.includes(path as (typeof httpOnlyPaths)[number])
	const connectionFailed = usesWebSocket ? initialConnectionFailed : new Promise<never>(() => {})

	// Subscription
	if (parts.at(-1) === 'subscribe') {
		return await new Promise((resolve, reject) => {
			connectionFailed.catch(reject)
			procedure(parsedArgs, {
				onData: (data: any) => console.log(JSON.stringify(data, null, 2)),
				onError: (error: any) => reject(error),
				onComplete: () => resolve(void 0),
			})
		})
	}

	// Query or Mutation
	console.log(JSON.stringify(await Promise.race([connectionFailed, procedure(parsedArgs)]), null, 2))
}
